"""Project admin API: the project CRUD contract and its nested endpoints.

The admin screen is the only client, and it branches on status codes and the
`code` field - so each case pins both, not just that the call "worked".
"""

from typing import Any

from fastapi.testclient import TestClient

from app.core.settings import settings


MISSING = "00000000-0000-0000-0000-000000000000"
BASE = "/api/v1/project/"


def _create_project(client: TestClient, name: str = "Demo", **fields: Any) -> dict[str, Any]:
    response = client.post(BASE, json={"name": name, **fields})
    assert response.status_code == 201
    return response.json()


def _create_endpoint(
    client: TestClient, project_id: str, method: str = "GET", path: str = "/users/{id}"
) -> dict[str, Any]:
    response = client.post(
        f"/api/v1/project/{project_id}/endpoints",
        json={"method": method, "path": path, "body": '{"id":"{{path.id}}"}'},
    )
    assert response.status_code == 201
    return response.json()


def test_create_project(client: TestClient) -> None:
    """A new project starts with no endpoints and an optimistic-lock version of one."""
    body = _create_project(client)
    assert body["id"]
    assert (body["hosts"], body["mode"]) == ([], "mock")
    assert body["endpoint_count"] == 0
    assert body["version"] == 1
    assert body["created_at"].endswith("Z")


def test_create_project_422(client: TestClient) -> None:
    """A missing name is refused at the boundary."""
    response = client.post(BASE, json={"description": "No name"})
    assert response.status_code == 422


def test_create_project_normalizes_and_validates_hosts(client: TestClient) -> None:
    """Hosts are stored lower-case and once each; a URL, a port or a bad label is a 422."""
    body = _create_project(client, hosts=[" YouTube.com ", "*.ytimg.com", "youtube.com", ""])
    assert body["hosts"] == ["youtube.com", "*.ytimg.com"]
    for bad in ("https://example.com", "example.com:443", "exa mple.com", "*.*.com"):
        response = client.post(BASE, json={"name": "Bad", "hosts": [bad]})
        assert response.status_code == 422, bad
    response = client.patch(f"{BASE}{body['id']}", json={"hosts": ["example.com/x"]})
    assert response.status_code == 422


def test_create_project_host_taken_409(client: TestClient) -> None:
    """A host another project intercepts is refused with `host_taken`, naming the host."""
    _create_project(client, hosts=["youtube.com"])
    response = client.post(BASE, json={"name": "Other", "hosts": ["YOUTUBE.com"]})
    assert response.status_code == 409
    assert (response.json()["code"], response.json()["host"]) == ("host_taken", "youtube.com")


def test_list_projects(client: TestClient) -> None:
    """The page carries the total under the filter, so the grid can page past the window."""
    _create_project(client, "Alpha")
    _create_project(client, "Beta")
    _create_project(client, "Gamma")
    response = client.get(BASE, params={"limit": 2})
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 3
    assert [item["name"] for item in body["items"]] == ["Alpha", "Beta"]

    filtered = client.get(BASE, params={"name": "amm"}).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["name"] == "Gamma"

    ordered = client.get(BASE, params={"sort": "name", "order": "desc"}).json()
    assert [item["name"] for item in ordered["items"]] == ["Gamma", "Beta", "Alpha"]
    assert client.get(BASE, params={"sort": "slug"}).status_code == 422


def test_list_projects_counts_endpoints(client: TestClient) -> None:
    """Each row carries its endpoint count, which the list column shows without a second call."""
    project = _create_project(client)
    _create_endpoint(client, project["id"])
    _create_endpoint(client, project["id"], "POST", "/users")
    items = client.get(BASE).json()["items"]
    assert items[0]["endpoint_count"] == 2


def test_get_project(client: TestClient) -> None:
    """A single read includes the endpoint count, as the detail dialog header shows it."""
    project = _create_project(client)
    _create_endpoint(client, project["id"])
    response = client.get(f"/api/v1/project/{project['id']}")
    assert response.status_code == 200
    assert response.json()["endpoint_count"] == 1


def test_get_project_not_found(client: TestClient) -> None:
    """An unknown id answers the uniform error body, keyed by code for the client."""
    response = client.get(f"/api/v1/project/{MISSING}")
    assert response.status_code == 404
    assert response.json()["code"] == "not_found"
    assert response.json()["request_id"]


