---
description: Backend app forbidden tokens — HTTPException and direct env reads, injected while the edit is being written
condition: "HTTPException\\(|import HTTPException|os\\.environ\\[|os\\.environ\\.get\\(|os\\.getenv\\("
scope: "tool:edit(backend/app/**/*.py), tool:write(backend/app/**/*.py)"
interruptMode: always
alwaysApply: false
---

<!-- fires-on backend/app/**/*.py: raise HTTPException(status_code=404) -->

# Backend App Forbidden Tokens

This text arrives because the edit currently being written contains a token that
`backend/app/` forbids everywhere. Rewrite that line before the write lands.

The trigger matches the construct, not the word: a comment or docstring that
*names* `HTTPException` to explain the ban must never interrupt an edit, so the
regex requires a call, an import, or a subscript.

## HTTPException

`HTTPException` is never raised, constructed, or imported in `backend/app/`.
Raise a domain exception defined in `app/core/exceptions.py` and let its
`@app.exception_handler` in `main.py` map it to a status code and the uniform
body (`detail`, `code`, `request_id`). A router that raises `HTTPException`
duplicates that mapping and produces a body no other endpoint returns.

Missing exception class → add it to `app/core/exceptions.py` **and** register a
handler. Details: `rule://backend-exceptions`.

## os.environ / os.getenv

Configuration is read only through `app/core/settings.py` (pydantic-settings),
never through `os.environ` or `os.getenv`. A direct read bypasses the field
validators, has no default visible in one place, and cannot be type-checked.
Add the field to `Settings` and inject it. Details: `rule://environment`.

## Enforcement

`check-backend-exceptions` (AST rule `exceptions/http-exception-forbidden.yml`)
fails on `HTTPException` after the edit
lands; this injection is the same invariant delivered before it does. The
direct env read has an AST rule (`environment/os-environ-direct.yml`), but no
ported hook runs it - here it is a convention (not machine-checked) beyond this
injection.
