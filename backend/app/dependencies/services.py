# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.dependencies.core import SessionDep
from app.services.endpoint import EndpointService
from app.services.project import ProjectService
from app.services.request_log import RequestLogService


# ============================================================
# Functions
# ============================================================


def get_project_service(session: SessionDep) -> ProjectService:
    return ProjectService(session)


def get_endpoint_service(session: SessionDep) -> EndpointService:
    return EndpointService(session)


def get_request_log_service(session: SessionDep) -> RequestLogService:
    return RequestLogService(session)


# ============================================================
# Dependencies
# ============================================================

ProjectServiceDep = Annotated[ProjectService, Depends(get_project_service)]
EndpointServiceDep = Annotated[EndpointService, Depends(get_endpoint_service)]
RequestLogServiceDep = Annotated[RequestLogService, Depends(get_request_log_service)]
