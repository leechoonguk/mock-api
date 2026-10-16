# ============================================================
# Imports
# ============================================================

import re
from collections.abc import Iterable


# ============================================================
# Constants
# ============================================================

#: The longest host name DNS allows.
HOST_MAX_LENGTH = 253

#: One DNS label: letters, digits and inner hyphens, at most 63 characters.
LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")

#: The prefix of a pattern that names every subdomain of what follows it.
WILDCARD_PREFIX = "*."


# ============================================================
# Functions
# ============================================================


def normalize_host(host: str) -> str:
    """The one spelling of a host: trimmed, lower-case, no trailing dot."""
    return host.strip().lower().rstrip(".")


def host_problem(pattern: str, *, wildcard: bool) -> str | None:
    """Why `pattern` is no host (or, with `wildcard`, no `*.suffix` pattern), or None.

    Returned rather than raised: the schema's validator turns it into the 422.
    A scheme, port or path is refused - a project names hosts, and the proxy
    compares host names only.
    """
    name = pattern
    if wildcard and name.startswith(WILDCARD_PREFIX):
        name = name[len(WILDCARD_PREFIX) :]
    if not name or len(name) > HOST_MAX_LENGTH:
        return f"{pattern!r} is not a host name"
    if any(LABEL.match(label) is None for label in name.split(".")):
        return f"{pattern!r} is not a host name (letters, digits, hyphens and dots only)"
    return None


def best_host_pattern(patterns: Iterable[str], host: str) -> str | None:
    """The pattern among `patterns` that claims `host`, or None.

    An exact name wins over any wildcard, and a longer wildcard over a shorter
    one, so `api.example.com` beats `*.example.com` and `*.api.example.com`
    beats `*.example.com` for `v1.api.example.com`.
    """
    matching = [pattern for pattern in patterns if _host_matches(pattern, host)]
    if not matching:
        return None
    return max(
        matching, key=lambda pattern: (not pattern.startswith(WILDCARD_PREFIX), len(pattern))
    )


def _host_matches(pattern: str, host: str) -> bool:
    """Whether `host` is the host `pattern` names, or a subdomain of a `*.suffix` pattern."""
    if pattern.startswith(WILDCARD_PREFIX):
        return host.endswith(pattern[1:])
    return host == pattern
