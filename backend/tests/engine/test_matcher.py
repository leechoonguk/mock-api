"""Path matching: which endpoint answers a request is the whole of the mock's routing contract.

The precedence (exact method, then literal segments, then age) decides which of
several plausible endpoints a caller gets, so each rule is pinned by a case
that would answer differently without it.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.engine.matcher import (
    NO_CONDITIONS,
    condition_key,
    find_best,
    normalize_path,
    pattern_problem,
    strip_body,
    strip_query,
)


EPOCH = datetime(2026, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class Route:
    """An endpoint as the matcher reads it, without a database."""

    method: str
    path: str
    enabled: bool = True
    created_at: datetime = EPOCH
    id: UUID = field(default_factory=uuid4)
    match_query: str | None = None
    match_body: str | None = None
    host: str = ""


def _winner(
    routes: list[Route],
    method: str,
    path: str,
    query: str = "",
    body: str = "",
    host: str = "api.example.com",
) -> tuple[Route, dict[str, str]] | None:
    return find_best(routes, method, host, path, query, body)


def test_literal_segment_beats_parameter() -> None:
    """`/users/me` must not be swallowed by `/users/{id}`, while other ids still bind."""
    me = Route("GET", "/users/me")
    by_id = Route("GET", "/users/{id}")
    assert _winner([by_id, me], "GET", "/users/me") == (me, {})
    assert _winner([by_id, me], "GET", "/users/5") == (by_id, {"id": "5"})


def test_exact_method_beats_any() -> None:
    """An endpoint naming the method outranks an ANY one, even with a less literal path."""
    get_param = Route("GET", "/a/{x}")
    any_literal = Route("ANY", "/a/b")
    assert _winner([any_literal, get_param], "GET", "/a/b") == (get_param, {"x": "b"})
    assert _winner([any_literal, get_param], "POST", "/a/b") == (any_literal, {})


def test_older_endpoint_wins_a_tie() -> None:
    """Two equally specific patterns resolve to the older one, independent of read order."""
    older = Route("GET", "/a/{x}", created_at=EPOCH)
    newer = Route("GET", "/a/{y}", created_at=EPOCH + timedelta(seconds=1))
    assert _winner([newer, older], "GET", "/a/1") == (older, {"x": "1"})


def test_disabled_endpoints_are_ignored() -> None:
    """A switched-off endpoint answers nothing, even when it is the only match."""
    assert _winner([Route("GET", "/users", enabled=False)], "GET", "/users") is None


def test_trailing_slash_and_repeated_slashes_still_match() -> None:
    """Callers write `/users/5/` and `//users/5`; both reach the endpoint saved as `/users/{id}`."""
    by_id = Route("GET", "/users/{id}")
    assert _winner([by_id], "GET", "/users/5/") == (by_id, {"id": "5"})
    assert _winner([by_id], "GET", "//users//5") == (by_id, {"id": "5"})


def test_segment_count_must_agree() -> None:
    """A parameter binds exactly one segment, so deeper or shallower paths miss."""
    by_id = Route("GET", "/users/{id}")
    assert _winner([by_id], "GET", "/users/5/orders") is None
    assert _winner([by_id], "GET", "/users") is None


def test_literal_comparison_is_case_sensitive_and_decoded() -> None:
    """`/Users` is another path; an encoded literal compares by its decoded text."""
    route = Route("GET", "/a b")
    assert _winner([route], "GET", "/a%20b") == (route, {})
    assert _winner([Route("GET", "/users")], "GET", "/Users") is None


def test_head_falls_back_to_get() -> None:
    """HEAD asks for GET's headers, so a GET endpoint answers when no HEAD one exists."""
    get = Route("GET", "/users")
    head = Route("HEAD", "/users")
    assert _winner([get], "HEAD", "/users") == (get, {})
    assert _winner([get, head], "HEAD", "/users") == (head, {})
    assert _winner([get], "POST", "/users") is None


def test_pattern_problem_reports_bad_parameters() -> None:
    """A repeated name or a brace inside a segment is reported, never raised."""
    assert pattern_problem("/{id}/{id}") == "parameter {id} appears more than once"
    assert pattern_problem("/users/x{id}") is not None
    assert pattern_problem("/users/{1d}") is not None
    assert pattern_problem("/users/{id}/orders/{order_id}") is None


def test_normalize_path_spells_one_form() -> None:
    """Storage and matching share one spelling: leading slash, single slashes, no trailing one."""
    assert normalize_path("") == "/"
    assert normalize_path("/") == "/"
    assert normalize_path("users//5/") == "/users/5"
    assert normalize_path("///") == "/"


