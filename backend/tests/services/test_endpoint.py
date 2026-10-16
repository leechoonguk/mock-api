"""EndpointService: endpoints are reached only through their own project."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.exceptions import NotFoundError, NotRecordableError
from app.repositories.request_log import RequestLogRepository
from app.schemas.endpoint import (
    EndpointCreateRequest,
    EndpointRecordManyRequest,
    EndpointRecordRequest,
    EndpointUpdateRequest,
)
from app.schemas.project import ProjectCreateRequest
from app.schemas.request_log import RequestLogCreateInternal
from app.services.endpoint import EndpointService
from app.services.project import ProjectService


async def _project(factory: async_sessionmaker[AsyncSession], name: str) -> UUID:
    async with factory() as session:
        project = await ProjectService(session).create_project(ProjectCreateRequest(name=name))
    return project.id


async def test_endpoint_lifecycle(factory: async_sessionmaker[AsyncSession]) -> None:
    """Create, read, list, count, update and delete under the owning project."""
    project_id = await _project(factory, "demo")
    async with factory() as session:
        endpoint = await EndpointService(session).create_endpoint(
            project_id, EndpointCreateRequest(method="GET", path="/users/{id}")
        )
    async with factory() as session:
        endpoint_service = EndpointService(session)
        assert (await endpoint_service.get_endpoint(project_id, endpoint.id)).path == "/users/{id}"
        assert len(await endpoint_service.list_endpoints(project_id)) == 1
        assert await endpoint_service.count_endpoints(project_id) == 1
    async with factory() as session:
        updated = await EndpointService(session).update_endpoint(
            project_id, endpoint.id, EndpointUpdateRequest(enabled=False)
        )
        assert updated.enabled is False
    async with factory() as session:
        await EndpointService(session).delete_endpoint(project_id, endpoint.id)
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await EndpointService(session).get_endpoint(project_id, endpoint.id)


async def test_endpoint_of_another_project_is_not_found(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """An endpoint id under the wrong project cannot be read, edited or deleted."""
    owner = await _project(factory, "owner")
    other = await _project(factory, "other")
    async with factory() as session:
        endpoint = await EndpointService(session).create_endpoint(
            owner, EndpointCreateRequest(method="GET", path="/")
        )
    for call in (
        lambda service: service.get_endpoint(other, endpoint.id),
        lambda service: service.update_endpoint(other, endpoint.id, EndpointUpdateRequest()),
        lambda service: service.delete_endpoint(other, endpoint.id),
    ):
        async with factory() as session:
            with pytest.raises(NotFoundError):
                await call(EndpointService(session))


async def test_unknown_project_is_not_found(factory: async_sessionmaker[AsyncSession]) -> None:
    """Listing or creating under a missing project is a 404, not an empty page."""
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await EndpointService(session).list_endpoints(uuid4())
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await EndpointService(session).create_endpoint(
                uuid4(), EndpointCreateRequest(method="GET", path="/")
            )


async def _proxied_log(
    factory: async_sessionmaker[AsyncSession],
    project_id: UUID,
    *,
    recordable: bool,
    path: str = "/hello",
    query: str = "",
) -> UUID:
    async with factory() as session, session.begin():
        request_log = await RequestLogRepository(session).create(
            RequestLogCreateInternal(
                project_id=project_id,
                endpoint_id=None,
                method="GET",
                scheme="https",
                host="api.example.com",
                path=path,
                query_string=query,
                request_headers={},
                request_body="",
                response_status=200,
                matched=False,
                proxied=True,
                response_headers={"content-type": "text/plain"},
                response_body="hi",
                recordable=recordable,
                duration_ms=0,
            )
        )
    return request_log.id


async def test_create_endpoint_from_request_log(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """A recordable log becomes its project's endpoint; an unrecordable or foreign one does not."""
    project_id = await _project(factory, "demo")
    other = await _project(factory, "other")
    recordable = await _proxied_log(factory, project_id, recordable=True)
    unrecordable = await _proxied_log(factory, project_id, recordable=False)
    async with factory() as session:
        endpoint = await EndpointService(session).create_endpoint_from_request_log(
            project_id, recordable, EndpointRecordRequest()
        )
    assert (endpoint.path, endpoint.body, endpoint.headers) == (
        "/hello",
        "hi",
        {"content-type": "text/plain"},
    )
    assert (endpoint.match_query, endpoint.match_body) == ("", "")
    async with factory() as session:
        with pytest.raises(NotRecordableError):
            await EndpointService(session).create_endpoint_from_request_log(
                project_id, unrecordable, EndpointRecordRequest()
            )
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await EndpointService(session).create_endpoint_from_request_log(
                other, recordable, EndpointRecordRequest()
            )


async def test_create_endpoints_from_request_logs_reports_what_it_left_out(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """The newest copy of a request is saved; gone, unsavable, older and taken ones are named."""
    project_id = await _project(factory, "demo")
    async with factory() as session:
        await EndpointService(session).create_endpoint(
            project_id,
            EndpointCreateRequest(
                method="GET",
                host="api.example.com",
                path="/taken",
                match_query="",
                match_body="",
            ),
        )
    older = await _proxied_log(factory, project_id, recordable=True, query="b=2&a=1")
    newer = await _proxied_log(factory, project_id, recordable=True, query="a=1&b=2")
    unsavable = await _proxied_log(factory, project_id, recordable=False)
    taken = await _proxied_log(factory, project_id, recordable=True, path="/taken")
    missing = uuid4()
    async with factory() as session:
        created, skipped = await EndpointService(session).create_endpoints_from_request_logs(
            project_id,
            EndpointRecordManyRequest(request_log_ids=[older, newer, unsavable, taken, missing]),
        )
    assert [(endpoint.path, endpoint.match_query) for endpoint in created] == [
        ("/hello", "a=1&b=2")
    ]
    assert {skip.request_log_id: skip.reason for skip in skipped} == {
        missing: "not_found",
        taken: "conflict",
        unsavable: "not_recordable",
        older: "duplicate",
    }


async def test_clearing_a_condition_makes_the_route_open_again(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """A query condition is stored canonical; cleared, the route collides with an open twin."""
    project_id = await _project(factory, "demo")
    async with factory() as session:
        endpoint = await EndpointService(session).create_endpoint(
            project_id, EndpointCreateRequest(method="GET", path="/a", match_query="b=1&a=2")
        )
    assert endpoint.match_query == "a=2&b=1"
    async with factory() as session:
        await EndpointService(session).create_endpoint(
            project_id, EndpointCreateRequest(method="GET", path="/a")
        )
    async with factory() as session:
        with pytest.raises(IntegrityError):
            await EndpointService(session).update_endpoint(
                project_id, endpoint.id, EndpointUpdateRequest(match_query=None)
            )
