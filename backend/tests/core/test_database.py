"""Database wiring: SQLite enforces foreign keys only when every connection asks for them."""

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.core.database import engine as app_engine


async def test_every_connection_enforces_foreign_keys(engine: AsyncEngine) -> None:
    """Without the pragma, deleting a project would orphan its endpoints and logs."""
    async with engine.connect() as connection:
        assert (await connection.execute(text("PRAGMA foreign_keys"))).scalar_one() == 1


async def test_app_engine_answers_queries() -> None:
    """The module engine built from settings is usable as configured (in-memory in tests)."""
    async with app_engine.connect() as connection:
        assert (await connection.execute(text("SELECT 1"))).scalar_one() == 1
