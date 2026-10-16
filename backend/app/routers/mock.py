# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import asyncio
import json
from time import perf_counter

from fastapi import APIRouter, Request, Response

from app.core.exceptions import MockNotMatchedError
from app.core.settings import MAX_LOG_BODY_BYTES, MOCK_PREFIX
from app.dependencies.services import MockServiceDep
from app.engine.matcher import normalize_path
from app.engine.templating import RenderContext, render
from app.schemas.endpoint import EndpointReadResponse
from app.schemas.mock import REQUEST_METHODS
from app.schemas.request_log import RequestLogCreateInternal


# ============================================================
# Constants
# ============================================================

#: The content type of a rendered body that parses as JSON, and of one that does not.
JSON_CONTENT_TYPE = "application/json"
TEXT_CONTENT_TYPE = "text/plain; charset=utf-8"

#: Statuses that carry no body by definition: sending one breaks the connection's
#: framing, so the declared body is dropped rather than the response failing.
BODILESS_STATUSES = frozenset({204, 304})


# ============================================================
# Router
# ============================================================

# Outside /api/v1 and exempt from CSRF: a mock is called by the program under
# test, from whatever origin it runs on, exactly like the API it stands in for.
router = APIRouter(prefix=MOCK_PREFIX, tags=["mock"])


@router.api_route("/{slug}/{path:path}", methods=REQUEST_METHODS)
@router.api_route("/{slug}", methods=REQUEST_METHODS)
async def serve_mock(slug: str, request: Request, mock_service: MockServiceDep) -> Response:
    """Answer a mocked request with the project's best matching endpoint, and log it.

    An unknown project is a 404 `not_found` and is not logged; a request no
    endpoint matches is a 404 `mock_not_matched` and is logged, because that
    miss is what the log is read for. The delay is spent before answering and
    counts in the logged duration.
    """
    started = perf_counter()
    body = await request.body()
    method = request.method
    path = _raw_path(request)
    resolution = await mock_service.resolve(slug, method, path)
    endpoint = resolution.endpoint
    response: Response | None = None
    if endpoint is not None:
        if endpoint.delay_ms > 0:
            await asyncio.sleep(endpoint.delay_ms / 1000)
        context = RenderContext(
            path_params=resolution.params,
            query=_first_values(request),
            headers=dict(request.headers),
            body_raw=body.decode("utf-8", errors="replace"),
        )
        response = _respond(endpoint, render(endpoint.body, context), method)
    await mock_service.create_request_log(
        RequestLogCreateInternal(
            project_id=resolution.project_id,
            endpoint_id=None if endpoint is None else endpoint.id,
            method=method,
            path=path,
            query_string=request.url.query,
            request_headers=dict(request.headers),
            request_body=body[:MAX_LOG_BODY_BYTES].decode("utf-8", errors="replace"),
            response_status=404 if response is None else response.status_code,
            matched=response is not None,
            duration_ms=round((perf_counter() - started) * 1000),
        )
    )
    if response is None:
        raise MockNotMatchedError(method, path)
    return response


# ============================================================
# Functions
# ============================================================


def _raw_path(request: Request) -> str:
    """The request path after `/mock/<slug>`, still percent-encoded.

    Read from the raw path rather than the decoded `{path}` parameter, so an
    encoded `/` (`%2F`) stays inside its segment instead of splitting it.
    """
    raw = request.scope["raw_path"].decode("latin-1")
    rest = raw.split("/", 3)
    return normalize_path(rest[3] if len(rest) == 4 else "")


def _first_values(request: Request) -> dict[str, str]:
    """Each query parameter's first value - what `{{query.<name>}}` renders."""
    values: dict[str, str] = {}
    for name, value in request.query_params.multi_items():
        values.setdefault(name, value)
    return values


def _respond(endpoint: EndpointReadResponse, body: str, method: str) -> Response:
    """The endpoint's response: its status and headers, the rendered body, a content type.

    The endpoint's own headers win over every default, including the security
    headers the middleware adds - a mock reproduces the API it stands in for.
    """
    headers = dict(endpoint.headers)
    if not any(name.lower() == "content-type" for name in headers):
        headers["content-type"] = _content_type(body)
    status_code = endpoint.status_code
    bodiless = method == "HEAD" or status_code < 200 or status_code in BODILESS_STATUSES
    content = b"" if bodiless else body.encode("utf-8")
    return Response(content=content, status_code=status_code, headers=headers)


def _content_type(body: str) -> str:
    try:
        json.loads(body)
    except ValueError:
        return TEXT_CONTENT_TYPE
    return JSON_CONTENT_TYPE
