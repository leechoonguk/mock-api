# ============================================================
# Imports
# ============================================================

import hashlib
import json
import re
from collections.abc import Collection, Iterable
from datetime import datetime
from typing import Literal, NamedTuple, Protocol, get_args
from urllib.parse import parse_qsl, unquote, urlencode
from uuid import UUID


# ============================================================
# Constants
# ============================================================

#: Every method an endpoint may declare. `ANY` answers whichever method the
#: request used, after an endpoint naming that method exactly. The request
#: schema types the field with the Literal; `ck_endpoint_method` closes the
#: column over the same values.
EndpointMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ANY"]
METHODS: tuple[str, ...] = get_args(EndpointMethod)
ANY_METHOD = "ANY"

#: The methods a request arrives with - every declared method but `ANY`.
RequestMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]

#: A path segment that is a parameter: exactly `{name}`, nothing around it.
PARAM_SEGMENT = re.compile(r"^\{([A-Za-z_][A-Za-z0-9_]*)\}$")

#: Runs of slashes, which a path compares as one.
REPEATED_SLASHES = re.compile(r"/{2,}")

#: The condition key of a route that matches any query and any body.
NO_CONDITIONS = ""

#: The host of a route that answers on every host of its project.
ANY_HOST = ""


# ============================================================
# Classes
# ============================================================


class RouteCandidate(Protocol):
    """What the matcher reads of an endpoint - the ORM row satisfies it as it is."""

    @property
    def id(self) -> UUID: ...

    @property
    def method(self) -> str: ...

    @property
    def path(self) -> str: ...

    @property
    def enabled(self) -> bool: ...

    @property
    def created_at(self) -> datetime: ...

    @property
    def match_query(self) -> str | None: ...

    @property
    def match_body(self) -> str | None: ...

    @property
    def host(self) -> str: ...


class _Compared(NamedTuple):
    """A request as conditions compare it: canonical query and body, the ignored fields out."""

    query: str
    body: str
    ignored: Collection[str]


# ============================================================
# Functions
# ============================================================


def normalize_path(path: str) -> str:
    """The one spelling of a path: a leading slash, single slashes, no trailing slash.

    Applied where a path is stored and where a request is matched, so `/users/5/`
    and `users//5` reach the endpoint saved as `/users/5`.
    """
    collapsed = REPEATED_SLASHES.sub("/", "/" + path)
    if len(collapsed) > 1:
        collapsed = collapsed.rstrip("/")
    return collapsed


def pattern_problem(path: str) -> str | None:
    """Why `path` is no valid endpoint pattern, or None when it is one.

    Returned rather than raised: the schema's validator turns it into the 422,
    and nothing else here may raise a builtin exception.
    """
    names: set[str] = set()
    for segment in _segments(path):
        match = PARAM_SEGMENT.match(segment)
        if match is None:
            if "{" in segment or "}" in segment:
                return f"segment {segment!r} must be a whole {{name}} parameter or plain text"
            continue
        name = match.group(1)
        if name in names:
            return f"parameter {{{name}}} appears more than once"
        names.add(name)
    return None


def canonical_query(query: str) -> str:
    """The one spelling of a query string: its pairs sorted, blank values kept.

    Two query strings name the same request when their pairs are equal, whatever
    order the client wrote them in.
    """
    return urlencode(sorted(parse_qsl(query, keep_blank_values=True)))


def strip_query(query: str, ignored: Collection[str]) -> str:
    """`query` without the pairs whose name is in `ignored` - values a client changes per call."""
    if not ignored:
        return query
    pairs = parse_qsl(query, keep_blank_values=True)
    return urlencode([(name, value) for name, value in pairs if name not in ignored])


def strip_body(body: str, ignored: Collection[str]) -> str:
    """A JSON `body` without the keys named in `ignored`, at any depth; other text as is."""
    if not ignored:
        return body
    try:
        value = json.loads(body)
    except ValueError:
        return body
    return json.dumps(_without(value, ignored), separators=(",", ":"), ensure_ascii=False)


def _canonical_body(body: str) -> str:
    """The one spelling of a body: JSON with sorted keys and no whitespace, other text as is."""
    try:
        value = json.loads(body)
    except ValueError:
        return body
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def condition_key(match_query: str | None, match_body: str | None) -> str:
    """What tells two routes on the same method and path apart: their conditions.

    `NO_CONDITIONS` for a route that answers any query and body; otherwise a
    digest of the canonical conditions, so two spellings of one JSON body are
    the same route and the unique constraint refuses the second.
    """
    if match_query is None and match_body is None:
        return NO_CONDITIONS
    canonical = [
        None if match_query is None else canonical_query(match_query),
        None if match_body is None else _canonical_body(match_body),
    ]
    return hashlib.sha256(json.dumps(canonical).encode()).hexdigest()


