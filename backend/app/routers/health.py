# ============================================================
# Imports
# ============================================================

from fastapi import APIRouter
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.database import engine
from app.core.exceptions import ServiceUnavailableError


# ============================================================
# Router
# ============================================================

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
async def health() -> dict[str, str]:
    """Return readiness status after verifying database connectivity."""
    try:
        async with engine.connect() as connection:
            await connection.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise ServiceUnavailableError("Database unavailable") from exc
    return {"status": "ok"}
