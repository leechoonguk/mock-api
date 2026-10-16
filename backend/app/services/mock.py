# ============================================================
# Imports
# ============================================================

from __future__ import annotations

import asyncio
import json
from time import perf_counter
from urllib.parse import parse_qsl
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.body_store import body_store
from app.core.proxy import HttpAnswer, InterceptedRequest
from app.core.settings import LOG_RETENTION_PER_PROJECT, MAX_LOG_BODY_BYTES
from app.engine.hosts import best_host_pattern, normalize_host
from app.engine.matcher import find_best, normalize_path
from app.engine.templating import RenderContext, render
from app.models.project import RECORD_MODE, Project
from app.repositories.endpoint import EndpointRepository
from app.repositories.project import ProjectRepository
from app.repositories.request_log import RequestLogRepository
from app.schemas.endpoint import EndpointReadResponse, to_read_list
from app.schemas.mock import (
    OCTET_STREAM,
    MockResolution,
    capture_upstream,
    mock_answer,
    needs_body_store,
    text_content_type,
)
from app.schemas.request_log import RequestLogCreateInternal


# ============================================================
# Constants
# ============================================================

#: What a mock-mode request no endpoint answers gets, and the status a forwarded
#: request is logged with when the real server gave no answer.
NOT_MATCHED_STATUS = 404
NO_ANSWER_STATUS = 502

#: What an endpoint whose stored answer is gone from the body store answers.
BODY_MISSING_STATUS = 502


# ============================================================
# Classes
# ============================================================


class MockService:
    """Answers intercepted requests: which project and endpoint they reach, and the log of it."""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.project_repository = ProjectRepository(session)
        self.endpoint_repository = EndpointRepository(session)

    async def intercepts(self, host: str) -> bool:
        """Whether a project claims `host` - the proxy decrypts only those connections."""
        return await self._project_for(normalize_host(host)) is not None

    async def answer_request(self, request: InterceptedRequest) -> HttpAnswer | None:
        """The answer to send for an intercepted request, or None to forward it.

        A mock-mode request is answered here and logged: by its endpoint - the
        delay spent first and counted in the logged duration - or, when none
        matches, with a 404 `mock_not_matched`. A record-mode request is left to
        the real server and logged when its answer comes back.
        """
        host = normalize_host(request.host)
        path = normalize_path(request.path)
        body = request.body.decode("utf-8", errors="replace")
        resolution = await self._resolve(host, request.method, path, request.query, body)
        if resolution is None or resolution.mode == RECORD_MODE:
            return None
        endpoint = resolution.endpoint
        if endpoint is None:
            answer = _not_matched(request.method, path)
        else:
            if endpoint.delay_ms > 0:
                await asyncio.sleep(endpoint.delay_ms / 1000)
            answer = await _endpoint_answer(endpoint, resolution.params, request, body)
        await self._create_request_log(
            _log_entry(
                resolution.project_id,
                request,
                answer.status_code,
                endpoint_id=None if endpoint is None else endpoint.id,
            )
        )
        return answer

    async def create_forwarded_log(
        self, request: InterceptedRequest, answer: HttpAnswer | None
    ) -> None:
        """Log a record-mode request with the real server's answer, or a 502 when it gave none."""
        host = normalize_host(request.host)
        project = await self._project_for(host)
        if project is None:
            return
        if answer is None:
            await self._create_request_log(
                _log_entry(project.id, request, NO_ANSWER_STATUS, proxied=True)
            )
            return
        path = normalize_path(request.path)
        # Written off the loop: a recorded video segment is megabytes to a disk.
        stored_ref = (
            await asyncio.to_thread(body_store().put, answer.content)
            if needs_body_store(answer.content)
            else None
        )
        capture = capture_upstream(
            request.method,
            host,
            path,
            request.query,
            request.body,
            answer,
            project.ignored_fields,
            stored_ref,
        )
        await self._create_request_log(
            _log_entry(
                project.id,
                request,
                answer.status_code,
                proxied=True,
                response_headers=capture.response_headers,
                response_body=capture.response_body,
                response_body_ref=capture.response_body_ref,
                response_size=capture.response_size,
                recordable=capture.endpoint is not None,
            )
        )

    async def delete_orphan_bodies(self) -> int:
        """Delete the stored answers no log row or endpoint refers to any more; how many went.

        A log row trimmed by retention or cleared, or an endpoint deleted, leaves
        its stored answer behind; the app sweeps them once when it starts.
        """
        keep = await RequestLogRepository(self.session).list_body_refs()
        keep |= await self.endpoint_repository.list_body_refs()
        return await asyncio.to_thread(body_store().sweep, keep)

    async def _resolve(
        self, host: str, method: str, path: str, query: str, body: str
    ) -> MockResolution | None:
        """The project that claims `host` and how it answers, or None when none claims it.

        In record mode no endpoint is read: the request goes to the real server.
        In mock mode the best matching endpoint answers, or nothing does. A read
        only - no transaction.
        """
        project = await self._project_for(host)
        if project is None:
            return None
        if project.mode == RECORD_MODE:
            return MockResolution(project_id=project.id, mode="record", endpoint=None, params={})
        endpoints = await self.endpoint_repository.list_enabled_by_project(project.id)
        # Matched as snapshots: the answer is fixed when the request is resolved,
        # so an edit saved during the endpoint's delay cannot change it halfway.
        found = find_best(
            to_read_list(endpoints), method, host, path, query, body, project.ignored_fields
        )
        endpoint, params = (None, {}) if found is None else found
        return MockResolution(project_id=project.id, mode="mock", endpoint=endpoint, params=params)

    async def _create_request_log(self, data: RequestLogCreateInternal) -> None:
        """Store one request on its own session, then trim the project's log to its retention.

        Not the request's session: it already holds the read that resolved the
        endpoint, so `begin()` on it would raise "a transaction is already
        begun". The engine comes from that session, so the tests' engine is the
        one written to.
        """
        async with AsyncSession(self.session.bind, expire_on_commit=False) as session:
            request_log_repository = RequestLogRepository(session)
            async with session.begin():
                await request_log_repository.create(data)
                await request_log_repository.delete_overflow(
                    data.project_id, keep=LOG_RETENTION_PER_PROJECT
                )

    async def _project_for(self, host: str) -> Project | None:
        """The project one of whose patterns claims `host` best, or None."""
        projects = await self.project_repository.list_with_hosts()
        claims = {pattern: project for project in projects for pattern in project.hosts}
        pattern = best_host_pattern(claims, host)
        return None if pattern is None else claims[pattern]


