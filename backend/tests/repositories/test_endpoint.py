"""EndpointRepository: one project's endpoints, and the counts the project list shows."""

from uuid import UUID, uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.repositories.endpoint import EndpointRepository
from app.repositories.project import ProjectRepository
from app.schemas.endpoint import EndpointCreateInternal, EndpointUpdateRequest
from app.schemas.project import ProjectCreateRequest


async def _project(session: AsyncSession, slug: str) -> UUID:
    project = await ProjectRepository(session).create(ProjectCreateRequest(name=slug, slug=slug))
    return project.id


async def test_list_counts_and_enabled_subset(factory: async_sessionmaker[AsyncSession]) -> None:
    """Listing is per project and path-ordered; matching reads only the enabled endpoints."""
    async with factory() as session, session.begin():
        repository = EndpointRepository(session)
        first = await _project(session, "first")
        second = await _project(session, "second")
        await repository.create(EndpointCreateInternal(project_id=first, method="GET", path="/b"))
        await repository.create(
            EndpointCreateInternal(project_id=first, method="GET", path="/a", enabled=False)
        )
        await repository.create(EndpointCreateInternal(project_id=second, method="GET", path="/c"))
        assert [e.path for e in await repository.list_by_project(first)] == ["/a", "/b"]
        assert [e.path for e in await repository.list_enabled_by_project(first)] == ["/b"]
        assert await repository.count_by_project(first) == 2
        counts = await repository.count_by_project_ids([first, second, uuid4()])
        assert counts == {first: 2, second: 1}
        assert await repository.count_by_project_ids([]) == {}


async def test_update_and_delete(factory: async_sessionmaker[AsyncSession]) -> None:
    """A PATCH changes only the fields it names; a missing id is reported, not raised."""
    async with factory() as session, session.begin():
        repository = EndpointRepository(session)
        project_id = await _project(session, "demo")
        endpoint = await repository.create(
            EndpointCreateInternal(project_id=project_id, method="GET", path="/a", body="x")
        )
        updated = await repository.update(endpoint.id, EndpointUpdateRequest(status_code=418))
        assert updated is not None
        assert (updated.status_code, updated.body) == (418, "x")
        assert await repository.update(uuid4(), EndpointUpdateRequest(body="y")) is None
        assert await repository.delete(endpoint.id) is True
        await session.flush()
        assert await repository.delete(endpoint.id) is False
