# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.endpoint import Endpoint
from app.schemas.endpoint import EndpointCreateInternal, EndpointUpdateRequest


# ============================================================
# Classes
# ============================================================


class EndpointRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, endpoint_id: UUID) -> Endpoint | None:
        return await self.session.get(Endpoint, endpoint_id)

    async def list_by_project(
        self, project_id: UUID, offset: int = 0, limit: int = 100
    ) -> list[Endpoint]:
        """One project's endpoints in path order, each path's methods together."""
        result = await self.session.execute(
            select(Endpoint)
            .where(Endpoint.project_id == project_id)
            .order_by(Endpoint.path, Endpoint.method, Endpoint.id)
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_enabled_by_project(self, project_id: UUID) -> list[Endpoint]:
        """Every endpoint that may answer a mocked request - unpaged, because matching reads all."""
        result = await self.session.execute(
            select(Endpoint).where(Endpoint.project_id == project_id, Endpoint.enabled.is_(True))
        )
        return list(result.scalars().all())

    async def count_by_project(self, project_id: UUID) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(Endpoint).where(Endpoint.project_id == project_id)
        )
        return result.scalar_one()

    async def count_by_project_ids(self, project_ids: list[UUID]) -> dict[UUID, int]:
        """Each project's endpoint count, in one grouped query; a project with none is absent."""
        if not project_ids:
            return {}
        result = await self.session.execute(
            select(Endpoint.project_id, func.count())
            .where(Endpoint.project_id.in_(project_ids))
            .group_by(Endpoint.project_id)
        )
        return {project_id: count for project_id, count in result.all()}

    async def create(self, data: EndpointCreateInternal) -> Endpoint:
        endpoint = Endpoint(**data.model_dump())
        self.session.add(endpoint)
        await self.session.flush()
        return endpoint

    async def update(self, endpoint_id: UUID, data: EndpointUpdateRequest) -> Endpoint | None:
        endpoint = await self.session.get(Endpoint, endpoint_id)
        if endpoint is None:
            return None
        # `exclude_none`: every column here is NOT NULL, so a JSON `null` in a
        # PATCH can only mean "leave it", never "clear it".
        for field, value in data.model_dump(exclude_unset=True, exclude_none=True).items():
            setattr(endpoint, field, value)
        # Set before the flush: onupdate=func.now() evaluated lazily raises
        # MissingGreenlet, and a post-flush assignment costs a second UPDATE.
        endpoint.updated_at = datetime.now(UTC)
        await self.session.flush()
        return endpoint

    async def delete(self, endpoint_id: UUID) -> bool:
        endpoint = await self.session.get(Endpoint, endpoint_id)
        if endpoint is None:
            return False
        await self.session.delete(endpoint)
        return True