# ============================================================
# Functions
# ============================================================


def _not_matched(method: str, path: str) -> HttpAnswer:
    """The failure a mock-mode request no endpoint answers gets, named like the API's errors."""
    content = json.dumps(
        {
            "detail": f"No mock endpoint matches {method} {path}",
            "code": "mock_not_matched",
            "method": method,
            "path": path,
        }
    ).encode()
    return HttpAnswer(
        status_code=NOT_MATCHED_STATUS,
        headers=[("content-type", "application/json")],
        content=content,
    )


async def _endpoint_answer(
    endpoint: EndpointReadResponse,
    params: dict[str, str],
    request: InterceptedRequest,
    body: str,
) -> HttpAnswer:
    """The endpoint's answer to `request`: its stored bytes, or its body template rendered."""
    headers = _lowered(request.headers)
    if endpoint.body_ref is not None:
        stored = await asyncio.to_thread(body_store().get, endpoint.body_ref)
        if stored is None:
            return _body_missing(endpoint.body_ref)
        return mock_answer(endpoint, stored, OCTET_STREAM, request.method, headers.get("range"))
    context = RenderContext(
        path_params=params,
        query=_first_values(request.query),
        headers=headers,
        body_raw=body,
    )
    rendered = render(endpoint.body, context)
    return mock_answer(
        endpoint,
        rendered.encode("utf-8"),
        text_content_type(rendered),
        request.method,
        headers.get("range"),
    )


def _body_missing(body_ref: str) -> HttpAnswer:
    """The failure of an endpoint whose recorded answer is gone from the body store."""
    content = json.dumps(
        {
            "detail": f"The recorded answer {body_ref} is missing from the body store",
            "code": "mock_body_missing",
        }
    ).encode()
    return HttpAnswer(
        status_code=BODY_MISSING_STATUS,
        headers=[("content-type", "application/json")],
        content=content,
    )


def _log_entry(
    project_id: UUID,
    request: InterceptedRequest,
    status: int,
    *,
    endpoint_id: UUID | None = None,
    proxied: bool = False,
    response_headers: dict[str, str] | None = None,
    response_body: str | None = None,
    response_body_ref: str | None = None,
    response_size: int | None = None,
    recordable: bool = False,
) -> RequestLogCreateInternal:
    """One log row for `request`, its duration measured from when it arrived."""
    return RequestLogCreateInternal(
        project_id=project_id,
        endpoint_id=endpoint_id,
        method=request.method,
        scheme=request.scheme,
        host=normalize_host(request.host),
        path=normalize_path(request.path),
        query_string=request.query,
        request_headers=_lowered(request.headers),
        request_body=request.body[:MAX_LOG_BODY_BYTES].decode("utf-8", errors="replace"),
        response_status=status,
        matched=endpoint_id is not None,
        proxied=proxied,
        response_headers=response_headers,
        response_body=response_body,
        response_body_ref=response_body_ref,
        response_size=response_size,
        recordable=recordable,
        duration_ms=round((perf_counter() - request.started) * 1000),
    )


def _first_values(query: str) -> dict[str, str]:
    """Each query parameter's first value - what `{{query.<name>}}` renders."""
    values: dict[str, str] = {}
    for name, value in parse_qsl(query, keep_blank_values=True):
        values.setdefault(name, value)
    return values


def _lowered(headers: list[tuple[str, str]]) -> dict[str, str]:
    """Headers by lower-case name, the first of a repeat kept - what the log and templates read."""
    values: dict[str, str] = {}
    for name, value in headers:
        values.setdefault(name.lower(), value)
    return values
