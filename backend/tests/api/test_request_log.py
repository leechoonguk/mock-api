"""Request log admin API: a project's log, its filters, and saving recorded exchanges as endpoints.

The log screen branches on status codes and the `code` field, so each case
pins both - and the filters are pinned through the wire, where a parameter
that never reaches the query would still answer 200. The rows are written the
way the proxy writes them: through its handler, on the suite's database.
"""

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.proxy import HttpAnswer
from app.dependencies.proxy import MockInterceptHandler
from tests.conftest import BuildRequest


MISSING = "00000000-0000-0000-0000-000000000000"
BASE = "/api/v1/project/"
HOST = "api.example.com"

#: The real server's answer to every recorded request here.
REAL_ANSWER = HttpAnswer(
    status_code=207, headers=[("content-type", "application/json")], content=b'{"ok":1}'
)


def _create_project(client: TestClient, mode: str = "mock") -> dict[str, Any]:
    response = client.post(BASE, json={"name": "Demo", "hosts": [HOST], "mode": mode})
    assert response.status_code == 201
    return response.json()


def _create_endpoint(client: TestClient, project_id: str) -> None:
    response = client.post(
        f"/api/v1/project/{project_id}/endpoints",
        json={"method": "GET", "path": "/users/{id}", "body": '{"id":"{{path.id}}"}'},
    )
    assert response.status_code == 201


def _logs(client: TestClient, project_id: str, **params: Any) -> dict[str, Any]:
    response = client.get(f"/api/v1/project/{project_id}/logs", params=params)
    assert response.status_code == 200
    return response.json()


