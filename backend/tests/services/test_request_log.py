"""RequestLogService: one project's log, read and cleared through the project."""

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.exceptions import NotFoundError
from app.schemas.project import ProjectCreateRequest
from app.schemas.request_log import RequestLogCreateInternal
from app.services.mock import MockService
from app.services.project import ProjectService
from app.services.request_log import RequestLogService


async def test_request_log_read_and_clear(factory: async_sessionmaker[AsyncSession]) -> None:
    """The log reads per project and a clear empties it; other projects' ids stay hidden."""
    async with factory() as session:
        project_service = ProjectService(session)
        project = await project_service.create_project(
            ProjectCreateRequest(name="Demo", slug="demo")
        )
    async with factory() as session:
        other = await ProjectService(session).create_project(
            ProjectCreateRequest(name="Other", slug="other")
        )
    async with factory() as session:
        await MockService(session).create_request_log(
            RequestLogCreateInternal(
                project_id=project.id,
                endpoint_id=None,
                method="GET",
                path="/x",
                query_string="a=1",
                request_headers={"x-a": "1"},
                request_body="",
                response_status=404,
                matched=False,
                duration_ms=3,
            )
        )
    async with factory() as session:
        request_log_service = RequestLogService(session)
        logs = await request_log_service.list_request_logs(project.id)
        assert [log.path for log in logs] == ["/x"]
        assert await request_log_service.count_request_logs(project.id) == 1
        detail = await request_log_service.get_request_log(project.id, logs[0].id)
        assert detail.request_headers == {"x-a": "1"}
        with pytest.raises(NotFoundError):
            await request_log_service.get_request_log(other.id, logs[0].id)
    async with factory() as session:
        await RequestLogService(session).delete_request_logs(project.id)
    async with factory() as session:
        assert await RequestLogService(session).count_request_logs(project.id) == 0


async def test_unknown_project_is_not_found(factory: async_sessionmaker[AsyncSession]) -> None:
    """A missing project answers 404 rather than an empty log that reads as never called."""
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await RequestLogService(session).list_request_logs(uuid4())
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await RequestLogService(session).delete_request_logs(uuid4())
