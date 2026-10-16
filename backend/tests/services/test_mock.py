"""MockService: who handles an intercepted request, how it is answered, and the log of it.

The proxy hands every decrypted request to these methods, so each mode's
contract - record forwards and logs the real answer, mock answers or fails -
is pinned here with the request the proxy would build.
"""

import json
from pathlib import Path
from uuid import UUID

import pytest
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.body_store import body_store
from app.core.proxy import HttpAnswer
from app.schemas import mock as mock_schemas
from app.schemas.endpoint import EndpointCreateRequest, EndpointRecordManyRequest
from app.schemas.project import ProjectCreateRequest, ProjectUpdateRequest
from app.schemas.request_log import RequestLogFilter
from app.services import mock as mock_module
from app.services.endpoint import EndpointService
from app.services.mock import MockService
from app.services.project import ProjectService
from app.services.request_log import RequestLogService
from tests.conftest import BuildRequest


EVERYTHING = RequestLogFilter()

#: What the real server answers in the record-mode cases.
REAL_ANSWER = HttpAnswer(
    status_code=207,
    headers=[
        ("Content-Type", "application/json"),
        ("Set-Cookie", "a=1"),
        ("Set-Cookie", "b=2"),
        ("Vary", "Accept"),
        ("Vary", "Origin"),
        ("Content-Encoding", "gzip"),
        ("Connection", "close"),
    ],
    content=b'{"from":"server"}',
)


async def _project(
    factory: async_sessionmaker[AsyncSession],
    *,
    mode: str = "mock",
    hosts: list[str] | None = None,
    ignored_fields: list[str] | None = None,
) -> UUID:
    async with factory() as session:
        project = await ProjectService(session).create_project(
            ProjectCreateRequest.model_validate(
                {
                    "name": "Demo",
                    "hosts": hosts or ["api.example.com"],
                    "mode": mode,
                    "ignored_fields": ignored_fields or [],
                }
            )
        )
    return project.id


async def _endpoint(
    factory: async_sessionmaker[AsyncSession], project_id: UUID, **fields: object
) -> None:
    async with factory() as session:
        await EndpointService(session).create_endpoint(
            project_id, EndpointCreateRequest.model_validate(fields)
        )


async def _logs(factory: async_sessionmaker[AsyncSession], project_id: UUID) -> list:
    async with factory() as session:
        return await RequestLogService(session).list_request_logs(project_id, EVERYTHING)


async def test_intercepts_only_claimed_hosts(factory: async_sessionmaker[AsyncSession]) -> None:
    """An exact host or a wildcard's subdomain is claimed, in any case; anything else is not."""
    await _project(factory, hosts=["youtube.com", "*.ytimg.com"])
    async with factory() as session:
        service = MockService(session)
        assert await service.intercepts("YouTube.com")
        assert await service.intercepts("i.ytimg.com")
        assert not await service.intercepts("ytimg.com")
        assert not await service.intercepts("example.org")


