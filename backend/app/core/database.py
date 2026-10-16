# ============================================================
# Imports
# ============================================================

from typing import Any

from sqlalchemy import Engine, event, make_url
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine

from app.core.settings import settings


# ============================================================
# Constants
# ============================================================

#: The database names SQLite reads as "a private in-memory database".
IN_MEMORY_DATABASES = frozenset({None, "", ":memory:"})


# ============================================================
# Functions
# ============================================================


@event.listens_for(Engine, "connect")
def _enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
    """Turn on SQLite's foreign keys for every connection the app opens.

    SQLite ignores `ON DELETE CASCADE` / `SET NULL` unless each connection asks
    for them, so without this a deleted project would leave its endpoints and
    logs behind. Registered on the `Engine` class rather than the module engine
    so the test suite's in-memory engines enforce the same constraints.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def create_engine() -> AsyncEngine:
    """An engine on the configured database - one per event loop that opens connections.

    The proxy runs its own loop and builds its own engine with this: an
    aiosqlite connection belongs to the loop that opened it.
    """
    if make_url(settings.database_url).database in IN_MEMORY_DATABASES:
        # An in-memory database lives in one connection, so it has no pool to size.
        return create_async_engine(settings.database_url, pool_pre_ping=True)
    return create_async_engine(
        settings.database_url,
        pool_size=5,
        max_overflow=10,
        pool_timeout=30,
        pool_pre_ping=True,
    )


engine = create_engine()
