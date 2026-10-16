# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import re
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.core.settings import MAX_DELAY_MS
from app.core.timestamps import UtcDateTime
from app.engine.matcher import EndpointMethod, normalize_path, pattern_problem
from app.models.endpoint import Endpoint


# ============================================================
# Constants
# ============================================================

PATH_MAX_LENGTH = 500
DESCRIPTION_MAX_LENGTH = 512
DEFAULT_STATUS_CODE = 200
MIN_STATUS_CODE = 100
MAX_STATUS_CODE = 599

#: An HTTP header name (RFC 9110 `token`). A name outside it is refused by the
#: server only when the mock answers - long after the form that saved it.
HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")

#: What a header value may not hold: a line break would end the header early.
HEADER_VALUE_BREAK = re.compile(r"[\r\n]")


# ============================================================
# Classes
# ============================================================


class EndpointBase(BaseModel):
    """The fields every direction shares - without rules, so an old row stays readable."""

    model_config = ConfigDict(extra="forbid")

    method: EndpointMethod
    path: str
    status_code: int = DEFAULT_STATUS_CODE
    headers: dict[str, str] = Field(default_factory=dict)
    body: str = ""
    delay_ms: int = 0
    enabled: bool = True
    description: str = ""


class EndpointCreateRequest(EndpointBase):
    path: str = Field(min_length=1, max_length=PATH_MAX_LENGTH)
    status_code: int = Field(default=DEFAULT_STATUS_CODE, ge=MIN_STATUS_CODE, le=MAX_STATUS_CODE)
    delay_ms: int = Field(default=0, ge=0, le=MAX_DELAY_MS)
    description: str = Field(default="", max_length=DESCRIPTION_MAX_LENGTH)

    @field_validator("path")
    @classmethod
    def _check_path(cls, value: str) -> str:
        problem = pattern_problem(value)
        if problem is not None:
            raise ValueError(problem)
        return normalize_path(value)

    @field_validator("headers")
    @classmethod
    def _check_headers(cls, value: dict[str, str]) -> dict[str, str]:
        problem = _headers_problem(value)
        if problem is not None:
            raise ValueError(problem)
        return value


class EndpointCreateInternal(EndpointBase):
    project_id: UUID


class EndpointReadResponse(EndpointBase):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    project_id: UUID
    created_at: UtcDateTime
    updated_at: UtcDateTime
    version: int


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

    @field_validator("path")
    @classmethod
    def _check_path(cls, value: str | None) -> str | None:
        if value is None:
            return None
        problem = pattern_problem(value)
        if problem is not None:
            raise ValueError(problem)
        return normalize_path(value)

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


def _headers_problem(headers: dict[str, str]) -> str | None:
    """Why `headers` cannot be sent as response headers, or None when they can."""
    for name, value in headers.items():
        if HEADER_NAME.match(name) is None:
            return f"header name {name!r} is not a valid HTTP token"
        if HEADER_VALUE_BREAK.search(value) is not None:
            return f"header {name!r} has a line break in its value"
    return None
