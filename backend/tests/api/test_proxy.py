"""Proxy admin API: where a client points, and the CA certificate it must trust.

The suite's app runs without its proxy (`PROXY_ENABLED=false`), so the status
reports it down; the CA is read from a confdir the test fills.
"""

from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.core.proxy import CA_CERT_FILE, HostSightings
from app.core.settings import settings
from app.main import app


URL = "/api/v1/proxy/"


@pytest.fixture()
def confdir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A confdir of the suite's own, so no developer CA is read or served."""
    monkeypatch.setattr(settings, "proxy_confdir", str(tmp_path))
    return tmp_path


def test_proxy_status_reports_a_proxy_that_is_down(client: TestClient, confdir: Path) -> None:
    """Turned off and without a CA: not listening, nothing to download, the port still named."""
    body = client.get(URL).json()
    assert body == {
        "enabled": False,
        "listening": False,
        "host": "127.0.0.1",
        "port": settings.proxy_port,
        "ca_ready": False,
        "passed_hosts": [],
    }


def test_proxy_status_lists_the_hosts_it_let_through(
    client: TestClient, confdir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A running proxy reports its bound address and the passed hosts, newest first."""
    sightings = HostSightings()
    for host in ("www.youtube.com", "i.ytimg.com", "www.youtube.com"):
        sightings.note(host)
    running = SimpleNamespace(address=("127.0.0.1", 47900), sightings=sightings)
    monkeypatch.setattr(app.state, "proxy", running, raising=False)
    body = client.get(URL).json()
    assert (body["listening"], body["port"]) == (True, 47900)
    assert [(seen["host"], seen["count"]) for seen in body["passed_hosts"]] == [
        ("www.youtube.com", 2),
        ("i.ytimg.com", 1),
    ]
    assert body["passed_hosts"][0]["last_seen"].endswith("Z")


def test_proxy_ca_is_404_until_generated_then_served(client: TestClient, confdir: Path) -> None:
    """The certificate downloads as a file once the proxy has written it."""
    missing = client.get("/api/v1/proxy/ca")
    assert (missing.status_code, missing.json()["code"]) == (404, "not_found")
    (confdir / CA_CERT_FILE).write_bytes(b"-----BEGIN CERTIFICATE-----\n")
    served = client.get("/api/v1/proxy/ca")
    assert served.status_code == 200
    assert served.content == b"-----BEGIN CERTIFICATE-----\n"
    assert served.headers["content-type"] == "application/x-x509-ca-cert"
    assert "mock-api-ca.crt" in served.headers["content-disposition"]
    assert client.get(URL).json()["ca_ready"] is True
