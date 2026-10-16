---
description: Backend directory charter — what each app/ directory holds, what it may import, how its modules are named; declared in lib/backend-layout.ts
globs:
      - backend/app/**/*.py
      - .omp/hooks/lib/backend-layout.ts
      - .omp/hooks/lib/backend-layout-check.ts
      - .omp/hooks/post/check-backend-layout.ts
      - .omp/hooks/pre/strict-backend-app-structure.ts
alwaysApply: false
---

# Backend Layout

Every directory under `backend/app/` has a charter on three axes: what it
**holds**, what it may **import**, and how its **files** are named. The
declaration is one value, `APP_LAYERS` in `.omp/hooks/lib/backend-layout.ts`;
this table is its prose, and `check-backend-layout` holds the two row for row.

## Directories

| Directory | Holds | Imports | Files |
|---|---|---|---|
| `app/core/` | Process infrastructure that knows no table, field or domain: settings, the database engine, logging, exceptions and their codes, the page envelope | — | — |
| `app/engine/` | Pure functions the mock server is built on, with no session and no request: the path matcher (`matcher.py`, with the closed `METHODS` vocabulary) and the body templating (`templating.py`) | `core` | — |
| `app/models/` | SQLAlchemy tables — `base.py`, one file per table (`project.py`, `endpoint.py`, `request_log.py`) | `core`, `engine` | — |
| `app/schemas/` | Pydantic shapes per domain (`project.py`, `endpoint.py`, `request_log.py`, `mock.py`) | `core`, `engine`, `models` | — |
| `app/repositories/` | One async repository per table | `core`, `engine`, `models`, `schemas` | — |
| `app/services/` | One service per domain: transactions and domain rules over repositories; `mock.py` resolves and logs mocked requests | `core`, `engine`, `models`, `repositories`, `schemas` | — |
| `app/dependencies/` | FastAPI wiring: `Annotated` aliases and their factories (`core.py`, `services.py`, `query.py`) | `core`, `engine`, `models`, `schemas`, `services` | — |
| `app/routers/` | HTTP endpoints, one file per domain: `health.py`, `project.py` (with its endpoints and logs), `mock.py` | `core`, `dependencies`, `engine`, `schemas` | — |

## Reading The Imports

- A module may always import its own unit: a layer is one unit, so
  `schemas/endpoint.py` imports `schemas/project.py` freely.
- The domain folders of a layer (`schemas/<domain>/`) are part of the same
  unit, so they import one another.
- An entry is a prefix of the import's path: `core` admits every core module,
  `dependencies/query` would admit one module.
- `engine/` sits below everything but `core`: the matcher and the templating
  are tested without a database, so they never reach a session, a table, a
  repository or a schema. A model may read the engine's vocabulary
  (`ck_endpoint_method` is built from `matcher.METHODS`), so the method list
  is written once.
- `main.py` assembles everything and imports anything.
- `tests/` mirrors the layers and is not held to the table.
- A function-local or `TYPE_CHECKING` import is an import: the check reads
  them too, so moving an import inside a function does not leave the charter.

A new edge is decided by what the two directories hold. When the target is
something the source's Holds sentence needs, add the entry to `APP_LAYERS` and
to this table together, with its reason; otherwise move the code down to the
layer both may read.

## Enforcement

| Hook | Fires when |
|---|---|
| `strict-backend-app-structure` (write) | a file is written into a directory `APP_LAYERS` does not declare (`app/utils/x.py`), deeper than its layer allows, or loose at the `app/` root other than `main.py`/`__init__.py` |
| `check-backend-layout` (`lib/backend-layout-check.ts`) | a directory under `app/` has no charter; a module is not named for its directory; an import lands outside its unit's charter; this table's rows, Imports or Files disagree with `APP_LAYERS`; a planted self-test case judges wrong |
