# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Literal, get_args
from uuid import uuid4

from sqlalchemy import JSON, CheckConstraint, String, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import CHILD_CASCADE, AuditMixin, Base


if TYPE_CHECKING:
    from app.models.endpoint import Endpoint


# ============================================================
# Constants
# ============================================================

#: The column every child of a project points at.
PROJECT_FK = "project.id"

#: How a project answers a request to one of its hosts. `record`: the request
#: goes on to the real server and is logged with its answer - the endpoints are
#: not consulted. `mock`: its endpoints answer, anything else fails
#: `mock_not_matched`.
ProjectMode = Literal["mock", "record"]
PROJECT_MODES: tuple[str, ...] = get_args(ProjectMode)
MOCK_MODE: ProjectMode = "mock"
RECORD_MODE: ProjectMode = "record"

#: `ck_project_mode`'s list, spelled from `PROJECT_MODES`.
MODE_LIST_SQL = ", ".join(f"'{mode}'" for mode in PROJECT_MODES)


# ============================================================
# Classes
# ============================================================


class Project(Base, AuditMixin):
    """A mocked API: the hosts it intercepts, the endpoints it answers, the requests it saw.

    The forward proxy decrypts and handles only a request whose host one of
    `hosts` names (`api.example.com`, or `*.example.com` for its subdomains);
    every other connection passes through untouched. A pattern belongs to one
    project. In `record` mode the real server answers and the exchange is
    logged; in `mock` mode only the endpoints answer.
    """

    __tablename__ = "project"
    __table_args__ = (CheckConstraint(f"mode IN ({MODE_LIST_SQL})", name="ck_project_mode"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(512), default="")
    # `text("'[]'")`: the rows written before hosts existed intercept nothing.
    hosts: Mapped[list[str]] = mapped_column(JSON, default=list, server_default=text("'[]'"))
    # Query parameter names and JSON keys a client changes on every call (a
    # nonce, a timestamp): left out when a request is recorded and matched.
    ignored_fields: Mapped[list[str]] = mapped_column(
        JSON, default=list, server_default=text("'[]'")
    )
    mode: Mapped[str] = mapped_column(String(16), default=MOCK_MODE, server_default=MOCK_MODE)

    # The database deletes the children (ON DELETE CASCADE); the ORM must not
    # load them only to delete them one by one.
    endpoints: Mapped[list[Endpoint]] = relationship(
        cascade=CHILD_CASCADE, passive_deletes=True, lazy="raise_on_sql"
    )
