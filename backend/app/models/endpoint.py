# ============================================================
# Imports
# ============================================================

import uuid
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.settings import MAX_DELAY_MS
from app.engine.hosts import HOST_MAX_LENGTH
from app.engine.matcher import ANY_HOST, METHODS, NO_CONDITIONS
from app.models.base import AuditMixin, Base
from app.models.project import PROJECT_FK


# ============================================================
# Constants
# ============================================================

#: The column a request log points at when it names the endpoint that answered.
ENDPOINT_FK = "endpoint.id"

#: `ck_endpoint_method`'s list, spelled from `METHODS`.
METHOD_LIST_SQL = ", ".join(f"'{method}'" for method in METHODS)


# ============================================================
# Classes
# ============================================================


class Endpoint(Base, AuditMixin):
    """One mocked route of a project: what it answers to, and what it answers.

    `host` is the one host it answers on, or `ANY_HOST` ("") for every host of
    its project; `path` is a pattern whose `{name}` segments bind any one
    segment of the request path; `body` is a template the request's values are
    rendered into. One endpoint per method, host, pattern and conditions in a
    project, so a request never has two equally specific answers.
    `match_query` / `match_body` narrow it to one exact query or body (NULL:
    any); `match_key` digests the two so the unique constraint can compare them.
    """

    __tablename__ = "endpoint"
    __table_args__ = (
        UniqueConstraint(
            "project_id",
            "method",
            "host",
            "path",
            "match_key",
            name="uq_endpoint_project_method_host_path_match",
        ),
        CheckConstraint(f"method IN ({METHOD_LIST_SQL})", name="ck_endpoint_method"),
        CheckConstraint("status_code BETWEEN 100 AND 599", name="ck_endpoint_status_code"),
        CheckConstraint(f"delay_ms BETWEEN 0 AND {MAX_DELAY_MS}", name="ck_endpoint_delay_ms"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(PROJECT_FK, ondelete="CASCADE"), index=True
    )
    method: Mapped[str] = mapped_column(String(10))
    host: Mapped[str] = mapped_column(
        String(HOST_MAX_LENGTH), nullable=False, default=ANY_HOST, server_default=text("''")
    )
    path: Mapped[str] = mapped_column(String(500))
    status_code: Mapped[int] = mapped_column(Integer)
    headers: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    body: Mapped[str] = mapped_column(Text, default="")
    # A recorded answer kept whole in the body store (binary, or past the log's
    # limit): when set the endpoint answers these bytes, and `body` is not used.
    body_ref: Mapped[str | None] = mapped_column(String(64), default=None)
    delay_ms: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    description: Mapped[str] = mapped_column(String(512), default="")
    match_query: Mapped[str | None] = mapped_column(String(2048), default=None)
    match_body: Mapped[str | None] = mapped_column(Text, default=None)
    # `text("''")`, not "": Alembic reads an empty-string default back as a
    # clause and would report a plain "" as drift on every check.
    match_key: Mapped[str] = mapped_column(
        String(64), nullable=False, default=NO_CONDITIONS, server_default=text("''")
    )
