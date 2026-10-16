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
    MethodFilterQuery,
    OffsetQuery,
    OutcomeFilterQuery,
    StatusClassFilterQuery,
    TextFilterQuery,
)
from app.dependencies.services import EndpointServiceDep, RequestLogServiceDep
from app.schemas.endpoint import (
    EndpointReadResponse,
    EndpointRecordManyRequest,
    EndpointRecordManyResponse,
    EndpointRecordRequest,
)
from app.schemas.endpoint import to_read as endpoint_to_read
from app.schemas.endpoint import to_read_list as endpoint_to_read_list
from app.schemas.request_log import (
    RequestLogDetailResponse,
    RequestLogFilter,
    RequestLogReadResponse,
    VolatileFieldResponse,
    VolatileFieldsResponse,
    to_detail,
    to_read_list,
)


# ============================================================
# Router
# ============================================================

# A project's request log, nested under the project like its endpoints: no row
# exists outside one. Its own module because its filters narrow the request_log
# table, and a router's filters are read by the repository of its own domain.
router = APIRouter(
    prefix="/project",
    tags=["request_log"],
    responses={404: {"description": "Not found"}},
)


@router.get("/{project_id}/logs")
async def list_request_logs(
    project_id: UUID,
    request_log_service: RequestLogServiceDep,
    offset: OffsetQuery = 0,
    limit: LimitQuery = settings.items_per_user,
    method: MethodFilterQuery = None,
    status_class: StatusClassFilterQuery = None,
    outcome: OutcomeFilterQuery = None,
    path: TextFilterQuery = None,
    host: TextFilterQuery = None,
) -> Page[RequestLogReadResponse]:
    """One project's request log under the filters, newest first."""
    filters = RequestLogFilter(
        method=method or [],
        status_class=status_class or [],
        outcome=outcome or [],
        path=path,
        host=host,
    )
    return Page(
        items=to_read_list(
            await request_log_service.list_request_logs(project_id, filters, offset, limit)
        ),
        total=await request_log_service.count_request_logs(project_id, filters),
    )


# Declared before `/logs/{request_log_id}`: that route would take the word as an
# id and refuse it with a 422 instead of letting this one answer.
@router.get("/{project_id}/logs/volatile-fields")
async def list_volatile_fields(
    project_id: UUID, request_log_service: RequestLogServiceDep
) -> VolatileFieldsResponse:
    """The fields whose value changes between calls to one route - candidates to ignore."""
    fields = await request_log_service.list_volatile_fields(project_id)
    return VolatileFieldsResponse(
        fields=[VolatileFieldResponse(name=name, routes=routes) for name, routes in fields]
    )


@router.get("/{project_id}/logs/{request_log_id}")
async def get_request_log(
    project_id: UUID, request_log_id: UUID, request_log_service: RequestLogServiceDep
) -> RequestLogDetailResponse:
    """One logged request with the headers and body the list leaves out."""
    return to_detail(await request_log_service.get_request_log(project_id, request_log_id))


@router.get("/{project_id}/logs/{request_log_id}/response-body")
async def get_request_log_response_body(
    project_id: UUID, request_log_id: UUID, request_log_service: RequestLogServiceDep
) -> Response:
    """The real server's whole answer to a logged request - a stored file or the logged text."""
    content, content_type = await request_log_service.get_response_body(project_id, request_log_id)
    return Response(content=content, media_type=content_type)


@router.post("/{project_id}/logs/{request_log_id}/endpoint", status_code=status.HTTP_201_CREATED)
async def create_endpoint_from_request_log(
    project_id: UUID,
    request_log_id: UUID,
    data: EndpointRecordRequest,
    endpoint_service: EndpointServiceDep,
) -> EndpointReadResponse:
    """Save a recorded exchange as an endpoint of its project, at `data.path` if given."""
    return endpoint_to_read(
        await endpoint_service.create_endpoint_from_request_log(project_id, request_log_id, data)
    )


@router.post("/{project_id}/logs/endpoints")
async def create_endpoints_from_request_logs(
    project_id: UUID, data: EndpointRecordManyRequest, endpoint_service: EndpointServiceDep
) -> EndpointRecordManyResponse:
    """Save the selected recorded exchanges as endpoints; what could not be saved is reported."""
    created, skipped = await endpoint_service.create_endpoints_from_request_logs(project_id, data)
    return EndpointRecordManyResponse(created=endpoint_to_read_list(created), skipped=skipped)


@router.delete("/{project_id}/logs")
async def delete_request_logs(
    project_id: UUID, request_log_service: RequestLogServiceDep
) -> dict[str, bool]:
    await request_log_service.delete_request_logs(project_id)
    return {"ok": True}
