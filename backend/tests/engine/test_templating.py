"""Response-body templating: which request values a mock can echo back, and how a miss reads.

A template is written once and rendered against every request, so a token the
request does not satisfy must render as nothing rather than fail the response.
"""

import json
import re
from uuid import UUID

from app.engine.templating import RenderContext, render


CONTEXT = RenderContext(
    path_params={"id": "42"},
    query={"page": "2"},
    headers={"x-user": "ana"},
    body_raw=json.dumps({"user": {"name": "Ana", "admin": True, "tags": ["a", "b"]}, "n": 3}),
)


def test_path_query_and_header_tokens_render() -> None:
    """Each source the request carries reaches the body by its own token."""
    assert render("{{path.id}}/{{query.page}}/{{ headers.x-user }}", CONTEXT) == "42/2/ana"


def test_header_names_are_case_insensitive() -> None:
    """Clients spell header names freely, so the template's spelling must not matter."""
    assert render("{{headers.X-User}}", CONTEXT) == "ana"


def test_body_paths_descend_objects_and_lists() -> None:
    """Dotted steps walk the JSON body; a number indexes a list; values keep JSON spelling."""
    assert render("{{body.user.name}}", CONTEXT) == "Ana"
    assert render("{{body.user.tags.1}}", CONTEXT) == "b"
    assert render("{{body.user.admin}}", CONTEXT) == "true"
    assert render("{{body.n}}", CONTEXT) == "3"
    assert json.loads(render("{{body.user.tags}}", CONTEXT)) == ["a", "b"]
    assert render("{{body}}", CONTEXT) == CONTEXT.body_raw


def test_misses_render_empty() -> None:
    """A value the request lacks renders as nothing instead of breaking the response."""
    assert render("[{{path.nope}}{{query.nope}}{{headers.nope}}{{path}}]", CONTEXT) == "[]"
    assert render("[{{body.user.tags.9}}{{body.user.name.x}}{{body.none}}]", CONTEXT) == "[]"
    unparsable = RenderContext(path_params={}, query={}, headers={}, body_raw="not json")
    assert render("[{{body.a}}]", unparsable) == "[]"


def test_unknown_tokens_stay_as_written() -> None:
    """Braces the renderer does not own are the author's text, e.g. a client-side template."""
    assert render("{{unknown}} {{ path }}", CONTEXT) == "{{unknown}} "


def test_now_and_uuid_are_generated_per_render() -> None:
    """`now` is a UTC ISO timestamp ending in Z; `uuid` is a fresh UUID each time."""
    now = render("{{now}}", CONTEXT)
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z", now)
    first, second = render("{{uuid}} {{uuid}}", CONTEXT).split()
    assert UUID(first) != UUID(second)
