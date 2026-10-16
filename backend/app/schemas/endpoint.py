# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import re
from collections.abc import Collection
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
)

from app.core.body_store import BODY_REF
from app.core.settings import MAX_DELAY_MS, MAX_LOG_BODY_BYTES
from app.core.timestamps import UtcDateTime
from app.engine.hosts import HOST_MAX_LENGTH, host_problem, normalize_host
from app.engine.matcher import (
    ANY_HOST,
    EndpointMethod,
    canonical_query,
    normalize_path,
    pattern_problem,
    strip_body,
    strip_query,
)
from app.models.endpoint import Endpoint


# ============================================================
# Constants
# ============================================================

PATH_MAX_LENGTH = 500
DESCRIPTION_MAX_LENGTH = 512
DEFAULT_STATUS_CODE = 200
MIN_STATUS_CODE = 100
MAX_STATUS_CODE = 599
MATCH_QUERY_MAX_LENGTH = 2048

#: How many logged exchanges one bulk save takes - a page of the log.
RECORD_MANY_MAX = 100

#: Why a bulk save left a selected log out: gone, not savable, an older copy of
#: another selected request, or a route the project already has.
RecordSkipReason = Literal["not_found", "not_recordable", "duplicate", "conflict"]

#: An HTTP header name (RFC 9110 `token`). A name outside it is refused by the
#: server only when the mock answers - long after the form that saved it.
HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")

#: What a header value may not hold: a line break would end the header early.
HEADER_VALUE_BREAK = re.compile(r"[\r\n]")

#: The description of an endpoint saved from an upstream's answer.
RECORDED_DESCRIPTION = "Recorded from the upstream response"

#: A query condition, stored in its one spelling so the screen shows what is compared.
MatchQuery = Annotated[
    str | None,
    Field(max_length=MATCH_QUERY_MAX_LENGTH),
    AfterValidator(lambda value: None if value is None else canonical_query(value)),
]

#: A body condition: exact text, or JSON compared whatever its spelling.
MatchBody = Annotated[str | None, Field(max_length=MAX_LOG_BODY_BYTES)]


# ============================================================
# Classes
# ============================================================


class EndpointBase(BaseModel):
    """The fields every direction shares - without rules, so an old row stays readable."""

    model_config = ConfigDict(extra="forbid")

    method: EndpointMethod
    #: The host it answers on; `ANY_HOST` ("") for every host of its project.
    host: str = ANY_HOST
    path: str
    status_code: int = DEFAULT_STATUS_CODE
    headers: dict[str, str] = Field(default_factory=dict)
    body: str = ""
    #: A recorded answer kept whole in the body store; when set, answered instead of `body`.
    body_ref: str | None = None
    delay_ms: int = 0
    enabled: bool = True
    description: str = ""
    #: The query the request must carry exactly; None answers any query.
    match_query: str | None = None
    #: The body the request must carry exactly; None answers any body.
    match_body: str | None = None


class EndpointCreateRequest(EndpointBase):
    host: str = Field(default=ANY_HOST, max_length=HOST_MAX_LENGTH)
    path: str = Field(min_length=1, max_length=PATH_MAX_LENGTH)
    status_code: int = Field(default=DEFAULT_STATUS_CODE, ge=MIN_STATUS_CODE, le=MAX_STATUS_CODE)
    delay_ms: int = Field(default=0, ge=0, le=MAX_DELAY_MS)
    description: str = Field(default="", max_length=DESCRIPTION_MAX_LENGTH)
    match_query: MatchQuery = None
    match_body: MatchBody = None
    body_ref: str | None = Field(default=None, pattern=BODY_REF.pattern)

    @field_validator("path")
    @classmethod
    def _check_path(cls, value: str) -> str:
        problem = pattern_problem(value)
        if problem is not None:
            raise ValueError(problem)
        return normalize_path(value)

    @field_validator("host")
    @classmethod
    def _check_host(cls, value: str) -> str:
        host = normalize_host(value)
        problem = None if host == ANY_HOST else host_problem(host, wildcard=False)
        if problem is not None:
            raise ValueError(problem)
        return host

    @field_validator("headers")
    @classmethod
    def _check_headers(cls, value: dict[str, str]) -> dict[str, str]:
        problem = _headers_problem(value)
        if problem is not None:
            raise ValueError(problem)
        return value


class EndpointCreateInternal(EndpointBase):
    project_id: UUID


class EndpointRecordRequest(BaseModel):
    """Save a proxied request's upstream answer as an endpoint; `path` replaces the logged path
    (e.g. `/users/7` → `/users/{id}`), absent or null keeps it."""

    model_config = ConfigDict(extra="forbid")

    path: str | None = Field(default=None, min_length=1, max_length=PATH_MAX_LENGTH)

    @field_validator("path")
    @classmethod
    def _check_path(cls, value: str | None) -> str | None:
        problem = None if value is None else pattern_problem(value)
        if problem is not None:
            raise ValueError(problem)
        return value if value is None else normalize_path(value)


