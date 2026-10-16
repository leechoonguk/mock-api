# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.project import Project
from app.schemas.project import ProjectCreateRequest, ProjectUpdateRequest


# ============================================================
# Classes
# ============================================================


class ProjectRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, project_id: UUID) -> Project | None:
        return await self.session.get(Project, project_id)

    async def list_with_hosts(self) -> list[Project]:
        """Every project that intercepts a host - what a request's host is matched against."""
        result = await self.session.execute(
            select(Project).where(func.json_array_length(Project.hosts) > 0)
        )
        return list(result.scalars().all())

    async def list(
        self,
        offset: int = 0,
        limit: int = 100,
        name: str | None = None,
        sort: str | None = None,
        order: str = "asc",
    ) -> list[Project]:
        query = _apply_sort(_apply_filters(select(Project), name), sort, order)
        result = await self.session.execute(query.offset(offset).limit(limit))
        return list(result.scalars().all())

    async def count(self, name: str | None = None) -> int:
        """How many rows the unwindowed `list` would return, under the same filter."""
        query = _apply_filters(select(func.count()).select_from(Project), name)
        result = await self.session.execute(query)
        return result.scalar_one()

    async def create(self, data: ProjectCreateRequest) -> Project:
        project = Project(**data.model_dump())
        self.session.add(project)
        await self.session.flush()
        return project

    async def update(self, project_id: UUID, data: ProjectUpdateRequest) -> Project | None:
        project = await self.session.get(Project, project_id)
        if project is None:
            return None
        # `exclude_none`: every column is NOT NULL, so a JSON `null` in a PATCH
        # can only mean "leave it", never "clear it".
        for field, value in data.model_dump(exclude_unset=True, exclude_none=True).items():
            setattr(project, field, value)
        # Set before the flush: onupdate=func.now() evaluated lazily raises
        # MissingGreenlet, and a post-flush assignment costs a second UPDATE.
        project.updated_at = datetime.now(UTC)
        await self.session.flush()
        return project

    async def delete(self, project_id: UUID) -> bool:
        project = await self.session.get(Project, project_id)
        if project is None:
            return False
        await self.session.delete(project)
        return True


# ============================================================
# Functions
# ============================================================


def _apply_filters(query: Select[Any], name: str | None) -> Select[Any]:
    """Narrow a query to the projects whose name contains `name`."""
    if name is None:
        return query
    return query.where(Project.name.ilike(f"%{name}%"))


def _apply_sort(query: Select[Any], sort: str | None, order: str) -> Select[Any]:
    """Order by the column the caller named, then by name and id as the tiebreak.

    The tiebreak keeps a page cut through a run of equal values on the same rows
    twice. `sort` is one of a Literal the router closed, so `getattr` cannot miss.
    """
    default = (Project.name, Project.id)
    if sort is None:
        return query.order_by(*default)
    column = getattr(Project, sort)
    return query.order_by(column.desc() if order == "desc" else column.asc(), *default)
