# ============================================================
# Imports
# ============================================================

import uuid
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AuditMixin, Base
from app.models.endpoint import ENDPOINT_FK
from app.models.project import PROJECT_FK


# ============================================================
# Classes
# ============================================================


class RequestLog(Base, AuditMixin):
    """One request a project's mock was sent, and how it was answered.

    Append-only, like a call log: a row is written once and only ever deleted
    (by retention, by a clear, or with its project). `endpoint_id` is SET NULL
    so deleting an endpoint keeps the history of what it answered.
    """

    __tablename__ = "request_log"
    __table_args__ = (
        # The log screen pages one project's rows newest first.
        Index("ix_request_log_project_id_created_at", "project_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey(PROJECT_FK, ondelete="CASCADE"), index=True
    )
    endpoint_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(ENDPOINT_FK, ondelete="SET NULL"), index=True, default=None
    )
    method: Mapped[str] = mapped_column(String(10))
    path: Mapped[str] = mapped_column(String(2048))
    query_string: Mapped[str] = mapped_column(String(2048))
    request_headers: Mapped[dict[str, Any]] = mapped_column(JSON)
    request_body: Mapped[str] = mapped_column(Text)
    response_status: Mapped[int] = mapped_column(Integer)
    matched: Mapped[bool] = mapped_column(Boolean, nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer)
