# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from datetime import UTC, datetime
from typing import cast
from uuid import UUID

from sqlalchemy import CursorResult, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.request_log import RequestLog
from app.schemas.request_log import RequestLogCreateInternal


# ============================================================
# Classes
# ============================================================


class RequestLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, request_log_id: UUID) -> RequestLog | None:
        return await self.session.get(RequestLog, request_log_id)

    async def list_by_project(
        self, project_id: UUID, offset: int = 0, limit: int = 100
    ) -> list[RequestLog]:
        """One project's log, newest first."""
        result = await self.session.execute(
            select(RequestLog)
            .where(RequestLog.project_id == project_id)
            .order_by(RequestLog.created_at.desc(), RequestLog.id.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def count_by_project(self, project_id: UUID) -> int:
        result = await self.session.execute(
            select(func.count()).select_from(RequestLog).where(RequestLog.project_id == project_id)
        )
        return result.scalar_one()

    async def create(self, data: RequestLogCreateInternal) -> RequestLog:
        # The arrival time is stamped here, not by the column default: SQLite's
        # CURRENT_TIMESTAMP has whole-second resolution, and a mock called in a
        # loop would list its requests in random order within each second.
        request_log = RequestLog(**data.model_dump(), created_at=datetime.now(UTC))
        self.session.add(request_log)
        await self.session.flush()
        return request_log

    async def delete_by_project(self, project_id: UUID) -> int:
        """Delete one project's whole log; how many rows went."""
        result = await self.session.execute(
            delete(RequestLog).where(RequestLog.project_id == project_id)
        )
        return cast(CursorResult[tuple[()]], result).rowcount

    async def delete_overflow(self, project_id: UUID, keep: int) -> int:
        """Delete one project's rows past the newest `keep`; how many rows went."""
        overflow = (
            select(RequestLog.id)
            .where(RequestLog.project_id == project_id)
            .order_by(RequestLog.created_at.desc(), RequestLog.id.desc())
            .offset(keep)
        )
        result = await self.session.execute(
            delete(RequestLog).where(RequestLog.id.in_(overflow.scalar_subquery()))
        )
        return cast(CursorResult[tuple[()]], result).rowcount
