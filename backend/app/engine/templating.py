# ============================================================
# Imports
# ============================================================

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4


# ============================================================
# Constants
# ============================================================

#: A token the renderer fills: `{{path.id}}`, `{{query.page}}`, `{{headers.x-user}}`,
#: `{{body.a.0.b}}`, `{{now}}`, `{{uuid}}`. Anything else in braces is the
#: author's text and stays as written.
TOKEN = re.compile(r"\{\{\s*(path|query|headers|body|now|uuid)(?:\.([^\s}]+))?\s*\}\}")

#: What a token renders as when the request does not carry what it names.
MISSING = ""


# ============================================================
# Classes
# ============================================================


@dataclass(frozen=True)
class RenderContext:
    """The request a response body is rendered against.

    `query` holds each parameter's first value; `headers` is keyed in lower
    case, because header names are case-insensitive and a template should not
    have to guess the client's spelling.
    """

    path_params: Mapping[str, str]
    query: Mapping[str, str]
    headers: Mapping[str, str]
    body_raw: str


# ============================================================
# Functions
# ============================================================


def render(template: str, context: RenderContext) -> str:
    """The template with every known token replaced by the request's value."""
    return TOKEN.sub(lambda match: _resolve(match.group(1), match.group(2), context), template)


def _resolve(source: str, key: str | None, context: RenderContext) -> str:
    if source == "now":
        return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if source == "uuid":
        return str(uuid4())
    if source == "body":
        return context.body_raw if key is None else _format(_dig(context.body_raw, key))
    if key is None:
        return MISSING
    if source == "path":
        return context.path_params.get(key, MISSING)
    if source == "query":
        return context.query.get(key, MISSING)
    return context.headers.get(key.lower(), MISSING)


def _dig(body_raw: str, key: str) -> Any:
    """The value at a dotted path into a JSON body; a numeric step indexes a list."""
    try:
        current: Any = json.loads(body_raw)
    except ValueError:
        return None
    for step in key.split("."):
        if isinstance(current, dict):
            current = current.get(step)
        elif isinstance(current, list) and step.isdigit() and int(step) < len(current):
            current = current[int(step)]
        else:
            return None
    return current


def _format(value: Any) -> str:
    """A JSON value as body text: objects as JSON, booleans as JSON spells them."""
    if value is None:
        return MISSING
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)
