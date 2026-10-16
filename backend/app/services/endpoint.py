# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import asyncio
from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.body_store import body_store
from app.core.exceptions import NotFoundError, NotRecordableError
from app.engine.matcher import condition_key
from app.models.endpoint import Endpoint
from app.models.project import Project
from app.models.request_log import RequestLog
from app.repositories.endpoint import EndpointRepository
from app.repositories.project import ProjectRepository
from app.repositories.request_log import RequestLogRepository
from app.schemas.endpoint import (
    EndpointCreateInternal,
    EndpointCreateRequest,
    EndpointRecordManyRequest,
    EndpointRecordRequest,
    EndpointUpdateRequest,
    RecordSkip,
    recorded_endpoint,
)
from app.schemas.mock import OCTET_STREAM, text_content_type


# ============================================================
# Classes
# ============================================================


class EndpointService:
    """One project's endpoints, always reached through the project.

    The project is read first, so an unknown project answers 404 rather than an
    empty page, and an endpoint of another project answers 404 as if it did not
    exist - an id from one project never edits another's mock.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.project_repository = ProjectRepository(session)
        self.endpoint_repository = EndpointRepository(session)
        self.request_log_repository = RequestLogRepository(session)

    async def get_endpoint(self, project_id: UUID, endpoint_id: UUID) -> Endpoint:
        await self._get_project(project_id)
        return await self._get_owned_endpoint(project_id, endpoint_id)

    async def count_endpoints(self, project_id: UUID) -> int:
        await self._get_project(project_id)
        return await self.endpoint_repository.count_by_project(project_id)

    async def list_endpoints(
        self, project_id: UUID, offset: int = 0, limit: int = 100
    ) -> list[Endpoint]:
        await self._get_project(project_id)
        return await self.endpoint_repository.list_by_project(project_id, offset, limit)

    async def create_endpoint(self, project_id: UUID, data: EndpointCreateRequest) -> Endpoint:
        internal = EndpointCreateInternal(**data.model_dump(), project_id=project_id)
        async with self.session.begin():
            await self._get_project(project_id)
            return await self.endpoint_repository.create(internal)

    async def create_endpoint_from_request_log(
        self, project_id: UUID, request_log_id: UUID, data: EndpointRecordRequest
    ) -> Endpoint:
        """Save a proxied request's upstream answer as an endpoint, at `data.path` if given.

        An unknown log, or another project's, is 404; one whose answer cannot be an
        endpoint is 422 `not_recordable`; a taken method and path is 409 `conflict`.
        """
        async with self.session.begin():
            project = await self._get_project(project_id)
            request_log = await self.request_log_repository.get(request_log_id)
            if request_log is None or request_log.project_id != project_id:
                raise NotFoundError(request_log_id)
            candidate = _candidate(
                request_log, data.path or request_log.path, project.ignored_fields
            )
            if candidate is None:
                raise NotRecordableError(request_log_id)
            return await self.endpoint_repository.create(
                EndpointCreateInternal(**candidate.model_dump(), project_id=project_id)
            )

    async def create_endpoints_from_request_logs(
        self, project_id: UUID, data: EndpointRecordManyRequest
    ) -> tuple[list[Endpoint], list[RecordSkip]]:
        """Save the selected exchanges as endpoints at their logged paths, in one transaction.

        Nothing selected fails the whole save: a log that is gone or another
        project's, one that cannot be an endpoint, an older copy of a selected
        request (the newest wins) and a route the project already holds are each
        left out and reported with the reason.
        """
        async with self.session.begin():
            project = await self._get_project(project_id)
            request_log_ids = list(dict.fromkeys(data.request_log_ids))
            request_logs = await self.request_log_repository.list_by_ids(
                project_id, request_log_ids
            )
            found = {request_log.id for request_log in request_logs}
            skipped = [
                RecordSkip(request_log_id=request_log_id, reason="not_found")
                for request_log_id in request_log_ids
                if request_log_id not in found
            ]
            taken = await self.endpoint_repository.list_route_keys(project_id)
            saved: set[tuple[str, str, str, str]] = set()
            created: list[Endpoint] = []
            for request_log in request_logs:
                candidate = _candidate(request_log, request_log.path, project.ignored_fields)
                if candidate is None:
                    skipped.append(
                        RecordSkip(request_log_id=request_log.id, reason="not_recordable")
                    )
                    continue
                route = (
                    candidate.method,
                    candidate.host,
                    candidate.path,
                    condition_key(candidate.match_query, candidate.match_body),
                )
                if route in saved or route in taken:
                    reason = "duplicate" if route in saved else "conflict"
                    skipped.append(RecordSkip(request_log_id=request_log.id, reason=reason))
                    continue
                saved.add(route)
                created.append(
                    await self.endpoint_repository.create(
                        EndpointCreateInternal(**candidate.model_dump(), project_id=project_id)
                    )
                )
            return created, skipped

    async def update_endpoint(
        self, project_id: UUID, endpoint_id: UUID, data: EndpointUpdateRequest
    ) -> Endpoint:
        async with self.session.begin():
            await self._get_project(project_id)
            await self._get_owned_endpoint(project_id, endpoint_id)
            # The row was loaded in this transaction, so it is there to update.
            return cast(Endpoint, await self.endpoint_repository.update(endpoint_id, data))

    async def delete_endpoint(self, project_id: UUID, endpoint_id: UUID) -> None:
        async with self.session.begin():
            await self._get_project(project_id)
            await self._get_owned_endpoint(project_id, endpoint_id)
            await self.endpoint_repository.delete(endpoint_id)

    async def get_endpoint_body(self, project_id: UUID, endpoint_id: UUID) -> tuple[bytes, str]:
        """What the endpoint answers with, whole: its stored bytes, or its typed body template."""
        await self._get_project(project_id)
        endpoint = await self._get_owned_endpoint(project_id, endpoint_id)
        declared = {name.lower(): value for name, value in endpoint.headers.items()}
        if endpoint.body_ref is None:
            return endpoint.body.encode("utf-8"), declared.get(
                "content-type", text_content_type(endpoint.body)
            )
        stored = await asyncio.to_thread(body_store().get, endpoint.body_ref)
        if stored is None:
            raise NotFoundError(endpoint.body_ref)
        return stored, declared.get("content-type", OCTET_STREAM)

    async def _get_project(self, project_id: UUID) -> Project:
        project = await self.project_repository.get(project_id)
        if project is None:
            raise NotFoundError(project_id)
        return project

    async def _get_owned_endpoint(self, project_id: UUID, endpoint_id: UUID) -> Endpoint:
        endpoint = await self.endpoint_repository.get(endpoint_id)
        if endpoint is None or endpoint.project_id != project_id:
            raise NotFoundError(endpoint_id)
        return endpoint


# ============================================================
# Functions
# ============================================================


def _candidate(
    request_log: RequestLog, path: str, ignored: list[str]
) -> EndpointCreateRequest | None:
    """The endpoint `request_log`'s exchange would replay as at `path`, or None when it cannot."""
    if not request_log.recordable:
        return None
    return recorded_endpoint(
        request_log.method,
        request_log.host,
        path,
        request_log.query_string,
        request_log.request_body,
        request_log.response_status,
        request_log.response_headers or {},
        "" if request_log.response_body_ref else request_log.response_body or "",
        request_log.response_body_ref,
        ignored,
    )
