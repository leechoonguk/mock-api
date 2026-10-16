# ============================================================
# Imports
# ============================================================

from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.core.timestamps import UtcDateTime
from app.models.project import Project


# ============================================================
# Constants
# ============================================================

NAME_MAX_LENGTH = 120
SLUG_MAX_LENGTH = 64
DESCRIPTION_MAX_LENGTH = 512

#: A slug is a URL segment a person types: lower-case words joined by single
#: hyphens, so `/mock/<slug>/` never needs escaping.
SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


# ============================================================
# Classes
# ============================================================


class ProjectBase(BaseModel):
    """The fields every direction shares - without rules, so an old row stays readable."""

    model_config = ConfigDict(extra="forbid")

    name: str
    slug: str
    description: str = ""


class ProjectCreateRequest(ProjectBase):
    name: str = Field(min_length=1, max_length=NAME_MAX_LENGTH)
    slug: str = Field(min_length=1, max_length=SLUG_MAX_LENGTH, pattern=SLUG_PATTERN)
    description: str = Field(default="", max_length=DESCRIPTION_MAX_LENGTH)


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
    slug: str | None = Field(
        default=None, min_length=1, max_length=SLUG_MAX_LENGTH, pattern=SLUG_PATTERN
    )
    description: str | None = Field(default=None, max_length=DESCRIPTION_MAX_LENGTH)


# ============================================================
# Functions
# ============================================================


def to_read(project: Project, endpoint_counts: Mapping[UUID, int]) -> ProjectReadResponse:
    """The row as answered, its endpoint count looked up by id (absent means none)."""
    return ProjectReadResponse(
        id=project.id,
        name=project.name,
        slug=project.slug,
        description=project.description,
        endpoint_count=endpoint_counts.get(project.id, 0),
        created_at=project.created_at,
        updated_at=project.updated_at,
        version=project.version,
    )


def to_read_list(
    projects: list[Project], endpoint_counts: Mapping[UUID, int]
) -> list[ProjectReadResponse]:
    return [to_read(project, endpoint_counts) for project in projects]
