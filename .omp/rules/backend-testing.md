---
description: Backend testing — API/repository/service/core/engine test standards, 100% coverage gate
globs:
      - backend/tests/**/*.py
      - backend/pyproject.toml
alwaysApply: false
---

# Backend Testing

## Purpose

Every backend behavior — API endpoints, the mock router, the service layer, the
matcher and templating engine — must be covered by tests, and the suite must
hold **100% line coverage** of `app/`. The coverage gate is enforced by
`make -C backend test` (`--cov-fail-under=100`).

## Coverage Gate

- `backend/pyproject.toml` sets `addopts = "--cov=app --cov-report=term-missing --cov-fail-under=100"`
- `make -C backend test` fails when total coverage < 100%
- Excluded from coverage (`[tool.coverage.run] omit`, no testable logic):
  - `app/main.py` — FastAPI entry point
  - `app/core/database.py` — engine construction
  - `if __name__ == "__main__":` blocks — `# pragma: no cover`
- A new module must reach 100% before `make verify` passes

## Test Folder Structure

Tests are organized by layer, mirroring what they exercise. Repository and
service tests are split **per source module**:

```
backend/tests/
├── conftest.py              # shared fixtures (client, engine, factory, env isolation)
├── api/                     # HTTP API tests (routers)
│   ├── test_project.py      # project CRUD + its nested endpoints/logs routes
│   ├── test_mock.py         # /mock/{slug}/{path} — match, miss, templating, logging
│   └── test_health.py
├── repositories/            # repository unit tests — one file per source module
│   └── test_project.py  test_endpoint.py  test_request_log.py
├── services/                # service unit tests — one file per source module
│   └── test_project.py  test_endpoint.py  test_request_log.py
├── engine/                  # engine unit tests — mirrors app/engine/
│   └── test_matcher.py  test_templating.py
└── core/                    # core unit tests — mirrors app/core/
    ├── test_exceptions.py   # exception attributes + handler registration
    └── test_settings.py     # Settings model defaults/validation
```

| Folder | Covers | File naming |
|---|---|---|
| `tests/api/` | HTTP endpoints via TestClient | `test_<router>.py` |
| `tests/repositories/` | repositories directly | `test_<module>.py` (mirrors `app/repositories/`) |
| `tests/services/` | services directly (success + domain exceptions) | `test_<module>.py` (mirrors `app/services/`) |
| `tests/core/` | core modules (exceptions, settings, logging, page, ...) | `test_<module>.py` (mirrors `app/core/`) |
| `tests/engine/` | engine modules (path matcher, body templating) | `test_<module>.py` (mirrors `app/engine/`) |

Each subdirectory has an `__init__.py` — pytest needs unique module basenames
across directories (`test_project.py` exists in api/, repositories/, services/).

## API Test Standard (`tests/api/test_<domain>.py`)

Every CRUD domain test file follows the same pattern:

1. **Create** — `POST /api/v1/<domain>/` → 201, body has `id`
2. **List** — `GET /api/v1/<domain>/` → 200, contains created names
3. **Get** — `GET /api/v1/<domain>/{id}` → 200
4. **Get 404** — `GET /api/v1/<domain>/00000000-0000-0000-0000-000000000000` → 404
5. **Update** — `PATCH /api/v1/<domain>/{id}` → 200, field changed
6. **Update 404** — `PATCH /api/v1/<domain>/00000000-...` → 404
7. **Delete** — `DELETE /api/v1/<domain>/{id}` → 200 `{"ok": true}`, then GET → 404
8. **Delete 404** — `DELETE /api/v1/<domain>/00000000-...` → 404
9. **Create 422** — `POST /api/v1/<domain>/` with a missing required field → 422

Fixture: `client` (in-memory SQLite). There is no authentication, so no
token fixture and no 401 case.

A case is owed only when the router declares the verb that makes it possible:
a router with no update endpoint owes no update tests. `request_log` is the
example — it is append-only (written by the mock router), so its nested routes
under the project router are list, get, and the DELETE that clears a project's
logs; no create or update case exists for it.

