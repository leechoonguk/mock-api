"""ProjectService: 404 for unknown ids, one transaction per write, endpoint counts by id."""

from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.exceptions import NotFoundError
from app.schemas.endpoint import EndpointCreateRequest
from app.schemas.project import ProjectCreateRequest, ProjectUpdateRequest
from app.services.endpoint import EndpointService
from app.services.project import ProjectService


async def test_project_lifecycle(factory: async_sessionmaker[AsyncSession]) -> None:
    """Create, read, list, count, update and delete all go through the service's own rules."""
    async with factory() as session:
        project = await ProjectService(session).create_project(
            ProjectCreateRequest(name="Demo", slug="demo")
        )
    async with factory() as session:
        project_service = ProjectService(session)
        assert (await project_service.get_project(project.id)).slug == "demo"
        assert [p.id for p in await project_service.list_projects(name="dem")] == [project.id]
        assert await project_service.count_projects() == 1
    async with factory() as session:
        updated = await ProjectService(session).update_project(
            project.id, ProjectUpdateRequest(name="Renamed")
        )
        assert updated.name == "Renamed"
    async with factory() as session:
        await ProjectService(session).delete_project(project.id)
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await ProjectService(session).get_project(project.id)


async def test_unknown_project_is_not_found(factory: async_sessionmaker[AsyncSession]) -> None:
    """Update and delete of a missing id raise NotFoundError, which the API answers 404."""
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await ProjectService(session).update_project(uuid4(), ProjectUpdateRequest(name="x"))
    async with factory() as session:
        with pytest.raises(NotFoundError):
            await ProjectService(session).delete_project(uuid4())


async def test_taken_slug_raises_integrity_error(factory: async_sessionmaker[AsyncSession]) -> None:
    """The constraint, not a pre-check, refuses a duplicate - so a race cannot slip past."""
    async with factory() as session:
        await ProjectService(session).create_project(ProjectCreateRequest(name="A", slug="demo"))
    async with factory() as session:
        with pytest.raises(IntegrityError):
            await ProjectService(session).create_project(
                ProjectCreateRequest(name="B", slug="demo")
            )


async def test_count_project_endpoints(factory: async_sessionmaker[AsyncSession]) -> None:
    """The list column's counts come back keyed by project id, absent for a project with none."""
    async with factory() as session:
        busy = await ProjectService(session).create_project(
            ProjectCreateRequest(name="Busy", slug="busy")
        )
    async with factory() as session:
        idle = await ProjectService(session).create_project(
            ProjectCreateRequest(name="Idle", slug="idle")
        )
    async with factory() as session:
        await EndpointService(session).create_endpoint(
            busy.id, EndpointCreateRequest(method="GET", path="/a")
        )
    async with factory() as session:
        counts = await ProjectService(session).count_project_endpoints([busy.id, idle.id])
    assert counts == {busy.id: 1}
