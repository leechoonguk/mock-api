"""RequestLogRepository: the append-only log, its filters, newest-first order and retention trim."""

from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.repositories.project import ProjectRepository
from app.repositories.request_log import RequestLogRepository
from app.schemas.project import ProjectCreateRequest
from app.schemas.request_log import RequestLogCreateInternal, RequestLogFilter


EVERYTHING = RequestLogFilter()


def _entry(
    project_id: UUID,
    path: str,
    *,
    method: str = "GET",
    status: int = 404,
    matched: bool = False,
    proxied: bool = False,
    host: str = "api.example.com",
) -> RequestLogCreateInternal:
    return RequestLogCreateInternal(
        project_id=project_id,
        endpoint_id=None,
        method=method,
        scheme="https",
        host=host,
        path=path,
        query_string="",
        request_headers={},
        request_body="",
        response_status=status,
        matched=matched,
        proxied=proxied,
        duration_ms=1,
    )


async def test_log_lists_newest_first_and_trims_overflow(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """Rows of one second still list in arrival order, and the trim keeps the newest."""
    async with factory() as session, session.begin():
        project = await ProjectRepository(session).create(ProjectCreateRequest(name="Demo"))
        repository = RequestLogRepository(session)
        created = [await repository.create(_entry(project.id, f"/{n}")) for n in range(4)]
        assert [log.path for log in await repository.list_by_project(project.id, EVERYTHING)] == [
            "/3",
            "/2",
            "/1",
            "/0",
        ]
        assert await repository.delete_overflow(project.id, keep=2) == 2
        kept = await repository.list_by_project(project.id, EVERYTHING)
        assert [log.path for log in kept] == ["/3", "/2"]
        assert await repository.count_by_project(project.id, EVERYTHING) == 2
        assert (await repository.get(created[3].id)) is created[3]
        assert await repository.delete_by_project(project.id) == 2
        assert await repository.count_by_project(project.id, EVERYTHING) == 0


async def test_log_filters_narrow_list_and_count_alike(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """Each list filter is any-of, filters combine with AND, and the count agrees with the list."""
    async with factory() as session, session.begin():
        projects = ProjectRepository(session)
        project = await projects.create(ProjectCreateRequest(name="Demo"))
        other = await projects.create(ProjectCreateRequest(name="Other"))
        repository = RequestLogRepository(session)
        await repository.create(_entry(project.id, "/users/1", status=200, matched=True))
        await repository.create(
            _entry(project.id, "/orders/1", method="POST", status=201, proxied=True)
        )
        await repository.create(_entry(project.id, "/orders/2", status=502, proxied=True))
        await repository.create(_entry(project.id, "/missing", status=404, host="i.ytimg.com"))
        await repository.create(_entry(other.id, "/orders/9", status=200, proxied=True))

        async def paths(filters: RequestLogFilter) -> list[str]:
            rows = await repository.list_by_project(project.id, filters)
            assert await repository.count_by_project(project.id, filters) == len(rows)
            return [row.path for row in rows]

        assert await paths(RequestLogFilter(method=["POST"])) == ["/orders/1"]
        assert await paths(RequestLogFilter(status_class=["2", "5"])) == [
            "/orders/2",
            "/orders/1",
            "/users/1",
        ]
        assert await paths(RequestLogFilter(outcome=["proxied"])) == ["/orders/2", "/orders/1"]
        assert await paths(RequestLogFilter(outcome=["matched", "unmatched"])) == [
            "/missing",
            "/users/1",
        ]
        assert await paths(RequestLogFilter(path="ORDERS", status_class=["2"])) == ["/orders/1"]
        assert await paths(RequestLogFilter(host="YTIMG")) == ["/missing"]


async def test_list_by_ids_keeps_to_the_project(factory: async_sessionmaker[AsyncSession]) -> None:
    """Only the project's own rows among the ids come back, newest first."""
    async with factory() as session, session.begin():
        projects = ProjectRepository(session)
        project = await projects.create(ProjectCreateRequest(name="Demo"))
        other = await projects.create(ProjectCreateRequest(name="Other"))
        repository = RequestLogRepository(session)
        first = await repository.create(_entry(project.id, "/a"))
        second = await repository.create(_entry(project.id, "/b"))
        foreign = await repository.create(_entry(other.id, "/c"))
        rows = await repository.list_by_ids(project.id, [first.id, second.id, foreign.id, uuid4()])
        assert [row.path for row in rows] == ["/b", "/a"]
