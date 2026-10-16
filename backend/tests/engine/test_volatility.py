"""Volatile fields: what changes between calls to one route is what a replay must not compare."""

from app.engine.volatility import volatile_fields


def test_a_field_is_volatile_where_it_changes_between_calls_to_one_route() -> None:
    """Query pairs and JSON leaves at any depth are compared per route, counted across routes."""
    requests = [
        ("GET a/watch", "v=1&cpn=a", ""),
        ("GET a/watch", "v=1&cpn=b", ""),
        ("POST a/next", "", '{"ctx":{"rn":1,"client":"web"},"items":[{"t":5}]}'),
        ("POST a/next", "", '{"ctx":{"rn":2,"client":"web"},"items":[{"t":6}]}'),
        ("POST a/log", "cpn=z", '{"rn":3}'),
        ("POST a/log", "cpn=y", '{"rn":3}'),
    ]
    assert volatile_fields(requests, ignored=()) == [("cpn", 2), ("rn", 1), ("t", 1)]


def test_one_call_a_text_body_and_ignored_names_suggest_nothing() -> None:
    """One call, text, a bare JSON value or an ignored name: nothing to suggest."""
    requests = [
        ("GET a/once", "cpn=a", ""),
        ("POST a/count", "", "5"),
        ("POST a/count", "", "6"),
        ("POST a/form", "", "a=1"),
        ("POST a/form", "", "a=2"),
        ("GET a/watch", "cpn=a", ""),
        ("GET a/watch", "cpn=b", ""),
    ]
    assert volatile_fields(requests, ignored={"cpn"}) == []
