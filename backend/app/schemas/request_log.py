# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.timestamps import UtcDateTime
from app.engine.matcher import RequestMethod
from app.models.request_log import RequestLog


# ============================================================
# Constants
# ============================================================

#: A response status's hundreds digit: `"2"` is every 2xx. Text, because a query
#: string carries text and an int `Literal` refuses `"2"`.
StatusClass = Literal["1", "2", "3", "4", "5"]

#: Who answered a logged request: an endpoint, the upstream, or nobody.
LogOutcome = Literal["matched", "proxied", "unmatched"]


# ============================================================
# Classes
# ============================================================


class RequestLogCreateInternal(BaseModel):
    """One request as the proxy received and answered it - written by the server, never a client."""

    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    endpoint_id: UUID | None
    method: str
    scheme: str
    host: str
    path: str
    query_string: str
    request_headers: dict[str, str]
    request_body: str
    response_status: int
    matched: bool
    proxied: bool
    response_headers: dict[str, str] | None = None
    response_body: str | None = None
    response_body_ref: str | None = None
    response_size: int | None = None
    recordable: bool = False
    duration_ms: int


class RequestLogReadResponse(BaseModel):
    """A log row as the list shows it - without the headers and body a page need not carry."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    project_id: UUID
    endpoint_id: UUID | None
    method: str
    scheme: str
    host: str
    path: str
    query_string: str
    response_status: int
    matched: bool
    #: Answered by the real server (record mode): `matched` is false, the status is the server's.
    proxied: bool
    #: The exchange can be saved as an endpoint.
    recordable: bool
    #: The real server's answer in bytes; None for every other request.
    response_size: int | None
    duration_ms: int
    created_at: UtcDateTime
    updated_at: UtcDateTime
    version: int


class RequestLogDetailResponse(RequestLogReadResponse):
    request_headers: dict[str, str]
    request_body: str
    response_headers: dict[str, str] | None
    response_body: str | None
    #: The answer is kept whole (binary, or past the log limit): download it from `/response-body`.
    response_body_ref: str | None


class RequestLogFilter(BaseModel):
    """The log screen's filters: each list any-of, an empty list no filter; `host` and `path`
    contain the text."""

    model_config = ConfigDict(extra="forbid")

    method: list[RequestMethod] = Field(default_factory=list)
    status_class: list[StatusClass] = Field(default_factory=list)
    outcome: list[LogOutcome] = Field(default_factory=list)
    path: str | None = None
    host: str | None = None


class VolatileFieldResponse(BaseModel):
    """A query parameter or JSON key whose value changed between calls to one route."""

    model_config = ConfigDict(extra="forbid")

    name: str
    #: How many routes (method, host, path) it changed on in the log.
    routes: int


class VolatileFieldsResponse(BaseModel):
    """The fields the log suggests ignoring, most widespread first; ignored ones left out."""

    model_config = ConfigDict(extra="forbid")

    fields: list[VolatileFieldResponse]


# ============================================================
# Functions
# ============================================================


def to_read(request_log: RequestLog) -> RequestLogReadResponse:
    return RequestLogReadResponse.model_validate(request_log)


def to_read_list(request_logs: list[RequestLog]) -> list[RequestLogReadResponse]:
    return [to_read(request_log) for request_log in request_logs]


def to_detail(request_log: RequestLog) -> RequestLogDetailResponse:
    return RequestLogDetailResponse.model_validate(request_log)
