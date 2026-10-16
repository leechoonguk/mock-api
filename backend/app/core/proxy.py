# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import asyncio
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from time import perf_counter
from typing import Protocol

from mitmproxy import addons, http, options, tls
from mitmproxy.master import Master


# ============================================================
# Constants
# ============================================================

#: The CA certificate mitmproxy writes into its confdir on first start - what a
#: browser or OS must trust before the proxy can read its HTTPS.
CA_CERT_FILE = "mitmproxy-ca-cert.pem"

#: Where the request a handler took over is kept on its flow, and whether the
#: handler answered it itself (so the response hook does not log it twice).
REQUEST_KEY = "mock_api.request"
ANSWERED_KEY = "mock_api.answered"

#: How long `start` waits for the proxy to listen before the app goes on without it.
START_TIMEOUT_SECONDS = 10.0

#: How long `stop` waits for the proxy thread to finish its connections.
STOP_TIMEOUT_SECONDS = 5.0

#: How many passed-through hosts are remembered; past it the least recent goes.
SIGHTINGS_MAX = 500


# ============================================================
# Classes
# ============================================================


@dataclass(frozen=True)
class InterceptedRequest:
    """A request to an intercepted host, decrypted: where it went and what it carried.

    `path` is the raw path without its query; `query` the raw query string;
    `body` the decoded body. `started` is a `perf_counter` reading taken when
    the request arrived, so a handler measures the whole exchange.
    """

    scheme: str
    host: str
    method: str
    path: str
    query: str
    headers: list[tuple[str, str]]
    body: bytes
    started: float


@dataclass(frozen=True)
class HttpAnswer:
    """An HTTP response: status, headers in order (repeats kept), decoded body."""

    status_code: int
    headers: list[tuple[str, str]]
    content: bytes


@dataclass(frozen=True)
class HostSighting:
    """A host the proxy let through untouched: how many connections, and the last one."""

    host: str
    count: int
    last_seen: datetime


class HostSightings:
    """The hosts the proxy passed through, in memory, newest first - lost on restart.

    Written on the proxy's thread, read on the API's, so every access holds the lock.
    """

    def __init__(self) -> None:
        self._seen: dict[str, HostSighting] = {}
        self._lock = threading.Lock()

    def note(self, host: str) -> None:
        """Count one more connection to `host`; a blank host (no SNI) is not a host."""
        if not host:
            return
        with self._lock:
            previous = self._seen.pop(host, None)
            count = 1 if previous is None else previous.count + 1
            self._seen[host] = HostSighting(host, count, datetime.now(UTC))
            if len(self._seen) > SIGHTINGS_MAX:
                del self._seen[next(iter(self._seen))]

    def recent(self, limit: int) -> list[HostSighting]:
        """The `limit` most recently seen hosts, newest first."""
        with self._lock:
            return list(reversed(self._seen.values()))[:limit]


class InterceptHandler(Protocol):
    """What the proxy asks about each connection and request; the app answers.

    `intercepts` decides per host whether the proxy decrypts and hands the
    traffic over at all. `answer` returns the response to send, or None to let
    the request go on to the real server - whose answer, or None when it gave
    none, then reaches `forwarded`.
    """

    async def intercepts(self, host: str) -> bool: ...

    async def answer(self, request: InterceptedRequest) -> HttpAnswer | None: ...

    async def forwarded(self, request: InterceptedRequest, answer: HttpAnswer | None) -> None: ...


