"""The intercepting proxy: a real mitmproxy, a real client, a real server behind it.

What the addon promises - a claimed host's request reaches the handler, an
answer from the handler never reaches the server, the server's answer comes
back decoded, an unclaimed connection is left alone - is only true of the
running proxy, so these drive one on a free port.
"""

import gzip
import socket
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from types import SimpleNamespace
from typing import cast

import httpx2 as httpx
import pytest
from mitmproxy import tls

from app.core import proxy as proxy_module
from app.core.proxy import (
    HostSightings,
    HttpAnswer,
    InterceptAddon,
    InterceptedRequest,
    InterceptingProxy,
    ca_certificate,
)


class _Handler:
    """An `InterceptHandler` that claims every host while `claiming`, and answers `/mock/...`."""

    def __init__(self) -> None:
        self.claiming = True
        self.forwards: list[tuple[InterceptedRequest, HttpAnswer | None]] = []

    async def intercepts(self, host: str) -> bool:
        return self.claiming

    async def answer(self, request: InterceptedRequest) -> HttpAnswer | None:
        if not request.path.startswith("/mock"):
            return None
        return HttpAnswer(201, [("content-type", "text/plain"), ("x-mock", "1")], b"mocked")

    async def forwarded(self, request: InterceptedRequest, answer: HttpAnswer | None) -> None:
        self.forwards.append((request, answer))


class _Server(BaseHTTPRequestHandler):
    """The real server: answers every GET with a gzip-encoded body and two cookies."""

    def do_GET(self) -> None:  # noqa: N802 - the stdlib's hook name
        body = gzip.compress(b'{"from":"server"}')
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-encoding", "gzip")
        self.send_header("set-cookie", "a=1")
        self.send_header("set-cookie", "b=2")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - stdlib signature
        """Keep the suite's output to its own."""


@pytest.fixture()
def server() -> Iterator[str]:
    """A plain-HTTP server on a free port; its base URL."""
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), _Server)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    thread.join()


@pytest.fixture()
def handler() -> _Handler:
    """A handler that claims every host until told otherwise."""
    return _Handler()


@pytest.fixture()
def proxy(handler: _Handler, tmp_path: Path) -> Iterator[InterceptingProxy]:
    """The proxy on a free port, its CA in the test's own directory."""
    running = InterceptingProxy(lambda: handler, host="127.0.0.1", port=0, confdir=str(tmp_path))
    running.start()
    yield running
    running.stop()


def _client(proxy: InterceptingProxy) -> httpx.Client:
    assert proxy.address is not None
    host, port = proxy.address
    return httpx.Client(proxy=f"http://{host}:{port}", timeout=10, trust_env=False)


def test_claimed_request_reaches_the_server_and_its_answer_the_handler(
    proxy: InterceptingProxy, handler: _Handler, server: str, tmp_path: Path
) -> None:
    """The client gets the server's answer; the handler gets it decoded, with the request."""
    with _client(proxy) as client:
        response = client.get(f"{server}/orders/7?page=1")
    assert (response.status_code, response.json()) == (200, {"from": "server"})
    [(request, answer)] = handler.forwards
    assert (request.scheme, request.method, request.path, request.query) == (
        "http",
        "GET",
        "/orders/7",
        "page=1",
    )
    assert request.host == "127.0.0.1"
    assert answer is not None
    assert (answer.status_code, answer.content) == (200, b'{"from":"server"}')
    assert [value for name, value in answer.headers if name == "set-cookie"] == ["a=1", "b=2"]
    assert ca_certificate(str(tmp_path)) is not None


def test_handler_answer_never_reaches_the_server(
    proxy: InterceptingProxy, handler: _Handler, server: str
) -> None:
    """A request the handler answers comes back as it said, and is not forwarded."""
    with _client(proxy) as client:
        response = client.get(f"{server}/mock/x")
    assert (response.status_code, response.text, response.headers["x-mock"]) == (
        201,
        "mocked",
        "1",
    )
    assert handler.forwards == []


def test_unclaimed_request_passes_through_untouched(
    proxy: InterceptingProxy, handler: _Handler, server: str
) -> None:
    """A host the handler does not claim is relayed and only its name noted.

    Not even when the server does not answer does the handler hear of it: that
    failure is the client's alone.
    """
    handler.claiming = False
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        closed_port = probe.getsockname()[1]
    with _client(proxy) as client:
        assert client.get(f"{server}/mock/x").json() == {"from": "server"}
        assert client.get(f"http://127.0.0.1:{closed_port}/down").status_code == 502
    assert handler.forwards == []
    [seen] = proxy.sightings.recent(10)
    assert (seen.host, seen.count) == ("127.0.0.1", 2)


def test_server_that_does_not_answer_is_reported_without_an_answer(
    proxy: InterceptingProxy, handler: _Handler
) -> None:
    """A refused connection reaches the handler as a forward with no answer."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        closed_port = probe.getsockname()[1]
    with _client(proxy) as client:
        response = client.get(f"http://127.0.0.1:{closed_port}/down")
    assert response.status_code == 502
    [(request, answer)] = handler.forwards
    assert (request.path, answer) == ("/down", None)


def test_a_taken_port_leaves_the_proxy_down(proxy: InterceptingProxy, tmp_path: Path) -> None:
    """A second proxy on the same port does not listen; `start` returns instead of hanging."""
    assert proxy.address is not None
    second = InterceptingProxy(
        _Handler, host="127.0.0.1", port=proxy.address[1], confdir=str(tmp_path)
    )
    second.start()
    try:
        assert second.address is None
    finally:
        second.stop()


async def test_unclaimed_tls_connection_is_not_decrypted_but_noted() -> None:
    """A TLS hello for a host nobody claims tunnels through opaque, its name remembered."""
    handler = _Handler()
    sightings = HostSightings()
    addon = InterceptAddon(handler, sightings)
    claimed = SimpleNamespace(
        client_hello=SimpleNamespace(sni="youtube.com"), ignore_connection=False
    )
    await addon.tls_clienthello(cast(tls.ClientHelloData, claimed))
    assert claimed.ignore_connection is False
    handler.claiming = False
    other = SimpleNamespace(
        client_hello=SimpleNamespace(sni="bank.example"), ignore_connection=False
    )
    await addon.tls_clienthello(cast(tls.ClientHelloData, other))
    assert other.ignore_connection is True
    assert [seen.host for seen in sightings.recent(10)] == ["bank.example"]


def test_sightings_count_order_newest_first_and_forget_the_oldest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A repeat moves a host to the front with its count; past the cap the least recent goes."""
    monkeypatch.setattr(proxy_module, "SIGHTINGS_MAX", 2)
    sightings = HostSightings()
    for host in ("a.com", "b.com", "", "a.com", "c.com"):
        sightings.note(host)
    assert [(seen.host, seen.count) for seen in sightings.recent(10)] == [
        ("c.com", 1),
        ("a.com", 2),
    ]
    assert [seen.host for seen in sightings.recent(1)] == ["c.com"]


def test_ca_certificate_is_none_before_the_proxy_wrote_it(tmp_path: Path) -> None:
    """Nothing to download until the first start generated the CA."""
    assert ca_certificate(str(tmp_path)) is None
