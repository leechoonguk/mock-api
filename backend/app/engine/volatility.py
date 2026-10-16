# ============================================================
# Imports
# ============================================================

import json
from collections import defaultdict
from collections.abc import Collection, Iterable
from urllib.parse import parse_qsl


# ============================================================
# Functions
# ============================================================


def volatile_fields(
    requests: Iterable[tuple[str, str, str]], ignored: Collection[str]
) -> list[tuple[str, int]]:
    """The fields whose value changes between calls to the same route, most widespread first.

    `requests` are `(route, query, body)`: calls with the same route (method,
    host and path) are compared, and a query parameter or JSON key that took
    more than one value among them is volatile there - a nonce, a counter, a
    timestamp. Each name comes with how many routes it changed on; a name
    already `ignored` is left out.
    """
    values: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    calls: dict[str, int] = defaultdict(int)
    for route, query, body in requests:
        calls[route] += 1
        for name, value in _fields(query, body):
            values[route][name].add(value)
    routes_changed: dict[str, int] = defaultdict(int)
    for route, fields in values.items():
        if calls[route] < 2:
            continue
        for name, seen in fields.items():
            if len(seen) > 1 and name not in ignored:
                routes_changed[name] += 1
    return sorted(routes_changed.items(), key=lambda item: (-item[1], item[0]))


def _fields(query: str, body: str) -> list[tuple[str, str]]:
    """Every query pair and JSON leaf as `(name, value)`; a body that is not JSON has none."""
    fields = parse_qsl(query, keep_blank_values=True)
    try:
        value = json.loads(body)
    except ValueError:
        return fields
    return fields + _leaves(value)


def _leaves(value: object) -> list[tuple[str, str]]:
    """The scalar leaves of a JSON value under the key that holds each, at any depth."""
    if isinstance(value, dict):
        leaves: list[tuple[str, str]] = []
        for key, item in value.items():
            if isinstance(item, dict | list):
                leaves.extend(_leaves(item))
            else:
                leaves.append((key, json.dumps(item)))
        return leaves
    if isinstance(value, list):
        return [leaf for item in value for leaf in _leaves(item)]
    return []
