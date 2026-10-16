"""RequestLogService: one project's log, read and cleared through the project."""

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.body_store import body_store
from app.core.exceptions import NotFoundError
from app.repositories.request_log import RequestLogRepository
from app.schemas.project import ProjectCreateRequest
from app.schemas.request_log import RequestLogCreateInternal, RequestLogFilter
from app.services.project import ProjectService
from app.services.request_log import RequestLogService


EVERYTHING = RequestLogFilter()


async def test_request_log_read_and_clear(factory: async_sessionmaker[AsyncSession]) -> None:
    """The log reads per project and a clear empties it; other projects' ids stay hidden."""
    async with factory() as session:
        project_service = ProjectService(session)
        project = await project_service.create_project(ProjectCreateRequest(name="Demo"))
    async with factory() as session:
        other = await ProjectService(session).create_project(ProjectCreateRequest(name="Other"))
    async with factory() as session, session.begin():
        await RequestLogRepository(session).create(
            RequestLogCreateInternal(
                project_id=project.id,
                endpoint_id=None,
                method="GET",
                path="/x",
                query_string="a=1",
                scheme="https",
                host="api.example.com",
                request_headers={"x-a": "1"},
                request_body="",
                response_status=404,
                matched=False,
                proxied=False,
                duration_ms=3,
            )
        )
    async with factory() as session:
        request_log_service = RequestLogService(session)
        logs = await request_log_service.list_request_logs(project.id, EVERYTHING)
        assert [log.path for log in logs] == ["/x"]
        assert await request_log_service.count_request_logs(project.id, EVERYTHING) == 1
        detail = await request_log_service.get_request_log(project.id, logs[0].id)
        assert detail.request_headers == {"x-a": "1"}
        with pytest.raises(NotFoundError):
            await request_log_service.get_request_log(other.id, logs[0].id)
    async with factory() as session:
        await RequestLogService(session).delete_request_logs(project.id)
    async with factory() as session:
        assert await RequestLogService(session).count_request_logs(project.id, EVERYTHING) == 0


async def test_unknown_project_is_not_found(factory: async_sessionmaker[AsyncSession]) -> None:
    """A missing project answers 404 rather than an empty log that reads as never called."""
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await RequestLogService(session).list_request_logs(uuid4(), EVERYTHING)
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await RequestLogService(session).delete_request_logs(uuid4())


async def test_volatile_fields_come_from_the_projects_own_log(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """Calls to one route are compared across the whole log; an ignored name is not offered."""
    async with factory() as session:
        project = await ProjectService(session).create_project(
            ProjectCreateRequest(name="Tube", ignored_fields=["rn"])
        )
    async with factory() as session, session.begin():
        repository = RequestLogRepository(session)
        for cpn, rn in (("a", "1"), ("b", "2")):
            await repository.create(
                RequestLogCreateInternal(
                    project_id=project.id,
                    endpoint_id=None,
                    method="GET",
                    scheme="https",
                    host="www.youtube.com",
                    path="/watch",
                    query_string=f"v=1&cpn={cpn}&rn={rn}",
                    request_headers={},
                    request_body="",
                    response_status=200,
                    matched=False,
                    proxied=True,
                    duration_ms=1,
                )
            )
    async with factory() as session:
        assert await RequestLogService(session).list_volatile_fields(project.id) == [("cpn", 1)]


async def test_response_body_is_the_stored_copy_or_the_logged_text(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """A stored answer reads whole, a logged one as its text; no answer or a lost file is 404."""
    async with factory() as session:
        project = await ProjectService(session).create_project(ProjectCreateRequest(name="Bodies"))
    stored = body_store().put(b"\x89PNG")
    answers = [
        ({"content-type": "image/png"}, "\ufffdPNG", stored),
        ({}, "hi", None),
        (None, None, None),
        ({}, "", "0" * 64),
    ]
    async with factory() as session, session.begin():
        repository = RequestLogRepository(session)
        ids = [
            (
                await repository.create(
                    RequestLogCreateInternal(
                        project_id=project.id,
                        endpoint_id=None,
                        method="GET",
                        scheme="https",
                        host="api.example.com",
                        path=f"/{index}",
                        query_string="",
                        request_headers={},
                        request_body="",
                        response_status=200,
                        matched=False,
                        proxied=headers is not None,
                        response_headers=headers,
                        response_body=body,
                        response_body_ref=ref,
                        duration_ms=1,
                    )
                )
            ).id
            for index, (headers, body, ref) in enumerate(answers)
        ]
    async with factory() as session:
        service = RequestLogService(session)
        assert await service.get_response_body(project.id, ids[0]) == (b"\x89PNG", "image/png")
        text = await service.get_response_body(project.id, ids[1])
        assert text == (b"hi", "application/octet-stream")
        for missing in ids[2:]:
            with pytest.raises(NotFoundError):
                await service.get_response_body(project.id, missing)