def find_best[R: RouteCandidate](
    routes: Iterable[R],
    method: str,
    host: str,
    path: str,
    query: str,
    body: str,
    ignored: Collection[str] = (),
) -> tuple[R, dict[str, str]] | None:
    """The enabled route that answers the request, with the parameters it binds.

    A route names one host or, with `ANY_HOST`, every host of its project. A
    route with a query or body condition answers only a request whose query or
    body equals it exactly (pairs in any order, JSON in any spelling) once the
    `ignored` fields - values a client changes on every call - are taken out
    of both. Among the matches the most specific wins: an exact method before
    `ANY`, a named host before any host, then a literal segment before a
    parameter, left to right, then the route with more conditions, then the
    oldest route (and its id, so a tie never depends on the order rows were
    read). A `HEAD` nothing declares is answered as the `GET` it asks the
    headers of.
    """
    candidates = list(routes)
    request = _Compared(
        canonical_query(strip_query(query, ignored)),
        _canonical_body(strip_body(body, ignored)),
        ignored,
    )
    found = _best(candidates, method, host, path, request)
    if found is None and method == "HEAD":
        found = _best(candidates, "GET", host, path, request)
    return found


def _best[R: RouteCandidate](
    routes: list[R], method: str, host: str, path: str, request: _Compared
) -> tuple[R, dict[str, str]] | None:
    matches: list[
        tuple[tuple[bool, bool, tuple[int, ...], int, datetime, str], R, dict[str, str]]
    ] = []
    for route in routes:
        if not _admits(route, method, host):
            continue
        conditions = _conditions_met(route, request)
        if conditions is None:
            continue
        params = _match_path(route.path, path)
        if params is None:
            continue
        specificity = tuple(
            0 if PARAM_SEGMENT.match(segment) is None else 1 for segment in _segments(route.path)
        )
        key = (
            route.method == ANY_METHOD,
            route.host == ANY_HOST,
            specificity,
            -conditions,
            route.created_at,
            str(route.id),
        )
        matches.append((key, route, params))
    if not matches:
        return None
    _, route, params = min(matches, key=lambda match: match[0])
    return route, params


def _admits(route: RouteCandidate, method: str, host: str) -> bool:
    """Whether `route` is enabled and declares this request's method and host."""
    return route.enabled and route.method in (method, ANY_METHOD) and route.host in (host, ANY_HOST)


def _conditions_met(route: RouteCandidate, request: _Compared) -> int | None:
    """How many conditions `route` holds when the canonical request meets them all, else None."""
    conditions = 0
    if route.match_query is not None:
        if canonical_query(strip_query(route.match_query, request.ignored)) != request.query:
            return None
        conditions += 1
    if route.match_body is not None:
        if _canonical_body(strip_body(route.match_body, request.ignored)) != request.body:
            return None
        conditions += 1
    return conditions


def _match_path(pattern: str, path: str) -> dict[str, str] | None:
    """The parameters `path` binds in `pattern`, or None when it does not match.

    Segments compare one to one, so a pattern never matches a path of another
    length. `path` is the raw request path: each segment is percent-decoded
    after the split, so an encoded `/` stays inside its segment.
    """
    pattern_segments = _segments(pattern)
    path_segments = _segments(path)
    if len(pattern_segments) != len(path_segments):
        return None
    params: dict[str, str] = {}
    for expected, actual in zip(pattern_segments, path_segments, strict=True):
        value = unquote(actual)
        match = PARAM_SEGMENT.match(expected)
        if match is not None:
            params[match.group(1)] = value
        elif expected != value:
            return None
    return params


def _without(value: object, ignored: Collection[str]) -> object:
    """A JSON value with every object key named in `ignored` removed, at any depth."""
    if isinstance(value, dict):
        return {key: _without(item, ignored) for key, item in value.items() if key not in ignored}
    if isinstance(value, list):
        return [_without(item, ignored) for item in value]
    return value


def _segments(path: str) -> list[str]:
    return [segment for segment in normalize_path(path).split("/") if segment]
