# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from collections.abc import Mapping
from typing import Annotated, cast
from uuid import UUID

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
)

from app.core.timestamps import UtcDateTime
from app.engine.hosts import host_problem, normalize_host
from app.models.project import MOCK_MODE, Project, ProjectMode


# ============================================================
# Constants
# ============================================================

NAME_MAX_LENGTH = 120
DESCRIPTION_MAX_LENGTH = 512

#: How many host patterns one project intercepts - a site and its API and CDN hosts.
HOSTS_MAX = 20

#: How many fields one project ignores when matching, and how long a field name is.
IGNORED_FIELDS_MAX = 50
IGNORED_FIELD_MAX_LENGTH = 100

#: A query parameter or JSON key name to ignore: trimmed, never blank.
IgnoredField = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=IGNORED_FIELD_MAX_LENGTH)
]

#: The whole list, each name once in the order first given.
IgnoredFields = Annotated[
    list[IgnoredField],
    Field(max_length=IGNORED_FIELDS_MAX),
    AfterValidator(lambda names: list(dict.fromkeys(names))),
]


# ============================================================
# Classes
# ============================================================


class ProjectBase(BaseModel):
    """The fields every direction shares - without rules, so an old row stays readable."""

    model_config = ConfigDict(extra="forbid")

    name: str
    description: str = ""
    hosts: list[str] = Field(default_factory=list)
    #: Query parameter names and JSON keys left out when a request is recorded and matched.
    ignored_fields: list[str] = Field(default_factory=list)
    mode: ProjectMode = MOCK_MODE


class ProjectCreateRequest(ProjectBase):
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    description: str = Field(default="", max_length=DESCRIPTION_MAX_LENGTH)
    hosts: list[str] = Field(default_factory=list, max_length=HOSTS_MAX)
    ignored_fields: IgnoredFields = Field(default_factory=list)

    @field_validator("hosts")
    @classmethod
    def _check_hosts(cls, value: list[str]) -> list[str]:
        hosts = _normalized_hosts(value)
        problem = _hosts_problem(hosts)
        if problem is not None:
            raise ValueError(problem)
        return hosts


class ProjectReadResponse(ProjectBase):
    """A project row with the count of its endpoints - what the project list shows."""

    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    endpoint_count: int
    created_at: UtcDateTime
    updated_at: UtcDateTime
    version: int


class ProjectUpdateRequest(BaseModel):
    """Every field optional: a PATCH names only what it changes."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=NAME_MAX_LENGTH)
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)
    # The whole list: `[]` stops intercepting, `null` leaves it as it is.
    hosts: list[str] | None = Field(default=None, max_length=HOSTS_MAX)
    # The whole list too: `[]` compares every field again.
    ignored_fields: IgnoredFields | None = None
    # NOT NULL: `null` leaves the mode as it is, like an absent field.
    mode: ProjectMode | None = None

    @field_validator("hosts")
    @classmethod
    def _check_hosts(cls, value: list[str] | None) -> list[str] | None:
        hosts = None if value is None else _normalized_hosts(value)
        problem = None if hosts is None else _hosts_problem(hosts)
        if problem is not None:
            raise ValueError(problem)
        return hosts


# ============================================================
# Functions
# ============================================================


def to_read(project: Project, endpoint_counts: Mapping[UUID, int]) -> ProjectReadResponse:
    """The row as answered, its endpoint count looked up by id (absent means none)."""
    return ProjectReadResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        hosts=project.hosts,
        ignored_fields=project.ignored_fields,
        mode=cast(ProjectMode, project.mode),
        endpoint_count=endpoint_counts.get(project.id, 0),
        created_at=project.created_at,
        updated_at=project.updated_at,
        version=project.version,
    )


def to_read_list(
    projects: list[Project], endpoint_counts: Mapping[UUID, int]
) -> list[ProjectReadResponse]:
    return [to_read(project, endpoint_counts) for project in projects]


def _normalized_hosts(hosts: list[str]) -> list[str]:
    """Each pattern in its one spelling, the first of any repeat kept, blanks dropped."""
    return list(dict.fromkeys(host for host in map(normalize_host, hosts) if host))


def _hosts_problem(hosts: list[str]) -> str | None:
    """Why one of `hosts` cannot be intercepted, or None when every one can."""
    for host in hosts:
        problem = host_problem(host, wildcard=True)
        if problem is not None:
            return problem
    return None
