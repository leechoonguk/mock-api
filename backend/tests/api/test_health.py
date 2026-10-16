"""Readiness probe: up only when the database answers, 503 with the uniform body when not."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine

from app.routers import health


def test_health_reports_ok_when_the_database_answers(client: TestClient) -> None:
    """The probe runs a real query, so a green answer means the engine can connect."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["x-request-id"]


def test_health_reports_503_when_the_database_is_unreachable(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path_factory: pytest.TempPathFactory
) -> None:
    """A database that cannot be opened answers 503 `service_unavailable`, never a 500."""
    unreachable = tmp_path_factory.mktemp("health") / "missing" / "mock.db"
    monkeypatch.setattr(health, "engine", create_async_engine(f"sqlite+aiosqlite:///{unreachable}"))
    response = client.get("/health")
    assert response.status_code == 503
    assert response.json()["code"] == "service_unavailable"
