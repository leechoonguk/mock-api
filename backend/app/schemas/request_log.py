# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.timestamps import UtcDateTime
from app.models.request_log import RequestLog


# ============================================================
# Classes
# ============================================================


class RequestLogCreateInternal(BaseModel):
    """One request as the mock received and answered it - written by the server, never a client."""

    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    endpoint_id: UUID | None
    method: str
    path: str
    query_string: str
    request_headers: dict[str, str]
    request_body: str
    response_status: int
    matched: bool
    duration_ms: int


class RequestLogReadResponse(BaseModel):
    """A log row as the list shows it - without the headers and body a page need not carry."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    project_id: UUID
    endpoint_id: UUID | None
    method: str
    path: str
    query_string: str
    response_status: int
    matched: bool
    duration_ms: int
    created_at: UtcDateTime
    updated_at: UtcDateTime
    version: int


class RequestLogDetailResponse(RequestLogReadResponse):
    request_headers: dict[str, str]
    request_body: str


# ============================================================
# Functions
# ============================================================


def to_read(request_log: RequestLog) -> RequestLogReadResponse:
    return RequestLogReadResponse.model_validate(request_log)


def to_read_list(request_logs: list[RequestLog]) -> list[RequestLogReadResponse]:
    return [to_read(request_log) for request_log in request_logs]


def to_detail(request_log: RequestLog) -> RequestLogDetailResponse:
    return RequestLogDetailResponse.model_validate(request_log)
