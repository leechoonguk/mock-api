# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import asyncio
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.body_store import body_store
from app.core.exceptions import NotFoundError
from app.core.settings import LOG_RETENTION_PER_PROJECT
from app.engine.volatility import volatile_fields
from app.models.project import Project
from app.models.request_log import RequestLog
from app.repositories.project import ProjectRepository
from app.repositories.request_log import RequestLogRepository
from app.schemas.mock import OCTET_STREAM
from app.schemas.request_log import RequestLogFilter


# ============================================================
# Classes
# ============================================================


class RequestLogService:
    """Reads and clears one project's request log; the mock writes it (`MockService`).

    The project is read first so an unknown id answers 404 rather than an empty
    page that reads as "never called".
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.project_repository = ProjectRepository(session)
        self.request_log_repository = RequestLogRepository(session)

    async def get_request_log(self, project_id: UUID, request_log_id: UUID) -> RequestLog:
        await self._get_project(project_id)
        request_log = await self.request_log_repository.get(request_log_id)
        if request_log is None or request_log.project_id != project_id:
            raise NotFoundError(request_log_id)
        return request_log

    async def count_request_logs(self, project_id: UUID, filters: RequestLogFilter) -> int:
        await self._get_project(project_id)
        return await self.request_log_repository.count_by_project(project_id, filters)

    async def list_request_logs(
        self, project_id: UUID, filters: RequestLogFilter, offset: int = 0, limit: int = 100
    ) -> list[RequestLog]:
        await self._get_project(project_id)
        return await self.request_log_repository.list_by_project(project_id, filters, offset, limit)

    async def list_volatile_fields(self, project_id: UUID) -> list[tuple[str, int]]:
        """The fields the project's log shows changing between calls to one route.

        Read from the whole retained log, every request it kept; a field the
        project already ignores is not suggested again.
        """
        project = await self._get_project(project_id)
        request_logs = await self.request_log_repository.list_by_project(
            project_id, RequestLogFilter(), 0, LOG_RETENTION_PER_PROJECT
        )
        return volatile_fields(
            (
                (f"{log.method} {log.host}{log.path}", log.query_string, log.request_body)
                for log in request_logs
            ),
            project.ignored_fields,
        )

    async def get_response_body(self, project_id: UUID, request_log_id: UUID) -> tuple[bytes, str]:
        """The real server's answer to a logged request, whole, with its content type.

        The stored copy when it was kept whole, otherwise the text the log holds;
        a request no real server answered has none (404).
        """
        request_log = await self.get_request_log(project_id, request_log_id)
        content_type = (request_log.response_headers or {}).get("content-type", OCTET_STREAM)
        if request_log.response_body_ref is not None:
            content = await asyncio.to_thread(body_store().get, request_log.response_body_ref)
        elif request_log.response_body is not None:
            content = request_log.response_body.encode("utf-8")
        else:
            content = None
        if content is None:
            raise NotFoundError(request_log_id)
        return content, content_type

    async def delete_request_logs(self, project_id: UUID) -> None:
        """Clear the project's whole log - the screen's "clear logs"."""
        async with self.session.begin():
            await self._get_project(project_id)
            await self.request_log_repository.delete_by_project(project_id)

    async def _get_project(self, project_id: UUID) -> Project:
        project = await self.project_repository.get(project_id)
        if project is None:
            raise NotFoundError(project_id)
        return project
