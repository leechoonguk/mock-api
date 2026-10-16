"""Mocked requests end to end: matching, rendering, delay, logging, and the middleware around them.

A mock stands in for someone else's API, so these cases pin what the program
under test observes on the wire - status, headers, body - and what the log
records about it.
"""

import json
from time import perf_counter
from typing import Any

from fastapi.testclient import TestClient


BASE = "/api/v1/project/"


def _project(client: TestClient, slug: str = "demo") -> str:
    response = client.post(BASE, json={"name": slug.title(), "slug": slug})
    assert response.status_code == 201
    return response.json()["id"]


def _endpoint(client: TestClient, project_id: str, **fields: Any) -> dict[str, Any]:
    response = client.post(f"/api/v1/project/{project_id}/endpoints", json=fields)
    assert response.status_code == 201
    return response.json()


def _logs(client: TestClient, project_id: str) -> dict[str, Any]:
    return client.get(f"/api/v1/project/{project_id}/logs").json()


def test_mock_answers_declared_status_headers_and_rendered_body(client: TestClient) -> None:
    """The declared status and headers reach the caller, the body rendered with the path id."""
    project_id = _project(client)
    _endpoint(
        client,
        project_id,
        method="GET",
        path="/users/{id}",
        status_code=201,
        headers={"X-Mock": "1"},
        body='{"id":"{{path.id}}"}',
    )
    response = client.get("/mock/demo/users/42")
    assert response.status_code == 201
    assert response.headers["x-mock"] == "1"
    assert response.headers["content-type"] == "application/json"
    assert response.json() == {"id": "42"}


def test_mock_renders_query_headers_and_body_tokens(client: TestClient) -> None:
    """Query, header and JSON-body values reach the template; a non-JSON body is plain text."""
    project_id = _project(client)
    _endpoint(
        client,
        project_id,
        method="POST",
        path="/echo",
        body="{{query.page}}|{{headers.X-User}}|{{body.items.1.name}}",
    )
    response = client.post(
        "/mock/demo/echo?page=2&page=3",
        headers={"X-User": "ana"},
        content=json.dumps({"items": [{"name": "a"}, {"name": "b"}]}),
    )
    assert response.status_code == 200
    assert response.text == "2|ana|b"
    assert response.headers["content-type"] == "text/plain; charset=utf-8"


def test_mock_unmatched_is_logged_as_a_miss(client: TestClient) -> None:
    """A path no endpoint declares answers `mock_not_matched` and still lands in the log."""
    project_id = _project(client)
    _endpoint(client, project_id, method="GET", path="/users/{id}")
    assert client.get("/mock/demo/users/1").status_code == 200
    response = client.get("/mock/demo/nope")
    assert response.status_code == 404
    body = response.json()
    assert body["code"] == "mock_not_matched"
    assert body["method"] == "GET"
    assert body["path"] == "/nope"
    logs = _logs(client, project_id)
    assert logs["total"] == 2
    assert [item["matched"] for item in logs["items"]] == [False, True]
    assert logs["items"][0]["response_status"] == 404
    assert logs["items"][0]["endpoint_id"] is None


def test_mock_unknown_project_is_not_logged(client: TestClient) -> None:
    """A slug no project owns is `not_found`, and no project's log grows from it."""
    project_id = _project(client)
    response = client.get("/mock/unknown/x")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert _logs(client, project_id)["total"] == 0


def test_mock_delay_is_spent_before_answering(client: TestClient) -> None:
    """A declared delay holds the response at least that long and counts in the log."""
    project_id = _project(client)
    _endpoint(client, project_id, method="GET", path="/slow", delay_ms=200)
    started = perf_counter()
    response = client.get("/mock/demo/slow")
    elapsed = perf_counter() - started
    assert response.status_code == 200
    assert elapsed >= 0.2
    assert _logs(client, project_id)["items"][0]["duration_ms"] >= 200


def test_mock_accepts_cross_origin_writes_the_admin_api_refuses(client: TestClient) -> None:
    """CSRF guards the admin API only: a mock is called from any origin by design."""
    project_id = _project(client)
    _endpoint(client, project_id, method="POST", path="/orders", status_code=201)
    evil = {"Origin": "http://evil.example", "Sec-Fetch-Site": "cross-site"}
    assert client.post("/mock/demo/orders", headers=evil).status_code == 201
    refused = client.post(BASE, json={"name": "X", "slug": "x"}, headers=evil)
    assert refused.status_code == 403


def test_mock_headers_win_over_security_defaults(client: TestClient) -> None:
    """An endpoint's own X-Frame-Options and content type survive the security middleware."""
    project_id = _project(client)
    _endpoint(
        client,
        project_id,
        method="GET",
        path="/frame",
        headers={"X-Frame-Options": "SAMEORIGIN", "Content-Type": "text/html"},
        body="<p>hi</p>",
    )
    response = client.get("/mock/demo/frame")
    assert response.headers["x-frame-options"] == "SAMEORIGIN"
    assert response.headers["content-type"] == "text/html"
    assert response.headers["x-content-type-options"] == "nosniff"


def test_mock_head_falls_back_to_get_without_a_body(client: TestClient) -> None:
    """HEAD is answered by the GET endpoint's status and headers, never its body."""
    project_id = _project(client)
    _endpoint(client, project_id, method="GET", path="/users", body='{"a":1}')
    response = client.head("/mock/demo/users")
    assert response.status_code == 200
    assert response.content == b""


def test_mock_bodiless_status_drops_the_body(client: TestClient) -> None:
    """A 204 cannot carry a body on the wire, so a declared one is not sent."""
    project_id = _project(client)
    _endpoint(client, project_id, method="DELETE", path="/users/{id}", status_code=204, body="x")
    response = client.delete("/mock/demo/users/1")
    assert response.status_code == 204
    assert response.content == b""


def test_mock_project_root_matches_the_root_endpoint(client: TestClient) -> None:
    """`/mock/<slug>` with or without a trailing slash reaches the `/` endpoint."""
    project_id = _project(client)
    _endpoint(client, project_id, method="ANY", path="/", body="root")
    assert client.get("/mock/demo").text == "root"
    assert client.put("/mock/demo/").text == "root"


def test_mock_encoded_slash_stays_inside_its_segment(client: TestClient) -> None:
    """`%2F` binds one parameter instead of adding a segment, and is decoded in the value."""
    project_id = _project(client)
    _endpoint(client, project_id, method="GET", path="/files/{name}", body="{{path.name}}")
    response = client.get("/mock/demo/files/a%2Fb")
    assert response.status_code == 200
    assert response.text == "a/b"


def test_mock_stops_answering_with_its_deleted_project(client: TestClient) -> None:
    """Deleting a project removes its endpoints (cascade), so its URLs answer `not_found`."""
    project_id = _project(client)
    _endpoint(client, project_id, method="GET", path="/users")
    assert client.get("/mock/demo/users").status_code == 200
    assert client.delete(f"/api/v1/project/{project_id}").status_code == 200
    response = client.get("/mock/demo/users")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
