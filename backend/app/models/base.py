# ============================================================
# Imports
# ============================================================

from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Integer, func
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column


# ============================================================
# Constants
# ============================================================

# A parent's collection of child rows: deleted with the parent, and orphans
# deleted when detached. Declared once here because every model file that owns
# children spells the same intent.
CHILD_CASCADE = "all, delete-orphan"


# ============================================================
# Classes
# ============================================================


class Base(DeclarativeBase):
    pass


class AuditMixin:
    """When a row was written and how many times - the reference's audit columns minus the actor.

    `created_by`/`updated_by` are absent on purpose: the app has no
    authentication, so there is no actor to record and the columns would only
    ever hold NULL.
    """

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    @declared_attr.directive
    def __mapper_args__(cls) -> dict[str, Any]:
        """Optimistic locking: a concurrent UPDATE on the same row raises StaleDataError.

        SQLAlchemy adds `WHERE version = <loaded>` to every UPDATE and bumps the
        counter on flush, so a lost update surfaces as a conflict instead of
        silently overwriting the other transaction's work.
        """
        return {"version_id_col": cls.version}
