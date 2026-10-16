# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.models.request_log import RequestLog
from app.repositories.project import ProjectRepository
from app.repositories.request_log import RequestLogRepository


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

    async def count_request_logs(self, project_id: UUID) -> int:
        await self._get_project(project_id)
        return await self.request_log_repository.count_by_project(project_id)

    async def list_request_logs(
        self, project_id: UUID, offset: int = 0, limit: int = 100
    ) -> list[RequestLog]:
        await self._get_project(project_id)
        return await self.request_log_repository.list_by_project(project_id, offset, limit)

    async def delete_request_logs(self, project_id: UUID) -> None:
        """Clear the project's whole log - the screen's "clear logs"."""
        async with self.session.begin():
            await self._get_project(project_id)
            await self.request_log_repository.delete_by_project(project_id)

    async def _get_project(self, project_id: UUID) -> None:
        if await self.project_repository.get(project_id) is None:
            raise NotFoundError(project_id)