def test_query_condition_matches_the_same_pairs_in_any_order() -> None:
    """A recorded query answers its own pairs however written, and nothing more or less."""
    page = Route("GET", "/orders", match_query="page=2&size=10")
    assert _winner([page], "GET", "/orders", query="size=10&page=2") == (page, {})
    assert _winner([page], "GET", "/orders", query="page=2") is None
    assert _winner([page], "GET", "/orders", query="page=2&size=10&x=1") is None
    assert _winner([page], "GET", "/orders") is None


def test_body_condition_compares_json_whatever_its_spelling() -> None:
    """A JSON body matches by value; a text body only byte for byte; an empty one only empty."""
    search = Route("POST", "/search", match_body='{"q": "a", "n": 1}')
    assert _winner([search], "POST", "/search", body='{"n":1,"q":"a"}') == (search, {})
    assert _winner([search], "POST", "/search", body='{"n":2,"q":"a"}') is None
    text = Route("POST", "/note", match_body="hello")
    assert _winner([text], "POST", "/note", body="hello ") is None
    empty = Route("POST", "/ping", match_body="")
    assert _winner([empty], "POST", "/ping") == (empty, {})
    assert _winner([empty], "POST", "/ping", body="x") is None


def test_conditioned_route_beats_an_open_one_and_falls_back_to_it() -> None:
    """The recorded exact request wins its own call; any other call reaches the open route."""
    open_route = Route("POST", "/search")
    exact = Route("POST", "/search", match_body='{"q":"a"}', created_at=EPOCH + timedelta(days=1))
    assert _winner([open_route, exact], "POST", "/search", body='{"q":"a"}') == (exact, {})
    assert _winner([open_route, exact], "POST", "/search", body='{"q":"b"}') == (open_route, {})


def test_condition_key_names_one_route_per_canonical_pair() -> None:
    """Two spellings of one condition share a key; no condition is the empty key."""
    assert condition_key(None, None) == NO_CONDITIONS
    assert condition_key("b=2&a=1", '{"x": 1}') == condition_key("a=1&b=2", '{"x":1}')
    assert condition_key("", None) != condition_key(None, "")
    assert condition_key("", None) != NO_CONDITIONS


def test_named_host_beats_any_host_and_other_hosts_miss() -> None:
    """A route on one host answers only there, and wins over the project-wide route."""
    anywhere = Route("GET", "/feed")
    youtube = Route("GET", "/feed", host="www.youtube.com", created_at=EPOCH + timedelta(days=1))
    assert _winner([anywhere, youtube], "GET", "/feed", host="www.youtube.com") == (youtube, {})
    assert _winner([anywhere, youtube], "GET", "/feed", host="m.youtube.com") == (anywhere, {})
    assert _winner([youtube], "GET", "/feed", host="m.youtube.com") is None


def test_ignored_fields_leave_query_and_json_body() -> None:
    """An ignored name goes from the query and from JSON objects at any depth; text stays."""
    assert strip_query("v=1&cpn=a&cpn=b&t=9", {"cpn", "t"}) == "v=1"
    assert strip_query("v=1&cpn=a", ()) == "v=1&cpn=a"
    body = '{"q":"a","ctx":{"cpn":"x","list":[{"rn":1,"k":2}]}}'
    assert strip_body(body, {"cpn", "rn"}) == '{"q":"a","ctx":{"list":[{"k":2}]}}'
    assert strip_body("cpn=x", {"cpn"}) == "cpn=x"
    assert strip_body(body, ()) == body


def test_ignored_fields_match_a_call_that_differs_only_in_them() -> None:
    """A recorded call answers the next one whose nonce changed; any other change still misses."""
    watch = Route("GET", "/watch", match_query="v=abc&cpn=111", match_body='{"rn":1,"q":"x"}')
    ignored = {"cpn", "rn"}

    def winner(query: str, body: str) -> tuple[Route, dict[str, str]] | None:
        return find_best([watch], "GET", "api.example.com", "/watch", query, body, ignored)

    assert winner("cpn=222&v=abc", '{"q":"x","rn":7}') == (watch, {})
    assert winner("v=xyz&cpn=111", '{"rn":1,"q":"x"}') is None
    assert winner("v=abc", '{"q":"y"}') is None
    assert _winner([watch], "GET", "/watch", "v=abc&cpn=222", '{"rn":1,"q":"x"}') is None
