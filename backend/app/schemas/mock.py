# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import json
from collections.abc import Collection
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.core.proxy import HttpAnswer
from app.core.settings import MAX_LOG_BODY_BYTES, MAX_STORED_BODY_BYTES
from app.engine.ranges import UNSATISFIABLE, byte_range
from app.models.project import ProjectMode
from app.schemas.endpoint import EndpointCreateRequest, EndpointReadResponse, recorded_endpoint


# ============================================================
# Constants
# ============================================================

#: The one header a repeat cannot be folded into: cookies hold commas.
UNFOLDABLE_HEADER = "set-cookie"

#: Headers a recording leaves out. Connection-level ones (RFC 9110 §7.6.1)
#: describe one hop, not the message; the body is kept decoded, so its encoding
#: and length are the replay's to declare - a recorded `content-encoding: gzip`
#: over a decoded body would make the client fail to read it.
UNRECORDED_HEADERS = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "proxy-connection",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
        "content-encoding",
        "content-length",
    }
)

#: The content type of a rendered body that parses as JSON, and of one that does not.
JSON_CONTENT_TYPE = "application/json"
TEXT_CONTENT_TYPE = "text/plain; charset=utf-8"

#: The content type of a stored answer recorded without one.
OCTET_STREAM = "application/octet-stream"

#: Statuses that carry no body by definition: sending one breaks the connection's
#: framing, so the declared body is dropped rather than the response failing.
BODILESS_STATUSES = frozenset({204, 304})

#: The statuses a ranged answer uses: the whole body asked for, a part of it, none of it.
OK_STATUS = 200
PARTIAL_CONTENT = 206
RANGE_NOT_SATISFIABLE = 416

#: Recorded headers a ranged answer writes itself, so the recording's are dropped.
RANGE_HEADERS = frozenset({"accept-ranges", "content-range"})


# ============================================================
# Classes
# ============================================================


class MockResolution(BaseModel):
    """Which project an intercepted request belongs to, and how it is answered.

    In `record` mode `endpoint` is None and the request goes on to the real
    server. In `mock` mode `endpoint` is the best match - a snapshot read before
    the response is delayed and rendered, so an edit saved meanwhile cannot
    change the answer halfway - or None, and the request fails.
    """

    model_config = ConfigDict(extra="forbid")

    project_id: UUID
    mode: ProjectMode
    endpoint: EndpointReadResponse | None
    params: dict[str, str]


class UpstreamCapture(BaseModel):
    """What the log keeps of a real server's answer, and the endpoint it would replay as.

    `response_body` is the answer's decoded start, cut at the log limit; a
    binary or longer answer is kept whole in the body store as
    `response_body_ref`. `endpoint` is None when the exchange cannot be one: a
    request body cut at the log limit or not UTF-8, an answer neither text the
    log holds nor stored, or a path, status or header an endpoint cannot hold.
    """

    model_config = ConfigDict(extra="forbid")

    response_headers: dict[str, str]
    response_body: str
    response_body_ref: str | None
    response_size: int
    endpoint: EndpointCreateRequest | None


# ============================================================
# Functions
# ============================================================


def needs_body_store(content: bytes) -> bool:
    """Whether an answer must be kept in the body store to be replayed: binary or too long
    for the log, and still within what the store keeps."""
    return _complete_text(content) is None and len(content) <= MAX_STORED_BODY_BYTES


def capture_upstream(
    method: str,
    host: str,
    path: str,
    query: str,
    request_body: bytes,
    upstream: HttpAnswer,
    ignored: Collection[str],
    stored_ref: str | None,
) -> UpstreamCapture:
    """Fold a real server's answer into what the log keeps and the endpoint it would record as.

    An endpoint holds one value per header name, so a repeated header is joined with `, `
    (an RFC 9110 list) - except `set-cookie`, whose first value is kept. The request's
    host, query and body become the endpoint's host and exact conditions, the
    `ignored` fields left out of them. `stored_ref` is the body store's copy of an
    answer `needs_body_store` sent there; the endpoint then answers it.
    """
    headers: dict[str, str] = {}
    for raw_name, value in upstream.headers:
        name = raw_name.lower()
        if name in UNRECORDED_HEADERS:
            continue
        if name not in headers:
            headers[name] = value
        elif name != UNFOLDABLE_HEADER:
            headers[name] = f"{headers[name]}, {value}"
    request_text = _complete_text(request_body)
    answer_text = _complete_text(upstream.content)
    endpoint = None
    if request_text is not None and (answer_text is not None or stored_ref is not None):
        endpoint = recorded_endpoint(
            method,
            host,
            path,
            query,
            request_text,
            upstream.status_code,
            headers,
            answer_text or "",
            None if answer_text is not None else stored_ref,
            ignored,
        )
    return UpstreamCapture(
        response_headers=headers,
        response_body=upstream.content[:MAX_LOG_BODY_BYTES].decode("utf-8", errors="replace"),
        response_body_ref=None if answer_text is not None else stored_ref,
        response_size=len(upstream.content),
        endpoint=endpoint,
    )


def text_content_type(body: str) -> str:
    """The content type of a typed body: JSON when it parses as JSON, plain text otherwise."""
    try:
        json.loads(body)
    except ValueError:
        return TEXT_CONTENT_TYPE
    return JSON_CONTENT_TYPE


def mock_answer(
    endpoint: EndpointReadResponse,
    content: bytes,
    content_type: str,
    method: str,
    range_header: str | None,
) -> HttpAnswer:
    """The endpoint's response: its status and headers, `content`, a content type.

    The endpoint's own `content-type` wins over `content_type`. A HEAD, a 1xx, a
    204 or a 304 carries no body. A 200 is cut to the bytes a `Range` header
    asks for - a 206 with its `content-range`, or a 416 for a range past the
    end - so a video player can seek in a recorded file.
    """
    headers = list(endpoint.headers.items())
    if not any(name.lower() == "content-type" for name, _ in headers):
        headers.append(("content-type", content_type))
    status_code = endpoint.status_code
    if method == "HEAD" or status_code < 200 or status_code in BODILESS_STATUSES:
        return HttpAnswer(status_code=status_code, headers=headers, content=b"")
    span = byte_range(range_header, len(content)) if status_code == OK_STATUS else None
    if span is None:
        return HttpAnswer(status_code=status_code, headers=headers, content=content)
    headers = [(name, value) for name, value in headers if name.lower() not in RANGE_HEADERS] + [
        ("accept-ranges", "bytes")
    ]
    if span == UNSATISFIABLE:
        headers.append(("content-range", f"bytes */{len(content)}"))
        return HttpAnswer(status_code=RANGE_NOT_SATISFIABLE, headers=headers, content=b"")
    first, last = span
    headers.append(("content-range", f"bytes {first}-{last}/{len(content)}"))
    return HttpAnswer(
        status_code=PARTIAL_CONTENT, headers=headers, content=content[first : last + 1]
    )


def _complete_text(content: bytes) -> str | None:
    """`content` as text when the log holds all of it and it is UTF-8, else None."""
    if len(content) > MAX_LOG_BODY_BYTES:
        return None
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        return None
