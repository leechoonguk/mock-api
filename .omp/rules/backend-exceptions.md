---
description: Backend exceptions — every raise is a core exception from app/core/exceptions.py, mapped by one handler layer
globs:
      - backend/app/core/exceptions.py
      - backend/app/services/*.py
      - backend/app/routers/*.py
      - backend/app/dependencies/*.py
      - backend/app/core/*.py
alwaysApply: false
---

# Backend Exceptions

A failure has one vocabulary and one translator. **Every `raise` in
`backend/app/` names a class defined in `app/core/exceptions.py`**, and
`setup_exception_handler` is the only place that turns it into a status code and
a response body.

The alternative — each layer inventing its own failure type — means the same
condition answers 404 in one path, 500 in another, and a stack trace in a third.
The client cannot branch on any of it.

Machine-checked by `check-backend-exceptions.ts`:
`ast-grep/rules/exceptions/` owns the shape of a raise; `lib/backend-exceptions.ts`
owns what needs two files at once (definition, handler, response body).

## The Vocabulary

| Class / source | Status | `code` | Raised when |
|---|---|---|---|
| `NotFoundError` | 404 | `not_found` | a project, endpoint or request log id (or a mock slug) names no row |
| `MockNotMatchedError` | 404 | `mock_not_matched` | the project exists but none of its enabled endpoints matches the request's method and path; the body also echoes `method` and `path` |
| `ServiceUnavailableError` | 503 | `service_unavailable` | the readiness probe finds a dependency (the database) unreachable |
| `IntegrityError` (SQLAlchemy) | 409 | `conflict` | a unique constraint refuses a write — a taken project slug, a duplicate method and path within a project |
| `StaleDataError` (SQLAlchemy) | 409 | `stale_version` | the optimistic lock (`version_id_col`) finds the row updated by another request first |

Every body is `{detail, code, request_id}` (plus the documented extras, such as
`mock_not_matched`'s `method`/`path`).

## The Rules

| # | Rule | Why | Owner |
|---|---|---|---|
| 1 | Raise only classes defined in `app/core/exceptions.py` | one vocabulary, one handler layer | `lib/backend-exceptions.ts` |
| 2 | No builtin raise (`ValueError`, `RuntimeError`, `Exception`, `KeyError`, `TypeError`, `AssertionError`, `NotImplementedError`) | no handler → 500 + stack trace | `exceptions/builtin-forbidden.yml` |
| 3 | No `HTTPException` anywhere — not even constructed | a status at the raise site is a second translator | `exceptions/http-exception-forbidden.yml` |
| 4 | Name the class at the raise site, never `raise stored_instance` | the reader (and the checker) must see which failure this is | `exceptions/instance-raise.yml` |
| 5 | Every core class has exactly one `@app.exception_handler` (a subclass may rely on its parent's) | an unhandled core exception is a 500 | `lib/backend-exceptions.ts` |
| 6 | Every handler maps a class that exists here, or a declared third-party one | a handler for a deleted class is dead code | `lib/backend-exceptions.ts` |
| 7 | Every handler returns `detail`, `code`, `request_id` and an explicit `status_code` | clients branch on `code`; support needs `request_id` | `lib/backend-exceptions.ts` |
| 8 | Class names end in `Error` | the suffix is what marks a class raisable | `lib/backend-exceptions.ts` |
| 9 | The `code` is the contract; `detail` is diagnostic. A failure a client must tell apart carries its **own** `code`, never a different `detail` under a shared one | the UI shows a translated sentence keyed by `code` — it never renders `detail` | `lib/backend-exceptions.ts` + `check-frontend-i18n.ts` |

## Codes Are the Contract

`detail` is English written for a log line. It is not the string a user reads,
because the admin UI is bilingual (ko/en) and the server does not know which
language the caller wants. So the client maps `code` to a translated message,
and the code set is the published vocabulary of failures.

That has one consequence worth stating: **two causes a user must distinguish
need two codes.** `MockNotMatchedError` is the worked example. A mock request
can miss in two ways — the slug names no project (a wrong base URL) or the
project has no enabled endpoint for this method and path (a mock not written
yet). Answering both with `not_found` would leave the caller parsing prose to
tell them apart, so the second carries its own class and its own
`mock_not_matched` code.

The handler emits the code, and `check-frontend-i18n` fails when a code has no
`errors.<code>` entry in every locale — so publishing a new failure mode without
a translation is a gate failure, not a screen that shows `unknown_error`.

### The mechanical form of that rule

**An exception class carrying nothing but `detail` may not be raised for two
different reasons.** If it is, the only thing separating those failures is the
string no screen is allowed to render — so they reach the user as one sentence.
The fix is a `code` parameter with a default, and a named code beside each raise.
A class that takes a `code` which no raise site ever passes is flagged too: the
parameter changed the signature and nothing else.

A code is a **snake_case identifier** (`^[a-z][a-z0-9_]*$`): it is the locale key
`errors.<code>` and a client's branch label, so prose there resolves to no key
and falls back to the generic sentence. Module constants named `*_CODE`
(`SERVICE_UNAVAILABLE_CODE`) are held to the same shape.

Exempt by construction, never by name:

- a class with no `detail` — `NotFoundError` carries an id and every raise means
  the same thing;
- a class that already takes a `code`;
- a class carrying structured fields beyond `detail` — `MockNotMatchedError`
  hands back `method`/`path`, which is what a caller compares;
- a class raised once, which has one cause by construction.

The one code that stays a category is `conflict` itself: it answers the race a
service cannot see coming — the database's unique constraint refusing a writer
that passed the service check a moment earlier (`IntegrityError`). A cause a
service *can* name, names itself.

## The Two Documented Exemptions

- **Pydantic validators raise `ValueError`.** `@field_validator` /
  `@model_validator` bodies must, by framework contract: Pydantic converts it
  into a `ValidationError` → 422. The AST rule scopes the exemption to
  validator-decorated functions, so a `ValueError` anywhere else still fails.
- **Third-party classes in the handler allowlist.** `IntegrityError` (a
  constraint violation from the driver) and `StaleDataError` (SQLAlchemy's
  optimistic lock) cannot be core classes; they are mapped on purpose and
  declared in `EXTERNAL_HANDLED` with their reasons. Anything else registered as
  a handler must be defined in core.

## Layer Responsibilities

```text
repository  → returns None / raises nothing (no policy)
service     → raises the core exception that names the failure (NotFoundError, MockNotMatchedError); a duplicate is left to the IntegrityError handler
router      → raises nothing of its own policy; the handler layer answers
dependency  → raises the core exception, never HTTPException
core/*      → raises the core exception of its own concern (ServiceUnavailableError for readiness)
engine/*    → pure functions; a miss is a return value (no match), not a raise
handlers    → the only place a status code appears
```

## Adding a Failure Mode

1. Define the class in `app/core/exceptions.py`, named `<Thing>Error`, carrying
   the data its response needs (`resource_id`, `detail`, `method`/`path`).
2. Register one handler in `setup_exception_handler` with an explicit
   `status_code` and the uniform body (`detail`, `code`, `request_id`).
3. Add `errors.<code>` to both frontend locales (ko, en).
4. Raise it from the layer that detects the condition.
5. Run `make check-backend-exceptions` — the class↔handler sync is bidirectional,
   so a class without a handler (or the reverse) fails.

## Never Do These

- Raise a builtin exception outside a Pydantic validator
- Raise or construct `HTTPException` in app code
- `raise` a stored exception instance by variable name
- Define an exception class outside `app/core/exceptions.py`
- Leave a core exception without a handler, or a handler without its class
- Return an error body without `code` / `request_id`, or without an explicit status
- Map a third-party exception without declaring it in the allowlist and here
