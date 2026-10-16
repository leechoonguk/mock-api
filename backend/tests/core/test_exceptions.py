"""Error responses: every failure answers one body shape, `{detail, code, request_id}`.

The admin UI translates by `code`, so each handler's status and code are pinned
on a minimal app that raises the exception directly.
"""

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm.exc import StaleDataError

from app.core.exceptions import (
    MockNotMatchedError,
    NotFoundError,
    ServiceUnavailableError,
    setup_exception_handler,
)


def _raising_app() -> FastAPI:
    app = FastAPI()
    setup_exception_handler(app)
    failures: dict[str, Exception] = {
        "not-found": NotFoundError("abc"),
        "not-matched": MockNotMatchedError("PUT", "/x"),
        "integrity": IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed")),
        "stale": StaleDataError("version mismatch"),
        "unavailable": ServiceUnavailableError("Database unavailable"),
    }

    @app.get("/{name}")
    async def _fail(name: str, request: Request) -> None:
        if name == "with-id":
            request.state.request_id = "req-1"
            raise NotFoundError("abc")
        raise failures[name]

    return app


@pytest.mark.parametrize(
    ("name", "status", "code"),
    [
        ("not-found", 404, "not_found"),
        ("not-matched", 404, "mock_not_matched"),
        ("integrity", 409, "conflict"),
        ("stale", 409, "stale_version"),
        ("unavailable", 503, "service_unavailable"),
    ],
)
def test_handler_maps_exception_to_status_and_code(name: str, status: int, code: str) -> None:
    """The client branches on these pairs; a changed code silently breaks its translation."""
    response = TestClient(_raising_app()).get(f"/{name}")
    assert response.status_code == status
    body = response.json()
    assert body["code"] == code
    assert body["detail"]
    assert body["request_id"] == "unknown"


def test_request_id_comes_from_request_state_then_header() -> None:
    """The id the middleware assigned is echoed; without it, the caller's own header is."""
    client = TestClient(_raising_app())
    assert client.get("/with-id").json()["request_id"] == "req-1"
    echoed = client.get("/not-found", headers={"X-Request-ID": "from-client"})
    assert echoed.json()["request_id"] == "from-client"


def test_mock_miss_names_the_request_it_missed() -> None:
    """The caller's logs show only this body, so it carries the method and path asked for."""
    body = TestClient(_raising_app()).get("/not-matched").json()
    assert (body["method"], body["path"]) == ("PUT", "/x")
    assert str(MockNotMatchedError("PUT", "/x")) == "No mock endpoint matches PUT /x"
