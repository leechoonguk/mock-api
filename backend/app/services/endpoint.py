# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.endpoint import Endpoint
from app.repositories.endpoint import EndpointRepository
from app.repositories.project import ProjectRepository
from app.schemas.endpoint import (
    EndpointCreateInternal,
    EndpointCreateRequest,
    EndpointUpdateRequest,
)


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

    async def _get_project(self, project_id: UUID) -> None:
        if await self.project_repository.get(project_id) is None:
            raise NotFoundError(project_id)

    async def _get_owned_endpoint(self, project_id: UUID, endpoint_id: UUID) -> Endpoint:
        endpoint = await self.endpoint_repository.get(endpoint_id)
        if endpoint is None or endpoint.project_id != project_id:
            raise NotFoundError(endpoint_id)
        return endpoint
