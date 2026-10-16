"""Path matching: which endpoint answers a request is the whole of the mock's routing contract.

The precedence (exact method, then literal segments, then age) decides which of
several plausible endpoints a caller gets, so each rule is pinned by a case
that would answer differently without it.
"""

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from app.engine.matcher import find_best, normalize_path, pattern_problem


EPOCH = datetime(2026, 1, 1, tzinfo=UTC)


@dataclass(frozen=True)
class Route:
    """An endpoint as the matcher reads it, without a database."""

    method: str
    path: str
    enabled: bool = True
    created_at: datetime = EPOCH
    id: UUID = field(default_factory=uuid4)


def _winner(routes: list[Route], method: str, path: str) -> tuple[Route, dict[str, str]] | None:
    return find_best(routes, method, path)


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
