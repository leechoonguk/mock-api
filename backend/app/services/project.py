# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from typing import cast
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.project import Project
from app.repositories.endpoint import EndpointRepository
from app.repositories.project import ProjectRepository
from app.schemas.project import ProjectCreateRequest, ProjectUpdateRequest


# ============================================================
# Classes
# ============================================================


class ProjectService:
    """The mocked APIs: their rows, and how many endpoints each declares.

    A taken slug is not checked before the write: the unique constraint refuses
    it, and the IntegrityError handler answers 409 - a check first would only
    race the constraint it duplicates.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.project_repository = ProjectRepository(session)
        self.endpoint_repository = EndpointRepository(session)

    async def get_project(self, project_id: UUID) -> Project:
        project = await self.project_repository.get(project_id)
        if project is None:
            raise NotFoundError(project_id)
        return project

    async def count_projects(self, name: str | None = None) -> int:
        return await self.project_repository.count(name)

    async def list_projects(
        self,
        offset: int = 0,
        limit: int = 100,
        name: str | None = None,
        sort: str | None = None,
        order: str = "asc",
    ) -> list[Project]:
        return await self.project_repository.list(offset, limit, name, sort, order)

    async def count_project_endpoints(self, project_ids: list[UUID]) -> dict[UUID, int]:
        """How many endpoints each project declares - the list's count column."""
        return await self.endpoint_repository.count_by_project_ids(project_ids)

    async def create_project(self, data: ProjectCreateRequest) -> Project:
        async with self.session.begin():
            return await self.project_repository.create(data)

    async def update_project(self, project_id: UUID, data: ProjectUpdateRequest) -> Project:
        async with self.session.begin():
            if await self.project_repository.get(project_id) is None:
                raise NotFoundError(project_id)
            # The row was loaded in this transaction, so it is there to update.
            return cast(Project, await self.project_repository.update(project_id, data))

    async def delete_project(self, project_id: UUID) -> None:
        """Delete the project; its endpoints and log go with it (ON DELETE CASCADE)."""
        async with self.session.begin():
            if not await self.project_repository.delete(project_id):
                raise NotFoundError(project_id)