**Child resources live in the parent's file.** `endpoint` and `request_log` have
no router of their own; their routes are nested under the project router
(`/api/v1/project/{project_id}/endpoints[/{endpoint_id}]`,
`/api/v1/project/{project_id}/logs[/{request_log_id}]`), so they are exercised in
`tests/api/test_project.py`, and the router-path check below reads them there.

**The nine cases are the one-table standard.** A domain that owns several model
files is not a one-resource CRUD API, so the nine test-name patterns do not
describe it — its behavioral contract does. Which standard applies is decided
structurally, by how many model files the domain owns (`aggregateDomains()` in
`lib/backend-domain-structure.ts`), never by a domain name in a hook. Today
every domain owns one table.

## Mock Router Tests (`tests/api/test_mock.py`)

The mock router is not CRUD, so the nine cases do not apply; its contract is:

- a matching enabled endpoint answers its `status_code`, `headers`, and rendered
  `body` for each method (including `ANY`), after `delay_ms`
- a path parameter (`/users/{id}`) binds and renders into the body
- an unknown slug → 404 `not_found`; a known project with no match → 404
  `mock_not_matched` echoing `method` and `path`
- a disabled endpoint does not match
- every request — matched or not — writes one `request_log` row in its own
  session

## Repository Test Standard (`tests/repositories/test_<module>.py`)

One file per source module in `app/repositories/` — CRUD plus the
domain-specific lookups (the slug lookup the mock router resolves a project by,
the per-project listings for endpoint and request_log). Uses the shared
`engine`/`factory` fixtures from conftest.

## Service Test Standard (`tests/services/test_<module>.py`)

One file per source module in `app/services/`. Every public method of the
service class must be called directly — HTTP tests alone cannot cover
service-layer contracts (NotFoundError raising, transaction boundaries,
IntegrityError on duplicates such as a taken slug).

Each method is tested for:
- **success path** — returns the expected entity/list
- **error path** — raises the domain exception (`NotFoundError`,
  `MockNotMatchedError`) or lets `IntegrityError` surface when the precondition fails

Each request step runs in its **own session** (mirroring the router's
`get_session()` lifecycle) — a read autobegins a transaction, and the next
write's `session.begin()` would collide on the same session.

Machine-checked by `check-backend-tests.ts` (every service module whose domain
has a router has a test file, and every **public** method is referenced there).
A `_`-prefixed helper is exempt: it is not the service's surface, its contract
belongs to the public method that calls it, and the 100% coverage gate already
proves its lines run. Requiring its name in a test would pin the implementation
detail the prefix exists to hide.

## Core and Engine Test Standard (`tests/core/`, `tests/engine/`)

Every module in `app/core/` and `app/engine/` must have a matching
`tests/<layer>/test_<module>.py` — core and engine logic is infrastructure that
HTTP tests exercise only indirectly:

| Module | Test file | Covers |
|---|---|---|
| `core/exceptions.py` | `test_exceptions.py` | exception attributes, `setup_exception_handler` 404/409/503 bodies |
| `core/settings.py` | `test_settings.py` | defaults, overrides, required fields, extra ignored |
| `engine/matcher.py` | `test_matcher.py` | path normalization, pattern validation, method/`ANY` matching, specificity order |
| `engine/templating.py` | `test_templating.py` | every token source, dotted body paths, missing values |

Machine-checked by `check-backend-tests.ts` (every core and engine module has a
test file).

## Conftest Contract

`tests/conftest.py`:

- `client` fixture swaps `app.dependencies.core.async_session_factory` to an
  in-memory SQLite engine — the **real** `get_session()` dependency runs
  (request lifecycle exercised, no dependency override)
- Every model imported (`from app.models.<name> import <Name>`) so
  `Base.metadata.create_all()` builds all tables
- `isolate_settings_environment` — an **autouse** fixture that deletes every
  `Settings` field name from `os.environ` (upper and lower case), derived from
  `Settings.model_fields`

