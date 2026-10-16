---
description: Backend naming — file names, variable names, module-private functions, encapsulation
globs:
      - backend/app/**/*.py
alwaysApply: false
---

# Backend Naming

## File Names

- `<name>.py` — lower snake case (`^[a-z][a-z0-9_]*$`), no hyphens or capitals
- A **model file is named after the table it maps** (`request_log` →
  `models/request_log.py`), machine-checked by `check-backend-model-files`.
  The schema/repository/service/router of a domain reuse the domain's name
  (`project.py` in each layer) — convention (not machine-checked).

## Service Variable Names (code-wide)

Any local variable, parameter, or attribute holding a service instance is
prefixed with its domain (checked by `naming/var-name.yml`):

| Context | Pattern | Example |
|---|---|---|
| Router param | `<domain>_service: XxxServiceDep` | `project_service: ProjectServiceDep` |
| Local var | `<domain>_service = XxxService(session)` | `request_log_service = RequestLogService(session)` |

Never a bare `service`.

## Service Internals

Every internal collaborator is prefixed with its domain (convention, not
machine-checked):

| Member | Pattern | Example |
|---|---|---|
| Own repository | `self.<name>_repository` | `self.project_repository = ProjectRepository(session)` |
| Other repository | `self.<other>_repository` | `self.endpoint_repository = EndpointRepository(session)` |

Never a bare `self.repository`.

A service never holds another service (rule://backend-service-injection).

## Repository Encapsulation (code-wide)

Repositories are private to their service. Only the owning service (via
`self.<domain>_repository`) may access them. Any
`<domain>_service.<domain>_repository.*` access outside a service class is
forbidden — call the service method instead
(checked by `naming/repository-access.yml`).

## Module-Private Functions

Module-level functions never referenced by another module must be prefixed with
`_` (e.g. `_lifespan`), enforced by `check-backend-naming.ts`. Inner functions
follow the same rule via `naming/inner-function-underscore.yml`.
FastAPI routes (`@router.`/`@app.` decorators), DI factories wired via
`Depends(NAME)`, and imported names are exempt.

**And a `_` name is never imported by another module.** The underscore is a
claim about who may call, and Python enforces none of it: without this half,
the rule above is one rename away from meaningless — a helper that does not
belong in a layer passes by being called `_helper` and imported anyway.
Machine-checked by `check-backend-naming.ts`; the fix is to move the logic to
the caller, not to widen the name.

## Class-Private Methods

A method that its own class calls on `self` and **no other module in `app/`
names** is an internal step: prefix it `_`. A helper that serves one line of its
own class while sitting in the public surface of every caller is invisible to
the module-private check above, which is anchored at column zero and never
looks inside a class.

Every module under `backend/app/`, with no layer carved out: an exemption held
for one file is a rule that stops meaning what it says. Tests are not counted as
callers — a method only its own class and its own test touch is still an
internal step, and the test can name it with the underscore.

Machine-checked by `check-backend-naming.ts`.

## Inner Functions

A function defined inside another function must be named `_<name>`
(e.g. `_not_found_handler`). Machine-checked by
`naming/inner-function-underscore.yml` (services, repositories, routers).

## Section Dividers

Every module in `backend/app/` is split into labeled sections by divider
pairs (machine-checked by `check-backend-naming.ts`):

```python
# ============================================================
# Imports
# ============================================================

from __future__ import annotations
...

# ============================================================
# Classes
# ============================================================

class Project(Base, AuditMixin):
    ...
```

- Divider = `# ` + 60 `=` characters; the next line is `# <Section Name>`.
- The first section is always `Imports` and precedes any code.
- **Import order, grouping and the blank lines after the block belong to ruff's
  `I` rules** (`lines-after-imports = 2`). Nothing switches the sorter off
  locally: no `# isort: off`/`# isort: on`, no `# noqa: I001`, no
  `# ruff: noqa: I001`. An exemption turns the order from a standard into a
  per-file opinion, and the next reader cannot tell which files were sorted.
- The markers this rule used to *require* were removed. Their premise — that
  isort would absorb the divider comments into the import block — is false,
  measured both ways (banner separated by a blank line, and banner glued to the
  last import): ruff leaves the banner where it is.
- Canonical section order (owned by `check-code-layout`): `Imports` →
  `Constants` → `Classes` → `Middleware` → `Lifespan` → `App Setup` →
  `Router` → `Functions` → `Dependencies` → `Router Registration`.
- A section is included only when the file has that content; the included
  sections must appear in canonical order (e.g. `Imports` → `Classes` →
  `Functions`, never `Functions` before `Classes`; a router's helpers follow
  its `Router` block).
- `main.py` uses the app-level sections: `Middleware`, `Lifespan`,
  `App Setup`, `Router Registration`.
- Routers use `Router` for the `router = APIRouter(...)` block (private helpers
  go under `Functions` after it); dependencies use `Dependencies` for the
  `Annotated[...]` aliases.

## Never Do These

- Bare `service` variable/param — domain-prefix it
- Bare `self.repository` — domain-prefix it
- Repository access outside the owning service
- Module-private functions without `_` prefix
- Inner functions without `_` prefix
- Importing a `_` name from another module
- A method only its own class calls left without a `_` prefix
- File names outside lower snake case
- A module without section dividers, or a first section other than `Imports`
- A section name outside the canonical set, or sections out of canonical order
- Code before the first `# Imports` divider
