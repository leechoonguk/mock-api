---
description: Backend domain conventions — 5-layer CRUD pattern, model/schema/repository/service/router, nested child resources, DI, testing
globs:
      - backend/app/services/*
      - backend/app/repositories/*
      - backend/app/routers/*
      - backend/app/dependencies/*
      - backend/app/models/*
      - backend/app/schemas/*
      - backend/app/core/database.py
      - backend/app/core/settings.py
      - backend/tests/conftest.py
      - backend/Makefile
alwaysApply: false
---

# Backend Domain

This document is **convention (not machine-checked)** as a whole: no
`check-backend-domain` hook exists in this harness. Where a statement below is
enforced, the enforcing hook or AST rule is named next to it; everything else is
review guidance.

## Folder Structure

`backend/app/` is the only source tree. What each directory holds and may
import is rule://backend-layout (`check-backend-layout`). File section layout is
rule://backend-naming (`check-backend-naming`) and `code-layout.md`
(`check-code-layout`).

**Composition rules:**
- **One file per domain per layer while the domain is one file; a folder named
  after the domain once it is several.** `models/` → `schemas/` →
  `repositories/` → `services/` all use `<name>.py`, and any of them may become
  `<name>/` — the domain name is the same either way, so a reader follows one
  name down the stack. Inside a folder the file drops the domain prefix
  (`backend-model-files.md`, `backend-repository-files.md`). The layer that
  decides a domain exists is `services/`.
- **Tests mirror the source path.** `services/endpoint.py` is tested by
  `tests/services/test_endpoint.py`, so a module's test lives at the module's
  own path (machine-checked by `check-backend-tests`, rule://backend-testing).
- `core/` and `engine/` are the shared layers, `dependencies/` a fixed set
  (`core.py`, `services.py`, `query.py`) — a new module there needs a matching
  `tests/<layer>/test_<name>.py` and a rule update; they are not per-domain.
- There is no `utils/`, and adding one would be a second home with no owner:
  `core/` and `engine/` are the shared layers, and a check already governs both
  (a module without `tests/<layer>/test_<name>.py` fails `check-backend-tests`).
  A helper that serves exactly one domain is not shared — it belongs to that
  domain's service, or to the class it builds (`<Class>.from_record`).
- `engine/` is pure: `matcher.py` (path patterns, `METHODS`, specificity) and
  `templating.py` (body rendering) import `core` only, never a session.

## Structure Enforcement (Pre-Hook)

`strict-backend-app-structure.ts` blocks file creation at write/edit time,
before any check runs. Recognized locations only:

- `backend/app/<allowedDir>/...` — the layers `APP_LAYERS` declares, in their
  declared folders, under their declared module names (rule://backend-layout)
- `backend/app/main.py` and `backend/app/__init__.py` — the only files at the
  app root
- `backend/tests/`, `backend/alembic/`, `backend/scripts/` — standard backend dirs

Anything else is blocked: a new directory under `backend/app/` (e.g.
`adapters/`), a stray file at the app root (`backend/app/standalone.py`), or
a new directory under `backend/` outside the standard set (`backend/workers/`).

**Never Do These**

- Add a file or directory outside the documented locations — the pre-hook
  blocks the write itself (post-hooks only flag files that already exist)

## 5-Layer Architecture

```
Model → Schema → Repository → Service → Router
```

Every domain follows this chain. Never skip a layer.

**Data chain is mandatory, a router of its own is optional:**

- `Model → Schema → Repository → Service` — required for every CRUD domain.
- `Router` — optional per domain. `project` has `routers/project.py`.
  `endpoint` and `request_log` are **child resources** of a project: they have
  the full data chain but no router of their own — their routes are nested in
  the project router (see Router below). `health` and `mock` are routers with no
  CRUD domain behind them.
- Schema-only modules are allowed for non-CRUD request/response bodies.

**A domain may own one table or many.** One table per model file is the table
rule (`backend-model-files.md`), and a domain owns the model files named after
it or prefixed `<domain>_`. Owning several is not an exception to the 5-layer
chain — the chain is identical either way; only the per-file shape hooks
(`check-backend-model-files`, `check-backend-repository-files`) read the folder
differently. Today every domain owns one table. Aggregates are discovered
structurally (`aggregateDomains()` in `lib/backend-domain-structure.ts`), so the
first domain to grow a second table needs no edit to any hook and no name in one.

## Domain Creation

Each domain creates 5 files (one per layer, the router only when the domain is
top-level) and wires 1 dependency file + `main.py`:

**Creates:**

- `models/<name>.py` — SQLAlchemy model with `AuditMixin` (`Base, AuditMixin`)
- `schemas/<name>.py` — 6 Pydantic classes: `XBase`, `XCreateRequest`, `XCreateInternal`, `XReadResponse`, `XUpdateRequest`, `XUpdateInternal`
- `repositories/<name>.py` — async CRUD repository: `__init__`, `get`, `list`, `count`, `create`, `update`, `delete`
- `services/<name>.py` — thin service adapter with session-based `__init__`, `session.begin()` for writes, raises `NotFoundError`
- `routers/<name>.py` — top-level domains only: POST `/`, GET `/`, GET `/{<name>_id}`, PATCH `/{<name>_id}`, DELETE `/{<name>_id}`. A child domain adds its routes to the parent's router instead.

**Wires:**

- `dependencies/services.py` — `Annotated[T, Depends(factory)]` for all domain services (receive `SessionDep` directly)
- `main.py` — `app.include_router(<name>.router)` for a new top-level router (rule://backend-app-setup)

A domain is not done at the five layers: the migration, the three test files
(`tests/{api,repositories,services}/`), and the frontend domain files (service,
hooks, screens or the parent's detail tab, both locales) are part of the same
delivery.

### Build order (each step verifies its own layer before the next)

The order is not style: deferring a step's verification to the end turns every
early mistake into a late, confusing failure.

1. `models/<name>.py` → register in `alembic/env.py` and `tests/conftest.py`
   **alongside** the existing imports → `make -C backend migrate-gen m="<real message>"`
   → **apply it immediately** (`make -C backend migrate`). An unapplied migration
   keeps the DB behind the files, and every later test run fails on that instead
   of on your code. `make -C backend migrate-check` confirms the models and the
   migrations agree.
2. `schemas` → `repositories` → `services` → `routers` → wiring
   (`dependencies/services.py`, `main.py` — add alongside, never replace).
   After the router mounts: `make -C backend verify`.
3. Tests (three dirs) as each layer stands — not as a pile at the end.
4. Frontend domain files and wiring (both locales — the i18n check fails on a
   single-language key), then the full root `make verify`.

## Domain Naming

- `<name>` is the table name: lower snake case (`project`, `endpoint`,
  `request_log`)
- Class names are the PascalCase of the table: `request_log` → `RequestLog`,
  `RequestLogService`, `RequestLogReadResponse`
- File name = table name in every layer: `models/request_log.py`,
  `schemas/request_log.py`, `repositories/request_log.py`,
  `services/request_log.py`. The model filename is the single source of truth
- URL prefix for a top-level domain = `/api/v1/<name>`: `/api/v1/project/`,
  `/api/v1/project/{project_id}`. A child's URL segment is its plural under the
  parent (`/endpoints`, `/logs`), and its path parameter is `<table>_id`
  (`endpoint_id`, `request_log_id`)
- **`<Name>Base` is the promise of the other five.** A schema file that
  declares it owes `CreateRequest`, `CreateInternal`, `ReadResponse`,
  `UpdateRequest`, `UpdateInternal` under the same name. A read-only resource
  (`request_log`, written only by the mock router) declares the classes its
  reads and its one internal create need, and no `UpdateRequest`

## Model (`app/models/<name>.py`)

**Standard pattern** — `models/project.py` is the reference:

```python
import uuid
from uuid import uuid4

from sqlalchemy import String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import AuditMixin, Base


class Project(Base, AuditMixin):
    __tablename__ = "project"
    __table_args__ = (UniqueConstraint("slug", name="uq_project_slug"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120))
    slug: Mapped[str] = mapped_column(String(64))
```

Conventions:

- `class X(Base, AuditMixin)` — inherits both `Base` and `AuditMixin`.
  `AuditMixin` supplies `created_at`, `updated_at` and `version` (the
  `version_id_col` optimistic lock). There is no `created_by`/`updated_by`: the
  app has no authentication, so there is no actor to record.
- `id` is exactly
  `id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)`
- Every other field follows `$NAME: Mapped[$TYPE] = mapped_column(...)`
- `__tablename__ = "<name>"` (lower snake case, equal to the file name —
  `check-backend-model-files`)
- A child points at its parent through the parent's FK constant
  (`PROJECT_FK`, `ENDPOINT_FK`) with the delete behavior that matches ownership:
  `endpoint.project_id` and `request_log.project_id` are `ondelete="CASCADE"`
  (the project owns them), `request_log.endpoint_id` is `ondelete="SET NULL"`
  (a log outlives the endpoint that answered it)
- A short closed vocabulary carries `CheckConstraint("<col> IN (...)")`, spelled
  from the one Python constant (`ck_endpoint_method` from `METHODS`)

## Schema (`app/schemas/<name>.py`)

6 Pydantic classes. **Naming convention**: requests and responses carry
`Request`/`Response` suffixes so the HTTP role is visible in the name:

| Class | Purpose | Fields |
|---|---|---|
| `<Name>Base` | Shared fields | the columns a client sets |
| `<Name>CreateRequest` | **Request** — input for POST | inherits Base |
| `<Name>CreateInternal` | DB insert (internal, not HTTP) | inherits Base + what the server supplies (the parent id from the path: `project_id`) |
| `<Name>ReadResponse` | **Response** — output | inherits Base + `id`, `version`, `created_at`, `updated_at` (+ derived reads such as project's `endpoint_count`) |
| `<Name>UpdateRequest` | **Request** — input for PATCH | optional fields only |
| `<Name>UpdateInternal` | DB update (internal, not HTTP) | what the repository writes |

All schemas: `extra="forbid"`.
Read schemas: `from_attributes=True`.
Helper functions: `to_read()` and `to_read_list()` using `model_validate`.
A list answers `Page[<Name>ReadResponse]` (`core/page.py`: `{items, total}`).

**Those two helpers are the layer's whole public function surface.** A schema
module exports Pydantic classes; anything else public in `schemas/` is another
layer's logic parked where it happened to compile:

| The helper | Where it goes |
|---|---|
| builds an instance of a schema class | a classmethod on that class |
| serves exactly one caller's comparison, parsing, or formatting | that caller |
| validates a value the engine already knows how to judge | a validator calling the engine (`pattern_problem` from `engine/matcher.py`) |
| supports the classes in this module only | a module-private `_name` |

Renaming a helper `_helper` and importing it anyway is closed from the other
side — rule://backend-naming forbids importing an underscore name across modules.

**Convention rules:**
- `Request` suffix = HTTP request body (`XCreateRequest`, `XUpdateRequest`)
- `Response` suffix = HTTP response (`XReadResponse`)
- `Internal` suffix = DB layer only, never exposed via HTTP
- **Every HTTP-facing schema class carries exactly one of the `Request`/`Response`
  suffixes** — `Base`/`Internal` classes are the only suffix-free exceptions
  (they are never HTTP bodies).
- **Class ordering** — schemas are declared in the order they are consumed:
  request-side classes first (`*CreateRequest`, `*CreateInternal`), then
  response-side (`*ReadResponse`), then update-side (`*UpdateRequest`,
  `*UpdateInternal`), then `to_read()`/`to_read_list()` helpers last. Nested
  child classes precede the parent that references them.

### An input must fit the column that stores it

A `*CreateRequest` / `*UpdateRequest` string field whose column is `String(n)`
declares `max_length` and never above `n`:

| Schema says | What the user gets |
|---|---|
| `max_length=200` into `String(120)` | not a 422 — a database error, answered as a 409 or 500 |
| no `max_length` at all | the same, for any string long enough |

A 422 names the field and the form can show it. Anything else reads as a server
fault for input the API should have refused. Only requests need the bound: a read
response carries what the row already holds.

### A closed column stays closed in its schema

A column with a `CheckConstraint("<col> IN (...)")` vocabulary keeps that
vocabulary in its schema as a named `Literal` alias, never a bare `str`:

```python
# engine/matcher.py
EndpointMethod = Literal["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS", "ANY"]
METHODS: tuple[str, ...] = get_args(EndpointMethod)


class EndpointBase(BaseModel):
    method: EndpointMethod
```

A named alias, not an inline `Literal` repeated per class: the same vocabulary is
declared once and every direction of the row reuses it, and the constraint is
spelled from it (`METHODS`). Widening it back to `str` throws the set away at the
only layer a client can read — silently, because the database still refuses a
bad value.

## Repository (`app/repositories/<name>.py`)

All `async`, plus the domain's own finders:

| Method | Signature | Returns |
|---|---|---|
| `get` | `get(<name>_id: UUID)` | `<Name> \| None` |
| `list` | `list(offset, limit, ...filters)` | `list[<Name>]` |
| `count` | `count(...filters)` | `int` — the page's `total`, over the same filters |
| `create` | `create(data: <Name>CreateInternal)` | `<Name>` |
| `update` | `update(<name>_id, data: <Name>UpdateInternal)` | `<Name> \| None` |
| `delete` | `delete(<name>_id: UUID)` | `bool` |

A child repository scopes by its parent: `list`/`count` take `project_id`, and a
child is fetched by its own id **and** the parent's, so `/project/A/endpoints/<id
of B's endpoint>` is a 404, not B's row. `list` and `count` share one private
filter builder so a page and its total never disagree.

Finders exist the day a caller does — the project slug lookup the mock router
resolves by, the matcher's candidate set of a project's endpoints. A table gets
no speculative finder.

All use `AsyncSession`. All use `model_dump()` for serialization.
Import `UUID` from `uuid` in every repository (`domain/repository-method-uuid-param.yml`).

## Service (`app/services/<name>.py`)

Thin adapter — no business logic beyond scoping a child to its parent, raising
`NotFoundError` when a resource is not found, and naming a conflict it can see.

```python
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession


class EndpointService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.endpoint_repository = EndpointRepository(session)
        self.project_repository = ProjectRepository(session)

    async def get_endpoint(self, project_id: UUID, endpoint_id: UUID) -> Endpoint:
        endpoint = await self.endpoint_repository.get(project_id, endpoint_id)
        if endpoint is None:
            raise NotFoundError(endpoint_id)
        return endpoint

    async def create_endpoint(self, project_id: UUID, data: EndpointCreateRequest) -> Endpoint:
        internal = EndpointCreateInternal(**data.model_dump(), project_id=project_id)
        async with self.session.begin():
            if await self.project_repository.get(project_id) is None:
                raise NotFoundError(project_id)
            return await self.endpoint_repository.create(internal)
```

**Injection naming** — services may inject multiple repositories/services, so
every internal collaborator is prefixed with its domain. Service variable
naming and repository encapsulation are documented in `backend-naming.md`
(`naming/var-name.yml`, `naming/repository-access.yml`) and
`backend-service-injection.md` (`check-backend-service-injection`).

Rules:
- `__init__(self, session: AsyncSession)` — accepts `AsyncSession` directly
- Creates repositories internally with domain prefixes:
  `self.endpoint_repository = EndpointRepository(session)`
- Uses `async with self.session.begin()` for writes only
  (`transaction/service-only.yml`, `domain/service-transaction-write-only.yml`;
  rule://backend-transaction)
- `exclude_unset=True` on update only (not create)
- `NotFoundError` raised for get/update/delete when not found — for a child,
  also when the parent project does not exist
- All methods that touch the session are `async` (`domain/service-method-async.yml`)
- The service **never** assigns `updated_at`; `AuditMixin`'s `onupdate` and the
  `version` bump happen at flush

## Router (`app/routers/<name>.py`)

`routers/project.py` serves the project and, nested under it, its children:

| Endpoint | Status | Returns |
|---|---|---|
| `POST /api/v1/project/` | 201 | `ProjectReadResponse` |
| `GET /api/v1/project/` | 200 | `Page[ProjectReadResponse]` (offset/limit/name/sort/order) |
| `GET /api/v1/project/{project_id}` | 200/404 | `ProjectReadResponse` |
| `PATCH /api/v1/project/{project_id}` | 200/404 | `ProjectReadResponse` |
| `DELETE /api/v1/project/{project_id}` | 200/404 | `{"ok": true}` |
| `POST/GET /api/v1/project/{project_id}/endpoints` | 201/200 | `EndpointReadResponse` / `Page[...]` |
| `GET/PATCH/DELETE /api/v1/project/{project_id}/endpoints/{endpoint_id}` | 200/404 | `EndpointReadResponse` / `{"ok": true}` |
| `GET /api/v1/project/{project_id}/logs` | 200 | `Page[RequestLogReadResponse]` |
| `GET /api/v1/project/{project_id}/logs/{request_log_id}` | 200/404 | `RequestLogReadResponse` |
| `DELETE /api/v1/project/{project_id}/logs` | 200 | `{"ok": true}` — clears the project's logs |

Request logs have no create or update route: they are append-only, written by
the mock router (`/mock/{slug}/{path:path}`, mounted directly on `app`,
unversioned like `health`) in a session of its own, so a failed mock answer
still leaves its log row.

Rules:
- Path parameters are `UUID` and named `<table>_id` (rule://backend-router-params,
  `check-backend-router-params`)
- `NotFoundError` and the other core exceptions are answered by the handler
  layer (rule://backend-exceptions) — never raised as `HTTPException`
- `to_read()` / `to_read_list()` for serialization
- Inject services through `Annotated` aliases from `dependencies/services.py`,
  list parameters through `dependencies/query.py`

## DI Chain

```
core.SessionDep → <Name>ServiceDep → Router
```

```python
# dependencies/services.py
def get_project_service(session: SessionDep) -> ProjectService:
    return ProjectService(session)
ProjectServiceDep = Annotated[ProjectService, Depends(get_project_service)]
```

- `Annotated[T, Depends(factory)]` — never `Depends()` inline
- DI deps are `Annotated` aliases, not direct calls
- Services receive `SessionDep` directly (no intermediate repository dependency)

## Testing (`tests/`)

rule://backend-testing is the standard. In short:

- `backend/tests/conftest.py`: in-memory SQLite, swaps `async_session_factory`
  so the real `get_session()` runs — no dependency override
- One api test file per router: `tests/api/test_project.py` covers the project
  and its nested endpoints/logs routes; `tests/api/test_mock.py` the mock router
- Tests cover: create, list, get, update, delete + not-found and 422 cases

## What Is Machine-Checked

There is no single domain hook; the pieces of this convention that are enforced
belong to these:

| Concern | Rule doc | Post hook |
|---|---|---|
| layer directories and imports | `backend-layout.md` | `check-backend-layout` |
| one table / one repository per file | `backend-model-files.md`, `backend-repository-files.md` | `check-backend-model-files`, `check-backend-repository-files` |
| naming, section layout | `backend-naming.md` | `check-backend-naming` |
| service injection | `backend-service-injection.md` | `check-backend-service-injection` |
| transactions | `backend-transaction.md` | `check-backend-transaction` |
| router parameters | `backend-router-params.md` | `check-backend-router-params` |
| exceptions | `backend-exceptions.md` | `check-backend-exceptions` |
| tests | `backend-testing.md` | `check-backend-tests` |
| ORM ↔ migrations | `backend-makefile.md` | `make -C backend migrate-check` |

**AST rules** (`.omp/ast-grep/rules/`) add structural checks string matching
cannot express:

| Rule dir | Checks |
|---|---|
| `domain/` | async where the session is touched, repository UUID params, transaction write-only |
| `transaction/` | service-only |
| `naming/` | var-name, repository-access, inner-function-underscore |
| `exceptions/` | builtin-forbidden, http-exception-forbidden, instance-raise |
| `environment/` | os-environ-direct, hardcoded-connection, hardcoded-port |
| `logging/` | secret-in-log |

Everything else in this document — the six-class schema family, `extra="forbid"`
on every class, `id`/`version` on every read, the router table, the child-scoping
of repositories — is convention (not machine-checked) and is held by review.

## Layer Enforcement

The layer boundary is visible at the import, and `check-backend-layout` holds
it against `APP_LAYERS`: `routers` may import `core`, `dependencies`, `engine`
and `schemas` — never `repositories` or `models`. A router that imports
`app.repositories.*` could read and write rows without the service that owns
them: no parent check, no conflict check.

A `from_session` factory is refused by convention (not machine-checked): it
builds its own dependency graph at the call site, so two callers get two
different graphs and neither is the one DI wired.

## Review Judgement (not machine-checked)

"Business logic" has no syntactic form, so these stay with the reviewer:

- Logic in a router or repository that should live in the service.
- A service method that is a pass-through and hides no decision.
- Whether a domain deserves its own service at all.
- Matching or rendering logic outside `engine/` — the matcher and templating are
  pure so the mock router and their unit tests share one implementation.

## Relationship Loading

Every `relationship()` declares `lazy="raise_on_sql"` (`Project.endpoints` is
the example). Under asyncio there is no safe lazy default: an attribute touched
outside a loaded query raises `MissingGreenlet` from inside greenlet plumbing,
at whichever endpoint touches it first. `raise_on_sql` moves the failure to the
access itself with a sentence a reader can act on, and turns "always eager-load"
from a review habit into a runtime guarantee.

Reads therefore eager-load what they return: `select(...).options(selectinload(...))`.
A parent whose children the database deletes (`ON DELETE CASCADE`) also sets
`passive_deletes=True`, so the ORM does not load the children only to delete
them one by one.

## Never Do These

- Skip a layer (e.g., router directly to repository)
- Business logic in router
- Business logic in repository
- `from_session` factory method (services accept session directly)
- Inline `Depends()` in router (use `Annotated` DI)
- A public function in `schemas/` other than `to_read`/`to_read_list` — put a
  constructor on the class, a caller detail in the caller
- `extra="allow"` on schemas
- Missing `from_attributes=True` on Read schemas
- Missing `extra="forbid"` on any schema
- A child route outside its parent's router, or a child fetched without its
  parent's id
- `created_by`/`updated_by` columns or fields — there is no user to record
- `int` primary keys — ids are `UUID` (`Mapped[uuid.UUID]`, `default=uuid4`)
