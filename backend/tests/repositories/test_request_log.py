"""RequestLogRepository: the append-only log, its newest-first order and its retention trim."""

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.repositories.project import ProjectRepository
from app.repositories.request_log import RequestLogRepository
from app.schemas.project import ProjectCreateRequest
from app.schemas.request_log import RequestLogCreateInternal


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
        duration_ms=1,
    )


async def test_log_lists_newest_first_and_trims_overflow(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """Rows of one second still list in arrival order, and the trim keeps the newest."""
    async with factory() as session, session.begin():
        project = await ProjectRepository(session).create(
            ProjectCreateRequest(name="Demo", slug="demo")
        )
        repository = RequestLogRepository(session)
        created = [await repository.create(_entry(project.id, f"/{n}")) for n in range(4)]
        assert [log.path for log in await repository.list_by_project(project.id)] == [
            "/3",
            "/2",
            "/1",
            "/0",
        ]
        assert await repository.delete_overflow(project.id, keep=2) == 2
        assert [log.path for log in await repository.list_by_project(project.id)] == ["/3", "/2"]
        assert await repository.count_by_project(project.id) == 2
        assert (await repository.get(created[3].id)) is created[3]
        assert await repository.delete_by_project(project.id) == 2
        assert await repository.count_by_project(project.id) == 0
