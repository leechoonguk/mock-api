"""MockService: resolving a request to an endpoint, and writing the log beside the request."""

from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.exceptions import NotFoundError
from app.schemas.endpoint import EndpointCreateRequest
from app.schemas.project import ProjectCreateRequest
from app.schemas.request_log import RequestLogCreateInternal
from app.services import mock as mock_module
from app.services.endpoint import EndpointService
from app.services.mock import MockService
from app.services.project import ProjectService
from app.services.request_log import RequestLogService


async def _project_with_endpoint(factory: async_sessionmaker[AsyncSession]) -> UUID:
    async with factory() as session:
        project = await ProjectService(session).create_project(
            ProjectCreateRequest(name="Demo", slug="demo")
        )
    async with factory() as session:
        await EndpointService(session).create_endpoint(
            project.id, EndpointCreateRequest(method="GET", path="/users/{id}", body="u")
        )
    return project.id


def _entry(project_id: UUID, path: str) -> RequestLogCreateInternal:
    return RequestLogCreateInternal(
        project_id=project_id,
        endpoint_id=None,
        method="GET",
        path=path,
        query_string="",
        request_headers={},
        request_body="",
        response_status=404,
        matched=False,
        duration_ms=0,
    )


async def test_resolve_returns_the_match_or_none(factory: async_sessionmaker[AsyncSession]) -> None:
    """A match carries the endpoint snapshot and its parameters; a miss still names the project."""
    project_id = await _project_with_endpoint(factory)
    async with factory() as session:
        hit = await MockService(session).resolve("demo", "GET", "/users/7")
        assert hit.project_id == project_id
        assert hit.endpoint is not None
        assert (hit.endpoint.body, hit.params) == ("u", {"id": "7"})
        miss = await MockService(session).resolve("demo", "POST", "/users/7")
        assert (miss.project_id, miss.endpoint) == (project_id, None)


async def test_resolve_unknown_slug_is_not_found(factory: async_sessionmaker[AsyncSession]) -> None:
    """No project means nowhere to file a log, so the miss is a NotFoundError instead."""
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await MockService(session).resolve("nobody", "GET", "/")


async def test_create_request_log_trims_to_retention(
    factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Each write trims the project's log, so a mock polled in a loop cannot grow it forever."""
    monkeypatch.setattr(mock_module, "LOG_RETENTION_PER_PROJECT", 2)
    project_id = await _project_with_endpoint(factory)
    async with factory() as session:
        mock_service = MockService(session)
        # The request's own session has already read, as in a real request.
        await mock_service.resolve("demo", "GET", "/users/1")
        for n in range(3):
            await mock_service.create_request_log(_entry(project_id, f"/{n}"))
    async with factory() as session:
        logs = await RequestLogService(session).list_request_logs(project_id)
    assert [log.path for log in logs] == ["/2", "/1"]
