# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import CHILD_CASCADE, AuditMixin, Base


if TYPE_CHECKING:
    from app.models.endpoint import Endpoint


# ============================================================
# Constants
# ============================================================

#: The column every child of a project points at.
PROJECT_FK = "project.id"


# ============================================================
# Classes
# ============================================================


class Project(Base, AuditMixin):
    """A mocked API: the endpoints it answers and the requests it was sent.

    `slug` is the project's segment of every mocked URL (`/mock/<slug>/...`),
    so it is unique and URL-safe; `name` is what a person reads.
    """

    __tablename__ = "project"
    __table_args__ = (UniqueConstraint("slug", name="uq_project_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(64))
    description: Mapped[str] = mapped_column(String(512), default="")

    # The database deletes the children (ON DELETE CASCADE); the ORM must not
    # load them only to delete them one by one.
    endpoints: Mapped[list[Endpoint]] = relationship(
        cascade=CHILD_CASCADE, passive_deletes=True, lazy="raise_on_sql"
    )