**Why hermetic environment matters.** `Settings(_env_file=None, ...)` bypasses the
`.env` file but not the process environment: pydantic-settings reads `os.environ`
first. A shell that exported the root `.env` would change what the settings
tests observe — the same commit green in one terminal and red in another.
Deriving the names from the model means a new field cannot reintroduce the leak.

## Never Do These

- Ship a new module without 100% coverage — `make -C backend test` fails
- Write a docstring that only rearranges the test's own name
- Leave a test module or test function without a docstring
- Use `# pragma: no cover` on logic — only on `__main__` entry points
- Test with a dependency override instead of the real `get_session()`
- Skip the 404/422 error paths — they are part of the contract
- Leave a repository finder untested because "HTTP doesn't call it directly"
- Assert on settings defaults without the autouse env-isolation fixture — the
  process environment decides the result, not the code
- Add a router endpoint without a test hitting that path — `check-backend-tests`
  flags any `@router.<method>` without a matching path reference in the api test
- Add a service method without a test in its `tests/services/test_<module>.py` —
  `check-backend-tests` flags any public service method not referenced there
- Add a repository/service module without `tests/<layer>/test_<module>.py` —
  the per-module split is part of the standard
- Add a core or engine module without `tests/<layer>/test_<module>.py` — core
  logic is infrastructure that HTTP tests exercise only indirectly
- Put an API test in `tests/repositories/` or a unit test in `tests/api/` — the
  folder structure is part of the standard

## Docstrings

A test names a contract; the docstring says **why that contract exists** - what
breaks without it, or which failure mode it closes. The name already says what
is exercised, so a docstring that rearranges the name is noise.

- **Module docstring, always** - one line naming the surface under test.
- **Function docstring, always** - the reason the case is a contract. When the
  test is one of several around the same behaviour, say what *this* one adds
  (the wrong method, the disabled endpoint, the duplicate delete).
- **Never restate the name** - `"""Test create project."""` on
  `test_create_project` adds nothing. `check-backend-tests` fails when a summary
  contains no word beyond the function name and filler.
- **A test-local closure is private** - a handler defined inside a test needs no
  docstring of its own; the test's docstring covers it.

Presence is owned by the toolchain (`ruff`'s `pydocstyle` `D` rules in
`pyproject.toml`, selected for `tests/**`), substance by
`check-backend-tests.ts`. Neither can be satisfied by the other.

## Missing-Test Detection (check-backend-tests)

The hook detects missing tests structurally, beyond the coverage gate. A domain
owes tests only once its router stands (`routers/<name>.py`); before that the
coverage gate alone holds the line.

| Check | Detects |
|---|---|
| Folder structure | `tests/api/`, `tests/repositories/`, `tests/services/`, `tests/core/`, `tests/engine/` missing |
| Domain → api test file | a service-owned domain with a router but no `tests/api/test_<name>.py` |
| 9 standard API cases | a model-backed api test file missing create/list/get/update/delete (+404, +422) for a verb its router declares |
| Status assertions | an api test file with no `status_code == 201/404/422` assertion — the standard cases are matched by name, so a case whose assertion is gutted (404 quietly becoming 200) would otherwise still count |
| Router endpoint → test path | an `@router.<method>` with no matching path (literal or f-string head) in `tests/api/test_<router>.py` |
| Repository module → test | a module in `app/repositories/` with no mirrored `tests/repositories/test_<module>.py` |
| Service module → test | a module in `app/services/` with no mirrored `tests/services/test_<module>.py` |
| Service method → test | a public method in `app/services/` not referenced by its `tests/services/test_<module>.py` |
| Core/engine module → test | a module in `app/core/` or `app/engine/` with no `tests/<layer>/test_<module>.py` |
| Docstring substance | a test docstring with no word beyond the function name and filler |
| conftest contract | `dependency_overrides`, no `async_session_factory` swap, or no `Settings.model_fields` env isolation |
