# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import NotFoundError
from app.core.settings import LOG_RETENTION_PER_PROJECT
from app.engine.matcher import find_best
from app.repositories.endpoint import EndpointRepository
from app.repositories.project import ProjectRepository
from app.repositories.request_log import RequestLogRepository
from app.schemas.endpoint import to_read_list
from app.schemas.mock import MockResolution
from app.schemas.request_log import RequestLogCreateInternal


# ============================================================
# Classes
# ============================================================


class MockService:
    """Answers mocked requests: which endpoint a request reaches, and the log of it."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.project_repository = ProjectRepository(session)
        self.endpoint_repository = EndpointRepository(session)

    async def resolve(self, slug: str, method: str, path: str) -> MockResolution:
        """The project `slug` names and its endpoint for `method path`, if one matches.

        An unknown slug is a 404 `not_found` and is not logged: there is no
        project to file the request under. A read only - no transaction.
        """
        project = await self.project_repository.get_by_slug(slug)
        if project is None:
            raise NotFoundError(slug)
        endpoints = await self.endpoint_repository.list_enabled_by_project(project.id)
        # Matched as snapshots: the answer is fixed when the request is resolved,
        # so an edit saved during the endpoint's delay cannot change it halfway.
        found = find_best(to_read_list(endpoints), method, path)
        if found is None:
            return MockResolution(project_id=project.id, endpoint=None, params={})
        endpoint, params = found
        return MockResolution(project_id=project.id, endpoint=endpoint, params=params)

    async def create_request_log(self, data: RequestLogCreateInternal) -> None:
        """Store one request on its own session, then trim the project's log to its retention.

        Not the request's session: it already holds the read that resolved the
        endpoint, so `begin()` on it would raise "a transaction is already
        begun". The engine comes from that session rather than from
        `core.database`, so the tests' swapped engine is the one written to.
        """
        async with AsyncSession(self.session.bind, expire_on_commit=False) as session:
            request_log_repository = RequestLogRepository(session)
            async with session.begin():
                await request_log_repository.create(data)
                await request_log_repository.delete_overflow(
                    data.project_id, keep=LOG_RETENTION_PER_PROJECT
                )
