# ============================================================
# Imports
# ============================================================

import uuid
from typing import Any
from uuid import uuid4

from sqlalchemy import JSON, Boolean, ForeignKey, Index, Integer, String, Text, Uuid, false, text
from sqlalchemy.orm import Mapped, mapped_column

from app.engine.hosts import HOST_MAX_LENGTH
from app.models.base import AuditMixin, Base
from app.models.endpoint import ENDPOINT_FK
from app.models.project import PROJECT_FK


# ============================================================
# Classes
# ============================================================


class RequestLog(Base, AuditMixin):
    """One request the proxy handled for a project's host, and how it was answered.

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
    # Where the request was going; the defaults fill the rows logged before hosts existed.
    scheme: Mapped[str] = mapped_column(String(8), nullable=False, server_default=text("'http'"))
    host: Mapped[str] = mapped_column(
        String(HOST_MAX_LENGTH), nullable=False, server_default=text("''")
    )
    path: Mapped[str] = mapped_column(String(2048))
    query_string: Mapped[str] = mapped_column(String(2048))
    request_headers: Mapped[dict[str, Any]] = mapped_column(JSON)
    request_body: Mapped[str] = mapped_column(Text)
    response_status: Mapped[int] = mapped_column(Integer)
    matched: Mapped[bool] = mapped_column(Boolean, nullable=False)
    # Answered by the real server (record mode) rather than an endpoint. The
    # server default fills the rows logged before forwarding existed.
    proxied: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    # The real server's answer to a forwarded request, as recorded (repeated
    # headers folded), its body cut at MAX_LOG_BODY_BYTES. NULL for every other request.
    response_headers: Mapped[dict[str, Any] | None] = mapped_column(
        JSON(none_as_null=True), default=None
    )
    response_body: Mapped[str | None] = mapped_column(Text, default=None)
    # The real server's whole answer in the body store when it was binary or past
    # MAX_LOG_BODY_BYTES (`response_body` then holds the cut, decoded start), and
    # the answer's size in bytes - both NULL for every other request.
    response_body_ref: Mapped[str | None] = mapped_column(String(64), default=None)
    response_size: Mapped[int | None] = mapped_column(Integer, default=None)
    # Whether the exchange can be saved as an endpoint: request and answer bodies
    # complete and UTF-8 (the request's becomes the endpoint's body condition),
    # and its method, path, status and headers valid for one. Decided once, when logged.
    recordable: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default=false()
    )
    duration_ms: Mapped[int] = mapped_column(Integer)
