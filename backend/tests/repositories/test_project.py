"""ProjectRepository: queries and flushes only - the caller's transaction commits."""

from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.repositories.endpoint import EndpointRepository
from app.repositories.project import ProjectRepository
from app.schemas.endpoint import EndpointCreateInternal
from app.schemas.project import ProjectCreateRequest, ProjectUpdateRequest


async def test_create_and_read_back_by_id_and_slug(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """The mock resolves projects by slug, the admin API by id - both must find the row."""
    async with factory() as session, session.begin():
        repository = ProjectRepository(session)
        project = await repository.create(ProjectCreateRequest(name="Demo", slug="demo"))
        assert (await repository.get(project.id)) is project
        assert (await repository.get_by_slug("demo")) is project
        assert await repository.get_by_slug("other") is None


async def test_list_filters_sorts_and_counts(factory: async_sessionmaker[AsyncSession]) -> None:
    """Filter, sort and window apply in SQL, and the count ignores the window."""
    async with factory() as session, session.begin():
        repository = ProjectRepository(session)
        for name, slug in (("Beta", "b"), ("Alpha", "c"), ("Alphabet", "a")):
            await repository.create(ProjectCreateRequest(name=name, slug=slug))
        assert [p.name for p in await repository.list()] == ["Alpha", "Alphabet", "Beta"]
        by_slug = await repository.list(sort="slug", order="desc")
        assert [p.slug for p in by_slug] == ["c", "b", "a"]
        by_slug_asc = await repository.list(sort="slug")
        assert [p.slug for p in by_slug_asc] == ["a", "b", "c"]
        assert [p.name for p in await repository.list(name="alpha", limit=1)] == ["Alpha"]
        assert await repository.count(name="alpha") == 2
        assert await repository.count() == 3


async def test_update_and_delete_report_a_missing_row(
    factory: async_sessionmaker[AsyncSession],
) -> None:
    """A missing id is reported (None/False) so the service can answer 404, not crash."""
    async with factory() as session, session.begin():
        repository = ProjectRepository(session)
        assert await repository.update(uuid4(), ProjectUpdateRequest(name="x")) is None
        assert await repository.delete(uuid4()) is False
        project = await repository.create(ProjectCreateRequest(name="Demo", slug="demo"))
        updated = await repository.update(project.id, ProjectUpdateRequest(name="Renamed"))
        assert updated is not None
        assert updated.name == "Renamed"
        assert updated.slug == "demo"


async def test_delete_cascades_to_endpoints(factory: async_sessionmaker[AsyncSession]) -> None:
    """The database deletes a project's endpoints with it (foreign keys are enforced)."""
    async with factory() as session, session.begin():
        project = await ProjectRepository(session).create(
            ProjectCreateRequest(name="Demo", slug="demo")
        )
        endpoint = await EndpointRepository(session).create(
            EndpointCreateInternal(project_id=project.id, method="GET", path="/users")
        )
    async with factory() as session, session.begin():
        assert await ProjectRepository(session).delete(project.id) is True
    async with factory() as session:
        assert await EndpointRepository(session).get(endpoint.id) is None