async def test_mock_mode_answers_with_the_rendered_endpoint_and_logs_it(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """The endpoint's status and headers come back, the body rendered from the request."""
    project_id = await _project(factory)
    await _endpoint(
        factory,
        project_id,
        method="POST",
        path="/users/{id}",
        status_code=201,
        headers={"X-Mock": "1"},
        body='{"id":"{{path.id}}","q":"{{query.q}}","h":"{{headers.x-user}}","b":"{{body.a}}"}',
    )
    request = intercepted(
        "/users/7",
        method="POST",
        query="q=x&q=y",
        body=b'{"a":"z"}',
        headers=[("X-User", "kim")],
    )
    async with factory() as session:
        answer = await MockService(session).answer_request(request)
    assert answer is not None
    assert answer.status_code == 201
    assert dict(answer.headers) == {"X-Mock": "1", "content-type": "application/json"}
    assert json.loads(answer.content) == {"id": "7", "q": "x", "h": "kim", "b": "z"}
    [log] = await _logs(factory, project_id)
    assert (log.host, log.scheme, log.path, log.query_string) == (
        "api.example.com",
        "https",
        "/users/7",
        "q=x&q=y",
    )
    assert (log.matched, log.proxied, log.response_status) == (True, False, 201)
    assert log.request_headers == {"x-user": "kim"}


async def test_mock_mode_miss_is_a_logged_404_never_forwarded(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A request no endpoint answers gets `mock_not_matched` naming the request, and is logged."""
    project_id = await _project(factory)
    async with factory() as session:
        answer = await MockService(session).answer_request(intercepted("/nope", method="DELETE"))
    assert answer is not None
    assert answer.status_code == 404
    assert json.loads(answer.content) == {
        "detail": "No mock endpoint matches DELETE /nope",
        "code": "mock_not_matched",
        "method": "DELETE",
        "path": "/nope",
    }
    [log] = await _logs(factory, project_id)
    assert (log.matched, log.proxied, log.response_status) == (False, False, 404)


async def test_mock_mode_drops_the_body_where_http_has_none(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A HEAD gets the GET's status without its body; a 204 never carries one."""
    project_id = await _project(factory)
    await _endpoint(factory, project_id, method="GET", path="/users", body="hello")
    await _endpoint(factory, project_id, method="DELETE", path="/users", status_code=204, body="x")
    async with factory() as session:
        service = MockService(session)
        head = await service.answer_request(intercepted("/users", method="HEAD"))
        deleted = await service.answer_request(intercepted("/users", method="DELETE"))
    assert head is not None
    assert deleted is not None
    assert (head.status_code, head.content) == (200, b"")
    assert ("content-type", "text/plain; charset=utf-8") in head.headers
    assert (deleted.status_code, deleted.content) == (204, b"")


async def test_mock_mode_spends_the_delay_and_logs_it(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A declared delay holds the answer at least that long and counts in the logged duration."""
    project_id = await _project(factory)
    await _endpoint(factory, project_id, method="GET", path="/slow", delay_ms=150)
    async with factory() as session:
        await MockService(session).answer_request(intercepted("/slow"))
    [log] = await _logs(factory, project_id)
    assert log.duration_ms >= 150


async def test_an_endpoint_on_another_host_does_not_answer(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A route pinned to one host of the project answers there only."""
    project_id = await _project(factory, hosts=["*.example.com"])
    await _endpoint(factory, project_id, method="GET", host="a.example.com", path="/x", body="a")
    async with factory() as session:
        service = MockService(session)
        here = await service.answer_request(intercepted("/x", host="a.example.com"))
        there = await service.answer_request(intercepted("/x", host="b.example.com"))
    assert here is not None
    assert there is not None
    assert (here.content, there.status_code) == (b"a", 404)


async def test_record_mode_forwards_even_what_an_endpoint_matches(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """Record mode leaves every request to the real server and logs nothing until it answers."""
    project_id = await _project(factory, mode="record")
    await _endpoint(factory, project_id, method="GET", path="/users")
    async with factory() as session:
        service = MockService(session)
        assert await service.answer_request(intercepted("/users")) is None
        assert await service.answer_request(intercepted("/x", host="example.org")) is None
    assert await _logs(factory, project_id) == []


async def test_forwarded_answer_is_logged_folded_and_recordable(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """The log keeps the answer as an endpoint could replay it, one value per header name.

    Connection and encoding headers are left out: the body is kept decoded.
    """
    project_id = await _project(factory, mode="record")
    async with factory() as session:
        await MockService(session).create_forwarded_log(intercepted("/orders/7"), REAL_ANSWER)
    [log] = await _logs(factory, project_id)
    assert (log.matched, log.proxied, log.response_status, log.recordable) == (
        False,
        True,
        207,
        True,
    )
    assert log.response_headers == {
        "content-type": "application/json",
        "set-cookie": "a=1",
        "vary": "Accept, Origin",
    }
    assert log.response_body == '{"from":"server"}'


async def test_forwarded_request_without_an_answer_is_a_logged_502(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A real server that did not answer is in the log, with nothing to record."""
    project_id = await _project(factory, mode="record")
    async with factory() as session:
        service = MockService(session)
        await service.create_forwarded_log(intercepted("/down"), None)
        await service.create_forwarded_log(intercepted("/x", host="example.org"), None)
    [log] = await _logs(factory, project_id)
    assert (log.proxied, log.response_status, log.recordable) == (True, 502, False)


@pytest.mark.parametrize("request_body", [b"a" * 70_000, b"\xff"])
async def test_oversized_or_binary_request_body_is_not_recordable(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest, request_body: bytes
) -> None:
    """A request body past the log limit, or not UTF-8, cannot become an exact condition."""
    project_id = await _project(factory, mode="record")
    answer = HttpAnswer(status_code=200, headers=[], content=b"ok")
    async with factory() as session:
        await MockService(session).create_forwarded_log(
            intercepted("/blob", method="POST", body=request_body), answer
        )
    [log] = await _logs(factory, project_id)
    assert (log.recordable, log.response_body_ref) == (False, None)


async def test_binary_or_long_answer_is_stored_whole_and_replayed(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest, body_store_dir: Path
) -> None:
    """A video segment past the log limit is kept as a file and answered byte for byte."""
    project_id = await _project(factory, mode="record")
    segment = bytes(range(256)) * 400
    answer = HttpAnswer(status_code=200, headers=[("Content-Type", "video/mp4")], content=segment)
    async with factory() as session:
        await MockService(session).create_forwarded_log(intercepted("/video"), answer)
    [log] = await _logs(factory, project_id)
    assert (log.recordable, log.response_size, len(log.response_body)) == (True, 102_400, 65_536)
    assert (body_store_dir / log.response_body_ref).read_bytes() == segment
    async with factory() as session:
        [endpoint], _ = await EndpointService(session).create_endpoints_from_request_logs(
            project_id, EndpointRecordManyRequest(request_log_ids=[log.id])
        )
        await ProjectService(session).update_project(project_id, ProjectUpdateRequest(mode="mock"))
    assert (endpoint.body, endpoint.body_ref) == ("", log.response_body_ref)
    async with factory() as session:
        whole = await MockService(session).answer_request(intercepted("/video"))
    assert whole is not None
    assert (whole.status_code, whole.content) == (200, segment)
    assert ("content-type", "video/mp4") in whole.headers


async def test_stored_answer_is_cut_to_the_range_asked_for(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A player seeking in a recorded file gets a 206 of those bytes, or a 416 past the end."""
    project_id = await _project(factory)
    stored = bytes(range(100))
    await _endpoint(factory, project_id, method="GET", path="/v", body_ref=body_store().put(stored))

    async def ask(range_header: str) -> HttpAnswer:
        async with factory() as session:
            answer = await MockService(session).answer_request(
                intercepted("/v", headers=[("Range", range_header)])
            )
        assert answer is not None
        return answer

    part = await ask("bytes=10-19")
    assert (part.status_code, part.content) == (206, stored[10:20])
    assert ("content-range", "bytes 10-19/100") in part.headers
    assert ("accept-ranges", "bytes") in part.headers
    past = await ask("bytes=100-")
    assert (past.status_code, past.content) == (416, b"")
    assert ("content-range", "bytes */100") in past.headers
    whole = await ask("items=0-1")
    assert (whole.status_code, whole.content) == (200, stored)


async def test_endpoint_whose_stored_answer_is_gone_fails_with_502(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A stored answer deleted from disk is a 502 `mock_body_missing`, not a crash."""
    project_id = await _project(factory)
    await _endpoint(factory, project_id, method="GET", path="/gone", body_ref="0" * 64)
    async with factory() as session:
        answer = await MockService(session).answer_request(intercepted("/gone"))
    assert answer is not None
    assert (answer.status_code, json.loads(answer.content)["code"]) == (502, "mock_body_missing")


async def test_answer_past_the_store_limit_is_logged_but_not_recordable(
    factory: async_sessionmaker[AsyncSession],
    intercepted: BuildRequest,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An answer larger than the store keeps is logged cut, with nothing kept to replay."""
    monkeypatch.setattr(mock_schemas, "MAX_STORED_BODY_BYTES", 70_000)
    project_id = await _project(factory, mode="record")
    answer = HttpAnswer(status_code=200, headers=[], content=b"a" * 80_000)
    async with factory() as session:
        await MockService(session).create_forwarded_log(intercepted("/huge"), answer)
    [log] = await _logs(factory, project_id)
    assert (log.recordable, log.response_body_ref, log.response_size) == (False, None, 80_000)


async def test_orphan_bodies_are_swept_and_referenced_ones_kept(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest, body_store_dir: Path
) -> None:
    """A stored answer no log row or endpoint refers to is deleted; the rest stay."""
    project_id = await _project(factory, mode="record")
    answer = HttpAnswer(status_code=200, headers=[], content=b"\xff" * 10)
    async with factory() as session:
        await MockService(session).create_forwarded_log(intercepted("/kept"), answer)
    await _endpoint(
        factory, project_id, method="GET", path="/e", body_ref=body_store().put(b"\x00endpoint")
    )
    orphan = body_store().put(b"\x00orphan")
    async with factory() as session:
        assert await MockService(session).delete_orphan_bodies() == 1
    assert not (body_store_dir / orphan).exists()
    assert len(list(body_store_dir.iterdir())) == 2


async def test_recorded_exchange_replays_only_the_same_request(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """Record, save the log as endpoints, switch to mock: the exact request is answered."""
    project_id = await _project(factory, mode="record")
    request = intercepted("/search", method="POST", query="page=1&size=5", body=b'{"q":"a"}')
    async with factory() as session:
        await MockService(session).create_forwarded_log(request, REAL_ANSWER)
    [log] = await _logs(factory, project_id)
    async with factory() as session:
        created, _ = await EndpointService(session).create_endpoints_from_request_logs(
            project_id, EndpointRecordManyRequest(request_log_ids=[log.id])
        )
    assert [(e.host, e.match_query) for e in created] == [("api.example.com", "page=1&size=5")]
    async with factory() as session:
        await ProjectService(session).update_project(project_id, ProjectUpdateRequest(mode="mock"))
    same = intercepted("/search", method="POST", query="size=5&page=1", body=b'{ "q" : "a" }')
    other = intercepted("/search", method="POST", query="page=2&size=5", body=b'{"q":"a"}')
    async with factory() as session:
        service = MockService(session)
        replayed = await service.answer_request(same)
        missed = await service.answer_request(other)
    assert replayed is not None
    assert missed is not None
    assert (replayed.status_code, replayed.content) == (207, b'{"from":"server"}')
    assert ("set-cookie", "a=1") in replayed.headers
    assert missed.status_code == 404


async def test_logging_trims_to_retention(
    factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    intercepted: BuildRequest,
) -> None:
    """Each write trims the project's log, so a client polling a host cannot grow it forever."""
    monkeypatch.setattr(mock_module, "LOG_RETENTION_PER_PROJECT", 2)
    project_id = await _project(factory)
    async with factory() as session:
        service = MockService(session)
        for n in range(3):
            await service.answer_request(intercepted(f"/{n}"))
    assert [log.path for log in await _logs(factory, project_id)] == ["/2", "/1"]


async def test_path_too_long_for_an_endpoint_is_not_recordable(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A logged path past the endpoint path limit is kept in the log but cannot be saved."""
    project_id = await _project(factory, mode="record")
    async with factory() as session:
        await MockService(session).create_forwarded_log(intercepted("/" + "a" * 600), REAL_ANSWER)
    [log] = await _logs(factory, project_id)
    assert (log.proxied, log.recordable) == (True, False)


async def test_ignored_fields_are_left_out_of_a_recording_and_its_replay(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """A nonce in the query and body is not recorded, so the next call with a new one replays."""
    project_id = await _project(factory, mode="record", ignored_fields=["cpn", "rn"])
    first = intercepted("/watch", method="POST", query="v=abc&cpn=1", body=b'{"q":"x","rn":1}')
    async with factory() as session:
        await MockService(session).create_forwarded_log(first, REAL_ANSWER)
    [log] = await _logs(factory, project_id)
    async with factory() as session:
        created, _ = await EndpointService(session).create_endpoints_from_request_logs(
            project_id, EndpointRecordManyRequest(request_log_ids=[log.id])
        )
    assert [(e.match_query, e.match_body) for e in created] == [("v=abc", '{"q":"x"}')]
    async with factory() as session:
        await ProjectService(session).update_project(project_id, ProjectUpdateRequest(mode="mock"))
    later = intercepted("/watch", method="POST", query="cpn=2&v=abc", body=b'{"rn":9,"q":"x"}')
    async with factory() as session:
        replayed = await MockService(session).answer_request(later)
    assert replayed is not None
    assert replayed.status_code == 207


async def test_ignoring_a_field_later_lets_an_older_recording_match(
    factory: async_sessionmaker[AsyncSession], intercepted: BuildRequest
) -> None:
    """An endpoint recorded with the nonce in its condition matches once the name is ignored."""
    project_id = await _project(factory)
    await _endpoint(factory, project_id, method="GET", path="/watch", match_query="v=1&cpn=a")
    request = intercepted("/watch", query="v=1&cpn=b")
    async with factory() as session:
        missed = await MockService(session).answer_request(request)
    async with factory() as session:
        await ProjectService(session).update_project(
            project_id, ProjectUpdateRequest(ignored_fields=["cpn"])
        )
    async with factory() as session:
        answered = await MockService(session).answer_request(request)
    assert missed is not None
    assert answered is not None
    assert (missed.status_code, answered.status_code) == (404, 200)
