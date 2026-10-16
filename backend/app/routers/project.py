# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Response, status

from app.core.page import Page
from app.core.settings import settings
from app.dependencies.query import (
    LimitQuery,
    OffsetQuery,
    OrderQuery,
    ProjectSortQuery,
    TextFilterQuery,
)
from app.dependencies.services import EndpointServiceDep, ProjectServiceDep
from app.schemas.endpoint import (
    EndpointCreateRequest,
    EndpointReadResponse,
    EndpointUpdateRequest,
)
from app.schemas.endpoint import to_read as endpoint_to_read
from app.schemas.endpoint import to_read_list as endpoint_to_read_list
from app.schemas.project import ProjectCreateRequest, ProjectReadResponse, ProjectUpdateRequest
from app.schemas.project import to_read as project_to_read
from app.schemas.project import to_read_list as project_to_read_list


# ============================================================
# Router
# ============================================================

# A project and the endpoints it mocks, nested under their parent's id because
# none exists outside a project. Its request log is nested the same way, in
# `routers/request_log.py`.
router = APIRouter(
    prefix="/project",
    tags=["project"],
    responses={404: {"description": "Not found"}},
)


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_project(
    data: ProjectCreateRequest, project_service: ProjectServiceDep
) -> ProjectReadResponse:
    project = await project_service.create_project(data)
    return project_to_read(project, {})


@router.get("/")
async def list_projects(
    project_service: ProjectServiceDep,
    offset: OffsetQuery = 0,
    limit: LimitQuery = settings.items_per_user,
    name: TextFilterQuery = None,
    sort: ProjectSortQuery = None,
    order: OrderQuery = "asc",
) -> Page[ProjectReadResponse]:
    projects = await project_service.list_projects(offset, limit, name, sort, order)
    counts = await project_service.count_project_endpoints([project.id for project in projects])
    return Page(
        items=project_to_read_list(projects, counts),
        total=await project_service.count_projects(name),
    )


@router.get("/{project_id}")
async def get_project(project_id: UUID, project_service: ProjectServiceDep) -> ProjectReadResponse:
    project = await project_service.get_project(project_id)
    counts = await project_service.count_project_endpoints([project.id])
    return project_to_read(project, counts)


@router.patch("/{project_id}")
async def update_project(
    project_id: UUID, data: ProjectUpdateRequest, project_service: ProjectServiceDep
) -> ProjectReadResponse:
    project = await project_service.update_project(project_id, data)
    counts = await project_service.count_project_endpoints([project.id])
    return project_to_read(project, counts)


@router.delete("/{project_id}")
async def delete_project(project_id: UUID, project_service: ProjectServiceDep) -> dict[str, bool]:
    await project_service.delete_project(project_id)
    return {"ok": True}


@router.post("/{project_id}/endpoints", status_code=status.HTTP_201_CREATED)
async def create_endpoint(
    project_id: UUID, data: EndpointCreateRequest, endpoint_service: EndpointServiceDep
) -> EndpointReadResponse:
    return endpoint_to_read(await endpoint_service.create_endpoint(project_id, data))


@router.get("/{project_id}/endpoints")
async def list_endpoints(
    project_id: UUID,
    endpoint_service: EndpointServiceDep,
    offset: OffsetQuery = 0,
    limit: LimitQuery = settings.items_per_user,
) -> Page[EndpointReadResponse]:
    return Page(
        items=endpoint_to_read_list(
            await endpoint_service.list_endpoints(project_id, offset, limit)
        ),
        total=await endpoint_service.count_endpoints(project_id),
    )


@router.get("/{project_id}/endpoints/{endpoint_id}")
async def get_endpoint(
    project_id: UUID, endpoint_id: UUID, endpoint_service: EndpointServiceDep
) -> EndpointReadResponse:
    return endpoint_to_read(await endpoint_service.get_endpoint(project_id, endpoint_id))


@router.get("/{project_id}/endpoints/{endpoint_id}/body")
async def get_endpoint_body(
    project_id: UUID, endpoint_id: UUID, endpoint_service: EndpointServiceDep
) -> Response:
    """What the endpoint answers with - its stored file, or its body template as typed."""
    content, content_type = await endpoint_service.get_endpoint_body(project_id, endpoint_id)
    return Response(content=content, media_type=content_type)


@router.patch("/{project_id}/endpoints/{endpoint_id}")
async def update_endpoint(
    project_id: UUID,
    endpoint_id: UUID,
    data: EndpointUpdateRequest,
    endpoint_service: EndpointServiceDep,
) -> EndpointReadResponse:
    return endpoint_to_read(await endpoint_service.update_endpoint(project_id, endpoint_id, data))


@router.delete("/{project_id}/endpoints/{endpoint_id}")
async def delete_endpoint(
    project_id: UUID, endpoint_id: UUID, endpoint_service: EndpointServiceDep
) -> dict[str, bool]:
    await endpoint_service.delete_endpoint(project_id, endpoint_id)
    return {"ok": True}
