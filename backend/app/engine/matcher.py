# ============================================================
# Imports
# ============================================================

import re
from collections.abc import Iterable
from datetime import datetime
from typing import Literal, Protocol, get_args
from urllib.parse import unquote
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

#: A path segment that is a parameter: exactly `{name}`, nothing around it.
PARAM_SEGMENT = re.compile(r"^\{([A-Za-z_][A-Za-z0-9_]*)\}$")

#: Runs of slashes, which a path compares as one.
REPEATED_SLASHES = re.compile(r"/{2,}")


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


def find_best[R: RouteCandidate](
    routes: Iterable[R], method: str, path: str
) -> tuple[R, dict[str, str]] | None:
    """The enabled route that answers `method path`, with the parameters it binds.

    Among the matches the most specific wins: an exact method before `ANY`, then
    a literal segment before a parameter, left to right, then the oldest route
    (and its id, so a tie never depends on the order rows were read). A `HEAD`
    nothing declares is answered as the `GET` it asks the headers of.
    """
    candidates = list(routes)
    found = _best(candidates, method, path)
    if found is None and method == "HEAD":
        found = _best(candidates, "GET", path)
    return found


def _best[R: RouteCandidate](
    routes: list[R], method: str, path: str
) -> tuple[R, dict[str, str]] | None:
    matches: list[tuple[tuple[bool, tuple[int, ...], datetime, str], R, dict[str, str]]] = []
    for route in routes:
        if not route.enabled or route.method not in (method, ANY_METHOD):
            continue
        params = _match_path(route.path, path)
        if params is None:
            continue
        specificity = tuple(
            0 if PARAM_SEGMENT.match(segment) is None else 1 for segment in _segments(route.path)
        )
        key = (route.method == ANY_METHOD, specificity, route.created_at, str(route.id))
        matches.append((key, route, params))
    if not matches:
        return None
    _, route, params = min(matches, key=lambda match: match[0])
    return route, params


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


def _segments(path: str) -> list[str]:
    return [segment for segment in normalize_path(path).split("/") if segment]
