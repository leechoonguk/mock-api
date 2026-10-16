# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import CursorResult, Select, String, case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.request_log import RequestLog
from app.schemas.request_log import RequestLogCreateInternal, RequestLogFilter


# ============================================================
# Constants
# ============================================================

#: Who answered a row, spelled as the `outcome` filter's values.
OUTCOME = case(
    (RequestLog.matched.is_(True), "matched"),
    (RequestLog.proxied.is_(True), "proxied"),
    else_="unmatched",
)

#: A row's status class as the `status_class` filter spells it: `"2"` for a 2xx.
STATUS_CLASS = (RequestLog.response_status // 100).cast(String)


# ============================================================
# Classes
# ============================================================


class RequestLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def get(self, request_log_id: UUID) -> RequestLog | None:
        return await self.session.get(RequestLog, request_log_id)

    async def list_by_project(
        self,
        project_id: UUID,
        filters: RequestLogFilter,
        offset: int = 0,
        limit: int = 100,
    ) -> list[RequestLog]:
        """One project's log under the filters, newest first."""
        query = _apply_filters(select(RequestLog), project_id, filters)
        result = await self.session.execute(
            query.order_by(RequestLog.created_at.desc(), RequestLog.id.desc())
            .offset(offset)
            .limit(limit)
        )
        return list(result.scalars().all())

    async def list_by_ids(self, project_id: UUID, request_log_ids: list[UUID]) -> list[RequestLog]:
        """The project's rows among `request_log_ids`, newest first; other projects' are absent."""
        result = await self.session.execute(
            select(RequestLog)
            .where(RequestLog.project_id == project_id, RequestLog.id.in_(request_log_ids))
            .order_by(RequestLog.created_at.desc(), RequestLog.id.desc())
        )
        return list(result.scalars().all())

    async def count_by_project(self, project_id: UUID, filters: RequestLogFilter) -> int:
        """How many rows the unwindowed `list_by_project` would return, under the same filters."""
        query = _apply_filters(select(func.count()).select_from(RequestLog), project_id, filters)
        result = await self.session.execute(query)
        return result.scalar_one()

    async def list_body_refs(self) -> set[str]:
        """Every stored answer a log row refers to - what the body store must keep."""
        result = await self.session.execute(
            select(RequestLog.response_body_ref)
            .where(RequestLog.response_body_ref.is_not(None))
            .distinct()
        )
        return {ref for ref in result.scalars().all() if ref is not None}

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


# ============================================================
# Functions
# ============================================================


def _apply_filters(query: Select[Any], project_id: UUID, filters: RequestLogFilter) -> Select[Any]:
    """Narrow a query to one project's rows under the log screen's filters."""
    query = query.where(RequestLog.project_id == project_id)
    if filters.method:
        query = query.where(RequestLog.method.in_(filters.method))
    if filters.status_class:
        query = query.where(STATUS_CLASS.in_(filters.status_class))
    if filters.outcome:
        query = query.where(OUTCOME.in_(filters.outcome))
    path = filters.path
    if path is not None:
        query = query.where(RequestLog.path.ilike(f"%{path}%"))
    host = filters.host
    if host is not None:
        query = query.where(RequestLog.host.ilike(f"%{host}%"))
    return query