class InterceptAddon:
    """The mitmproxy addon that hands intercepted hosts' traffic to an `InterceptHandler`.

    A TLS connection to a host the handler does not claim is never decrypted
    (`ignore_connection`): it tunnels through as if no proxy were there, so a
    bank or a mail server never meets the local CA. Its host - read from the
    TLS hello, not the content - is noted in `sightings`, so a person can see
    which hosts a site talks to before choosing which to intercept.
    """

    def __init__(self, handler: InterceptHandler, sightings: HostSightings) -> None:
        self.handler = handler
        self.sightings = sightings

    async def tls_clienthello(self, data: tls.ClientHelloData) -> None:
        host = data.client_hello.sni or ""
        if not await self.handler.intercepts(host):
            data.ignore_connection = True
            self.sightings.note(host)

    async def request(self, flow: http.HTTPFlow) -> None:
        request = flow.request
        if not await self.handler.intercepts(request.pretty_host):
            self.sightings.note(request.pretty_host)
            return
        path, _, query = request.path.partition("?")
        intercepted = InterceptedRequest(
            scheme=request.scheme,
            host=request.pretty_host,
            method=request.method,
            path=path,
            query=query,
            headers=list(request.headers.items(multi=True)),
            body=request.get_content(strict=False) or b"",
            started=perf_counter(),
        )
        flow.metadata[REQUEST_KEY] = intercepted
        answer = await self.handler.answer(intercepted)
        if answer is not None:
            flow.metadata[ANSWERED_KEY] = True
            flow.response = http.Response.make(
                answer.status_code,
                answer.content,
                [(name.encode(), value.encode()) for name, value in answer.headers],
            )

    async def response(self, flow: http.HTTPFlow) -> None:
        intercepted = flow.metadata.get(REQUEST_KEY)
        if intercepted is None or flow.metadata.get(ANSWERED_KEY) or flow.response is None:
            return
        response = flow.response
        await self.handler.forwarded(
            intercepted,
            HttpAnswer(
                status_code=response.status_code,
                headers=list(response.headers.items(multi=True)),
                content=response.get_content(strict=False) or b"",
            ),
        )

    async def error(self, flow: http.HTTPFlow) -> None:
        intercepted = flow.metadata.get(REQUEST_KEY)
        if intercepted is None or flow.metadata.get(ANSWERED_KEY) or flow.response is not None:
            return
        await self.handler.forwarded(intercepted, None)


class InterceptingProxy:
    """A mitmproxy forward proxy run on its own thread and event loop.

    Its own loop, not the web server's: mitmproxy installs its task factory and
    exception handler on the loop it runs on, and the admin API should not run
    under them. The handler is built on that thread (`handler_factory`), so
    whatever it opens - a database engine - belongs to the proxy's loop.
    """

    def __init__(
        self,
        handler_factory: Callable[[], InterceptHandler],
        *,
        host: str,
        port: int,
        confdir: str,
    ) -> None:
        self.handler_factory = handler_factory
        self.host = host
        self.port = port
        self.confdir = confdir
        self.address: tuple[str, int] | None = None
        self._master: Master | None = None
        self._thread: threading.Thread | None = None
        self._ready = threading.Event()
        self.sightings = HostSightings()

    def start(self) -> None:
        """Start serving and wait until it listens - or failed to, leaving `address` None."""
        self._thread = threading.Thread(target=self._serve, name="intercepting-proxy", daemon=True)
        self._thread.start()
        self._ready.wait(START_TIMEOUT_SECONDS)

    def stop(self) -> None:
        """Close the listener and every connection, and wait for the thread to end."""
        if self._master is not None:
            self._master.shutdown()
        if self._thread is not None:
            self._thread.join(STOP_TIMEOUT_SECONDS)
        self.address = None

    def _serve(self) -> None:
        asyncio.run(self._run())

    async def _run(self) -> None:
        master = Master(
            options.Options(listen_host=self.host, listen_port=self.port, confdir=self.confdir)
        )
        master.addons.add(*addons.default_addons())
        master.addons.add(
            InterceptAddon(self.handler_factory(), self.sightings),
            _Listening(master, self._listening),
        )
        self._master = master
        try:
            await master.run()
        finally:
            # A proxy that never came up must not leave `start` waiting.
            self._ready.set()

    def _listening(self, address: tuple[str, int] | None) -> None:
        self.address = address
        self._ready.set()


class _Listening:
    """Reports the address the proxy bound - None when it could not bind - once mitmproxy runs.

    Holds its own master rather than reading mitmproxy's process-wide `ctx`,
    which the last master started in the process overwrites.
    """

    def __init__(
        self, master: Master, on_running: Callable[[tuple[str, int] | None], None]
    ) -> None:
        self.master = master
        self.on_running = on_running

    def running(self) -> None:
        server = self.master.addons.get("proxyserver")
        addresses = [] if server is None else server.listen_addrs()
        self.on_running(addresses[0][:2] if addresses else None)


# ============================================================
# Functions
# ============================================================


def ca_certificate(confdir: str) -> bytes | None:
    """The proxy's CA certificate (PEM) to install as trusted, or None before it was generated."""
    path = Path(confdir) / CA_CERT_FILE
    return path.read_bytes() if path.is_file() else None
