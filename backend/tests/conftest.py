"""Shared fixtures: an isolated SQLite client, an engine for unit tests, and a hermetic env.

Every fixture here exists to keep a test from depending on something outside its
own file — the developer's database file, or an ambient environment variable.
"""

import os
from collections.abc import AsyncIterator, Iterator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.pool import StaticPool

from app.core.settings import Settings
from app.dependencies import core as deps_core
from app.main import app
from app.models.base import Base
from app.models.endpoint import Endpoint  # noqa: F401 — on metadata
from app.models.project import Project  # noqa: F401 — on metadata
from app.models.request_log import RequestLog  # noqa: F401 — on metadata


@pytest.fixture(autouse=True)
def isolate_settings_environment(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """Hide ambient environment variables that map to Settings fields.

    pydantic-settings reads the process environment before any `.env` file, so
    a shell that exported the root `.env` would change what the settings tests
    observe, and the same commit would be green in one terminal and red in
    another. The names come from the model, so a new field cannot reintroduce
    the leak. What was hidden is returned, for a test that starts a subprocess
    needing the suite's own environment.
    """
    hidden: dict[str, str] = {}
    for field in Settings.model_fields:
        for name in (field.upper(), field):
            value = os.environ.get(name)
            if value is not None:
                hidden[name] = value
            monkeypatch.delenv(name, raising=False)
    return hidden


@pytest.fixture()
async def engine() -> AsyncIterator[AsyncEngine]:
    """In-memory SQLite engine with all tables — one connection, shared by every session."""
    test_engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with test_engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    yield test_engine
    await test_engine.dispose()


@pytest.fixture()
def factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Session factory bound to the in-memory engine — for repository and service tests."""
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture()
def client(factory: async_sessionmaker[AsyncSession]) -> Iterator[TestClient]:
    """Isolated in-memory SQLite client.

    The REAL get_session() dependency runs against the test engine swapped in
    place of the production one — the request lifecycle (session create /
    yield / close) is exercised, not a dependency override.
    """
    previous = deps_core.async_session_factory
    deps_core.async_session_factory = factory
    with TestClient(app) as test_client:
        yield test_client
    deps_core.async_session_factory = previous