def test_update_project(client: TestClient) -> None:
    """A PATCH changes only the named field and bumps the optimistic-lock version."""
    project = _create_project(client)
    response = client.patch(
        f"/api/v1/project/{project['id']}", json={"description": "Payments sandbox"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["description"] == "Payments sandbox"
    assert body["name"] == "Demo"
    assert body["version"] == 2


def test_update_project_not_found(client: TestClient) -> None:
    """Editing a deleted project is a 404, not a silent upsert."""
    response = client.patch(f"/api/v1/project/{MISSING}", json={"name": "Ghost"})
    assert response.status_code == 404


def test_delete_project(client: TestClient) -> None:
    """Deletion answers ok and the project is gone with its endpoints (cascade)."""
    project = _create_project(client)
    endpoint = _create_endpoint(client, project["id"])
    response = client.delete(f"/api/v1/project/{project['id']}")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert client.get(f"/api/v1/project/{project['id']}").status_code == 404
    gone = client.get(f"/api/v1/project/{project['id']}/endpoints/{endpoint['id']}")
    assert gone.status_code == 404


def test_delete_project_not_found(client: TestClient) -> None:
    """Deleting twice is a 404 the second time, so a stale screen learns the row is gone."""
    response = client.delete(f"/api/v1/project/{MISSING}")
    assert response.status_code == 404


def test_project_ignored_fields_are_trimmed_kept_once_and_replaced(client: TestClient) -> None:
    """Names are stored trimmed, each once; a blank name is a 422; a PATCH replaces the list."""
    project = _create_project(client, ignored_fields=[" cpn ", "rn", "cpn"])
    assert project["ignored_fields"] == ["cpn", "rn"]
    assert client.post(BASE, json={"name": "Bad", "ignored_fields": ["  "]}).status_code == 422
    url = f"{BASE}{project['id']}"
    assert client.patch(url, json={"ignored_fields": ["t"]}).json()["ignored_fields"] == ["t"]
    assert client.patch(url, json={"ignored_fields": None}).json()["ignored_fields"] == ["t"]


def test_project_mode_and_hosts_are_edited_in_place(client: TestClient) -> None:
    """A PATCH switches the mode and replaces the host list; `null` leaves either as it is."""
    project = _create_project(client, hosts=["api.example.com"])
    url = f"{BASE}{project['id']}"
    recording = client.patch(url, json={"mode": "record"}).json()
    assert (recording["mode"], recording["hosts"]) == ("record", ["api.example.com"])
    replaced = client.patch(url, json={"hosts": ["*.example.com"], "mode": None}).json()
    assert (replaced["mode"], replaced["hosts"]) == ("record", ["*.example.com"])
    assert client.patch(url, json={"hosts": []}).json()["hosts"] == []
    assert client.patch(url, json={"mode": "replay"}).status_code == 422


def test_create_endpoint(client: TestClient) -> None:
    """The path is stored in its one normalized spelling, which is what requests match."""
    project = _create_project(client)
    body = _create_endpoint(client, project["id"], "GET", "users//{id}/")
    assert body["path"] == "/users/{id}"
    assert body["status_code"] == 200
    assert body["enabled"] is True
    assert body["project_id"] == project["id"]


def test_create_endpoint_duplicate_conflict(client: TestClient) -> None:
    """One endpoint per method and pattern: a second would make the answer ambiguous."""
    project = _create_project(client)
    _create_endpoint(client, project["id"])
    response = client.post(
        f"/api/v1/project/{project['id']}/endpoints",
        json={"method": "GET", "path": "/users/{id}/"},
    )
    assert response.status_code == 409
    assert response.json()["code"] == "conflict"


def test_create_endpoint_rejects_bad_pattern_422(client: TestClient) -> None:
    """A repeated parameter or a partial brace segment is refused where it is typed."""
    project = _create_project(client)
    for path in ("/{id}/{id}", "/users/x{id}"):
        response = client.post(
            f"/api/v1/project/{project['id']}/endpoints", json={"method": "GET", "path": path}
        )
        assert response.status_code == 422


def test_endpoint_host_is_one_name_or_every_host(client: TestClient) -> None:
    """A host is stored lower-case; a wildcard or a URL is a 422; "" answers on every host."""
    project = _create_project(client)
    url = f"{BASE}{project['id']}/endpoints"
    body = client.post(url, json={"method": "GET", "host": "API.Example.com", "path": "/a"}).json()
    assert body["host"] == "api.example.com"
    for bad in ("*.example.com", "https://example.com"):
        response = client.post(url, json={"method": "GET", "host": bad, "path": "/b"})
        assert response.status_code == 422, bad
    endpoint_url = f"{url}/{body['id']}"
    assert client.patch(endpoint_url, json={"host": "*.x.com"}).status_code == 422
    assert client.patch(endpoint_url, json={"host": ""}).json()["host"] == ""
    assert client.patch(endpoint_url, json={"host": None}).json()["host"] == ""


def test_create_endpoint_rejects_header_with_line_break(client: TestClient) -> None:
    """A header value with a newline could not be sent, so it is refused when saved."""
    project = _create_project(client)
    response = client.post(
        f"/api/v1/project/{project['id']}/endpoints",
        json={"method": "GET", "path": "/", "headers": {"X-Bad": "a\r\nb"}},
    )
    assert response.status_code == 422


def test_create_endpoint_project_not_found(client: TestClient) -> None:
    """An endpoint cannot be filed under a project that does not exist."""
    response = client.post(
        f"/api/v1/project/{MISSING}/endpoints", json={"method": "GET", "path": "/"}
    )
    assert response.status_code == 404


def test_list_endpoints(client: TestClient) -> None:
    """The endpoints tab pages one project's endpoints in path order."""
    project = _create_project(client)
    _create_endpoint(client, project["id"], "POST", "/users")
    _create_endpoint(client, project["id"], "GET", "/accounts")
    response = client.get(f"/api/v1/project/{project['id']}/endpoints")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert [item["path"] for item in body["items"]] == ["/accounts", "/users"]


def test_get_endpoint(client: TestClient) -> None:
    """The edit panel reads one endpoint with its full response definition."""
    project = _create_project(client)
    endpoint = _create_endpoint(client, project["id"])
    response = client.get(f"/api/v1/project/{project['id']}/endpoints/{endpoint['id']}")
    assert response.status_code == 200
    assert response.json()["body"] == '{"id":"{{path.id}}"}'


def test_get_endpoint_of_other_project_not_found(client: TestClient) -> None:
    """An endpoint id under the wrong project is a 404 - ids never cross projects."""
    first = _create_project(client, "first")
    second = _create_project(client, "second")
    endpoint = _create_endpoint(client, first["id"])
    response = client.get(f"/api/v1/project/{second['id']}/endpoints/{endpoint['id']}")
    assert response.status_code == 404


def test_update_endpoint(client: TestClient) -> None:
    """The list's enabled switch sends only `enabled`; the rest of the endpoint stays."""
    project = _create_project(client)
    endpoint = _create_endpoint(client, project["id"])
    response = client.patch(
        f"/api/v1/project/{project['id']}/endpoints/{endpoint['id']}", json={"enabled": False}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["enabled"] is False
    assert body["path"] == "/users/{id}"
    assert body["version"] == 2


def test_update_endpoint_normalizes_and_validates(client: TestClient) -> None:
    """An edited path and headers obey the same rules as on create, or the PATCH is a 422."""
    project = _create_project(client)
    endpoint = _create_endpoint(client, project["id"])
    url = f"/api/v1/project/{project['id']}/endpoints/{endpoint['id']}"
    response = client.patch(url, json={"path": "accounts/{id}/", "headers": {"X-A": "1"}})
    assert response.status_code == 200
    assert (response.json()["path"], response.json()["headers"]) == ("/accounts/{id}", {"X-A": "1"})
    assert client.patch(url, json={"path": "/{a}/{a}"}).status_code == 422
    assert client.patch(url, json={"headers": {"Bad Name": "1"}}).status_code == 422
    assert client.patch(url, json={"path": None, "headers": None}).status_code == 200


def test_update_endpoint_not_found(client: TestClient) -> None:
    """Editing an endpoint deleted meanwhile is a 404."""
    project = _create_project(client)
    response = client.patch(
        f"/api/v1/project/{project['id']}/endpoints/{MISSING}", json={"enabled": False}
    )
    assert response.status_code == 404


def test_delete_endpoint(client: TestClient) -> None:
    """Deleting an endpoint answers ok and its id reads 404 afterwards."""
    project = _create_project(client)
    endpoint = _create_endpoint(client, project["id"])
    url = f"/api/v1/project/{project['id']}/endpoints/{endpoint['id']}"
    response = client.delete(url)
    assert response.status_code == 200
    assert response.json() == {"ok": True}
    assert client.get(url).status_code == 404


def test_delete_endpoint_not_found(client: TestClient) -> None:
    """A second delete of the same endpoint is a 404."""
    project = _create_project(client)
    response = client.delete(f"/api/v1/project/{project['id']}/endpoints/{MISSING}")
    assert response.status_code == 404


def test_csrf_refuses_admin_write_from_untrusted_origin(client: TestClient) -> None:
    """A page on another origin cannot drive the admin API, while the admin UI can."""
    evil = client.post(BASE, json={"name": "Evil"}, headers={"Origin": "http://evil.example"})
    assert evil.status_code == 403
    trusted = client.post(
        BASE,
        json={"name": "Ours"},
        headers={"Origin": settings.csrf_trusted_origins[0], "Sec-Fetch-Site": "same-site"},
    )
    assert trusted.status_code == 201