class EndpointReadResponse(EndpointBase):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    project_id: UUID
    created_at: UtcDateTime
    updated_at: UtcDateTime
    version: int


class EndpointRecordManyRequest(BaseModel):
    """Save several logged exchanges as endpoints, each at its logged path and conditions."""

    model_config = ConfigDict(extra="forbid")

    request_log_ids: list[UUID] = Field(min_length=1, max_length=RECORD_MANY_MAX)


class RecordSkip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    request_log_id: UUID
    reason: RecordSkipReason


class EndpointRecordManyResponse(BaseModel):
    """What a bulk save created, and each selected log it left out with the reason."""

    model_config = ConfigDict(extra="forbid")

    created: list[EndpointReadResponse]
    skipped: list[RecordSkip]


class EndpointUpdateRequest(BaseModel):
    """Every field optional: a PATCH names only what it changes (the enabled switch alone)."""

    model_config = ConfigDict(extra="forbid")

    method: EndpointMethod | None = None
    path: str | None = Field(default=None, min_length=1, max_length=PATH_MAX_LENGTH)
    status_code: int | None = Field(default=None, ge=MIN_STATUS_CODE, le=MAX_STATUS_CODE)
    headers: dict[str, str] | None = None
    body: str | None = None
    delay_ms: int | None = Field(default=None, ge=0, le=MAX_DELAY_MS)
    enabled: bool | None = None
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)
    # "" answers on every host of the project again; `null` leaves the host.
    host: str | None = Field(default=None, max_length=HOST_MAX_LENGTH)
    # `null` clears a condition: the endpoint answers any query or body again.
    match_query: MatchQuery = None
    match_body: MatchBody = None
    # Only ever cleared (`null`): the endpoint answers its typed `body` again.
    body_ref: None = None

    @field_validator("path")
    @classmethod
    def _check_path(cls, value: str | None) -> str | None:
        if value is None:
            return None
        problem = pattern_problem(value)
        if problem is not None:
            raise ValueError(problem)
        return normalize_path(value)

    @field_validator("host")
    @classmethod
    def _check_host(cls, value: str | None) -> str | None:
        host = None if value is None else normalize_host(value)
        problem = None if not host else host_problem(host, wildcard=False)
        if problem is not None:
            raise ValueError(problem)
        return host

    @field_validator("headers")
    @classmethod
    def _check_headers(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        problem = None if value is None else _headers_problem(value)
        if problem is not None:
            raise ValueError(problem)
        return value


# ============================================================
# Functions
# ============================================================


def to_read(endpoint: Endpoint) -> EndpointReadResponse:
    return EndpointReadResponse.model_validate(endpoint)


def to_read_list(endpoints: list[Endpoint]) -> list[EndpointReadResponse]:
    return [to_read(endpoint) for endpoint in endpoints]


def recorded_endpoint(
    method: str,
    host: str,
    path: str,
    query: str,
    request_body: str,
    status_code: int,
    headers: dict[str, str],
    body: str,
    body_ref: str | None,
    ignored: Collection[str],
) -> EndpointCreateRequest | None:
    """The endpoint that answers this exact request as the real server did, or None.

    The answer is `body`, or with `body_ref` the bytes kept whole in the body
    store (a binary or long answer). The request's query and body become the
    endpoint's conditions, so a replay answers only the request that was
    recorded - less the `ignored` fields, the values a client changes on every
    call. Built through EndpointCreateRequest, so a recorded endpoint obeys
    every rule a typed one does: a path the matcher cannot hold, a status
    outside 100-599 or an unsendable header makes the exchange unrecordable
    instead of failing later.
    """
    try:
        return EndpointCreateRequest.model_validate(
            {
                "method": method,
                "host": host,
                "path": path,
                "status_code": status_code,
                "headers": headers,
                "body": body,
                "body_ref": body_ref,
                "match_query": strip_query(query, ignored),
                "match_body": strip_body(request_body, ignored),
                "description": RECORDED_DESCRIPTION,
            }
        )
    except ValidationError:
        return None


def _headers_problem(headers: dict[str, str]) -> str | None:
    """Why `headers` cannot be sent as response headers, or None when they can."""
    for name, value in headers.items():
        if HEADER_NAME.match(name) is None:
            return f"header name {name!r} is not a valid HTTP token"
        if HEADER_VALUE_BREAK.search(value) is not None:
            return f"header {name!r} has a line break in its value"
    return None
