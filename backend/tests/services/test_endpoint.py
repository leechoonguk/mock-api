"""EndpointService: endpoints are reached only through their own project."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.exceptions import NotFoundError
from app.schemas.endpoint import EndpointCreateRequest, EndpointUpdateRequest
from app.schemas.project import ProjectCreateRequest
from app.services.endpoint import EndpointService
from app.services.project import ProjectService


async def _project(factory: async_sessionmaker[AsyncSession], slug: str) -> UUID:
    async with factory() as session:
        project = await ProjectService(session).create_project(
            ProjectCreateRequest(name=slug, slug=slug)
        )
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
