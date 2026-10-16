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
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.settings import MAX_DELAY_MS
from app.engine.matcher import METHODS
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

    `path` is a pattern whose `{name}` segments bind any one segment of the
    request path; `body` is a template the request's values are rendered into.
    One endpoint per method and pattern in a project, so a request never has
    two equally specific answers.
    """

    __tablename__ = "endpoint"
    __table_args__ = (
        UniqueConstraint("project_id", "method", "path", name="uq_endpoint_project_method_path"),
        CheckConstraint(f"method IN ({METHOD_LIST_SQL})", name="ck_endpoint_method"),
        CheckConstraint("status_code BETWEEN 100 AND 599", name="ck_endpoint_status_code"),
        CheckConstraint(f"delay_ms BETWEEN 0 AND {MAX_DELAY_MS}", name="ck_endpoint_delay_ms"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(PROJECT_FK, ondelete="CASCADE"), index=True
    )
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(500))
    status_code: Mapped[int] = mapped_column(Integer)
    headers: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    body: Mapped[str] = mapped_column(Text, default="")
    delay_ms: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default=true()
    )
    description: Mapped[str] = mapped_column(String(512), default="")