async def test_list_request_logs(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """Every intercepted call is listed newest first with its host, misses included."""
    project = _create_project(client)
    _create_endpoint(client, project["id"])
    handler = MockInterceptHandler(factory)
    assert await handler.intercepts(HOST)
    assert not await handler.intercepts("example.org")
    await handler.answer(intercepted("/users/1"))
    await handler.answer(intercepted("/nope"))
    body = _logs(client, project["id"])
    assert body["total"] == 2
    assert [(item["host"], item["path"]) for item in body["items"]] == [
        (HOST, "/nope"),
        (HOST, "/users/1"),
    ]
    assert "request_headers" not in body["items"][0]


async def test_list_request_logs_filters_reach_the_query(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """Repeated multi-select values OR together, filters AND, and the total follows them."""
    project = _create_project(client)
    _create_endpoint(client, project["id"])
    handler = MockInterceptHandler(factory)
    await handler.answer(intercepted("/users/1"))
    await handler.answer(intercepted("/users/1", method="POST"))
    await handler.answer(intercepted("/nope"))
    page = _logs(client, project["id"], method=["GET", "PUT"], status_class=["4"])
    assert (page["total"], [item["path"] for item in page["items"]]) == (1, ["/nope"])
    page = _logs(client, project["id"], outcome="unmatched", path="users")
    assert [(item["method"], item["path"]) for item in page["items"]] == [("POST", "/users/1")]
    assert _logs(client, project["id"], host="example")["total"] == 3
    assert _logs(client, project["id"], host="ytimg")["total"] == 0
    bad = client.get(f"/api/v1/project/{project['id']}/logs", params={"outcome": "maybe"})
    assert bad.status_code == 422


async def test_get_request_log(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """The detail adds the request's headers and body, which the list leaves out."""
    project = _create_project(client)
    await MockInterceptHandler(factory).answer(
        intercepted("/anything", method="POST", body=b"payload", headers=[("X-Trace", "t1")])
    )
    log = _logs(client, project["id"])["items"][0]
    response = client.get(f"/api/v1/project/{project['id']}/logs/{log['id']}")
    assert response.status_code == 200
    body = response.json()
    assert (body["scheme"], body["host"]) == ("https", HOST)
    assert body["request_body"] == "payload"
    assert body["request_headers"]["x-trace"] == "t1"
    assert body["matched"] is False


def test_get_request_log_not_found(client: TestClient) -> None:
    """An unknown log id is a 404, like every other id."""
    project = _create_project(client)
    response = client.get(f"/api/v1/project/{project['id']}/logs/{MISSING}")
    assert response.status_code == 404


async def _recorded_log(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> tuple[str, str]:
    """A record-mode project's id and the log of one `GET /orders/7` the real server answered."""
    project = _create_project(client, mode="record")
    await MockInterceptHandler(factory).forwarded(intercepted("/orders/7"), REAL_ANSWER)
    return project["id"], _logs(client, project["id"])["items"][0]["id"]


async def test_get_request_log_response_body(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """The logged text answer downloads with its recorded content type."""
    project_id, log_id = await _recorded_log(client, factory, intercepted)
    response = client.get(f"/api/v1/project/{project_id}/logs/{log_id}/response-body")
    assert (response.status_code, response.content) == (200, b'{"ok":1}')
    assert response.headers["content-type"] == "application/json"


async def test_stored_answer_downloads_whole_and_saves_as_a_file_endpoint(
    client: TestClient,
    factory: async_sessionmaker[AsyncSession],
    intercepted: BuildRequest,
    body_store_dir: Path,
) -> None:
    """A binary answer downloads whole from its log and from the endpoint saved of it.

    With the file gone both are 404; clearing `body_ref` leaves a typed-body endpoint.
    """
    project = _create_project(client, mode="record")
    image = b"\x89PNG\r\n" + bytes(range(256))
    answer = HttpAnswer(status_code=200, headers=[("content-type", "image/png")], content=image)
    await MockInterceptHandler(factory).forwarded(intercepted("/logo.png"), answer)
    [log] = _logs(client, project["id"])["items"]
    assert log["response_size"] == len(image)
    detail = client.get(f"/api/v1/project/{project['id']}/logs/{log['id']}").json()
    assert detail["response_body_ref"] is not None
    download = client.get(f"/api/v1/project/{project['id']}/logs/{log['id']}/response-body")
    assert (download.content, download.headers["content-type"]) == (image, "image/png")
    endpoint = client.post(
        f"/api/v1/project/{project['id']}/logs/{log['id']}/endpoint", json={}
    ).json()
    assert endpoint["body_ref"] == detail["response_body_ref"]
    body = client.get(f"/api/v1/project/{project['id']}/endpoints/{endpoint['id']}/body")
    assert (body.content, body.headers["content-type"]) == (image, "image/png")
    (body_store_dir / endpoint["body_ref"]).unlink()
    gone_log = client.get(f"/api/v1/project/{project['id']}/logs/{log['id']}/response-body")
    gone = client.get(f"/api/v1/project/{project['id']}/endpoints/{endpoint['id']}/body")
    assert (gone_log.status_code, gone.status_code) == (404, 404)
    cleared = client.patch(
        f"/api/v1/project/{project['id']}/endpoints/{endpoint['id']}",
        json={"body_ref": None, "body": "typed"},
    ).json()
    assert (cleared["body_ref"], cleared["body"]) == (None, "typed")
    typed = client.get(f"/api/v1/project/{project['id']}/endpoints/{endpoint['id']}/body")
    assert (typed.content, typed.headers["content-type"]) == (b"typed", "image/png")


async def test_get_request_log_response_body_without_an_answer_404(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A request no real server answered has no answer to download."""
    project = _create_project(client)
    await MockInterceptHandler(factory).answer(intercepted("/nope"))
    [log] = _logs(client, project["id"])["items"]
    response = client.get(f"/api/v1/project/{project['id']}/logs/{log['id']}/response-body")
    assert (response.status_code, response.json()["code"]) == (404, "not_found")


def test_get_endpoint_body_typed_and_not_found(client: TestClient) -> None:
    """A typed endpoint's body downloads as typed; an unknown endpoint is a 404."""
    project = _create_project(client)
    created = client.post(
        f"/api/v1/project/{project['id']}/endpoints",
        json={"method": "GET", "path": "/a", "body": '{"a":1}'},
    ).json()
    body = client.get(f"/api/v1/project/{project['id']}/endpoints/{created['id']}/body")
    assert (body.content, body.headers["content-type"]) == (b'{"a":1}', "application/json")
    missing = client.get(f"/api/v1/project/{project['id']}/endpoints/{MISSING}/body")
    assert missing.status_code == 404


async def test_create_endpoint_from_request_log(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """The real answer becomes an endpoint on its host, at the logged path or a generalized one."""
    project_id, log_id = await _recorded_log(client, factory, intercepted)
    url = f"/api/v1/project/{project_id}/logs/{log_id}/endpoint"
    response = client.post(url, json={})
    assert response.status_code == 201
    endpoint = response.json()
    assert (endpoint["method"], endpoint["host"], endpoint["path"], endpoint["status_code"]) == (
        "GET",
        HOST,
        "/orders/7",
        207,
    )
    again = client.post(url, json={})
    assert (again.status_code, again.json()["code"]) == (409, "conflict")
    general = client.post(url, json={"path": "/orders/{id}"})
    assert (general.status_code, general.json()["path"]) == (201, "/orders/{id}")


async def test_create_endpoints_from_request_logs(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A bulk save answers what it created and what it left out, with the reason."""
    project_id, log_id = await _recorded_log(client, factory, intercepted)
    url = f"/api/v1/project/{project_id}/logs/endpoints"
    saved = client.post(url, json={"request_log_ids": [log_id, MISSING]})
    assert saved.status_code == 200
    assert [e["path"] for e in saved.json()["created"]] == ["/orders/7"]
    assert saved.json()["skipped"] == [{"request_log_id": MISSING, "reason": "not_found"}]
    again = client.post(url, json={"request_log_ids": [log_id]}).json()
    assert (again["created"], again["skipped"][0]["reason"]) == ([], "conflict")
    assert client.post(url, json={"request_log_ids": []}).status_code == 422


async def test_create_endpoint_from_request_log_not_recordable_422(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A mock-mode miss has no recorded answer to save: 422 `not_recordable`."""
    project = _create_project(client)
    await MockInterceptHandler(factory).answer(intercepted("/anything"))
    log_id = _logs(client, project["id"])["items"][0]["id"]
    response = client.post(f"/api/v1/project/{project['id']}/logs/{log_id}/endpoint", json={})
    assert (response.status_code, response.json()["code"]) == (422, "not_recordable")


def test_create_endpoint_from_request_log_not_found(client: TestClient) -> None:
    """An unknown log id is a 404."""
    project = _create_project(client)
    response = client.post(f"/api/v1/project/{project['id']}/logs/{MISSING}/endpoint", json={})
    assert response.status_code == 404


async def test_create_endpoint_from_request_log_bad_path_422(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """The replacement path obeys the endpoint pattern rules where it is typed."""
    project_id, log_id = await _recorded_log(client, factory, intercepted)
    response = client.post(
        f"/api/v1/project/{project_id}/logs/{log_id}/endpoint", json={"path": "/{id}/{id}"}
    )
    assert response.status_code == 422


async def test_delete_request_logs(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """Clearing the log empties it and leaves the project and its endpoints alone."""
    project = _create_project(client)
    _create_endpoint(client, project["id"])
    await MockInterceptHandler(factory).answer(intercepted("/users/1"))
    response = client.delete(f"/api/v1/project/{project['id']}/logs")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert _logs(client, project["id"])["total"] == 0
    assert client.get(f"/api/v1/project/{project['id']}").json()["endpoint_count"] == 1


def test_delete_request_logs_not_found(client: TestClient) -> None:
    """Clearing the log of a project that is gone is a 404, not a silent ok."""
    response = client.delete(f"/api/v1/project/{MISSING}/logs")
    assert (response.status_code, response.json()["code"]) == (404, "not_found")


async def test_list_volatile_fields(
    client: TestClient, factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """Two calls to one route that differ in a nonce suggest it; ignored, it is not suggested."""
    project = _create_project(client, mode="record")
    handler = MockInterceptHandler(factory)
    await handler.forwarded(intercepted("/watch", query="v=1&cpn=a"), REAL_ANSWER)
    await handler.forwarded(intercepted("/watch", query="v=1&cpn=b"), REAL_ANSWER)
    url = f"/api/v1/project/{project['id']}/logs/volatile-fields"
    assert client.get(url).json() == {"fields": [{"name": "cpn", "routes": 1}]}
    client.patch(f"/api/v1/project/{project['id']}", json={"ignored_fields": ["cpn"]})
    assert client.get(url).json() == {"fields": []}
    assert client.get(f"/api/v1/project/{MISSING}/logs/volatile-fields").status_code == 404
