---
description: Backend code conventions — Python version, linter config, Pydantic, SQLAlchemy, testing
globs:
      - backend/pyproject.toml
      - backend/app/**/*.py
      - backend/alembic/**/*.py
alwaysApply: false
---

# Backend Code Conventions

## Python

- **Python ≥ 3.13** (`requires-python`; `.python-version` pins the venv's
  interpreter), `target-version = "py313"`, `line-length = 100`
- `from __future__ import annotations` in all generated files (static analysis compat)

## Linting

- **Ruff**: `E`, `W`, `F`, `I`, `UP`, `B`, `SIM`, `S`, `D` (tests only), and the
  complexity three — `C901`, `PLR0912`, `PLR0915`
- Run: `make -C backend lint` (ruff check app alembic tests)

### Complexity

Measured by the linter that already runs, at ruff's defaults: cyclomatic 10,
branches 12, statements 50. Complexity costs three rule names in the linter
that already runs instead of a separate quality server. Coverage (100%, the
`--cov-fail-under=100` addopt), types and formatting are already stricter here
than a default quality gate.

**Two rules are deliberately absent.** `PLR0913` (arguments) would fight
`backend-router-params.md` on every endpoint — a router's signature is its
contract with FastAPI's DI and with OpenAPI, so eight parameters there is the
standard, not a smell. `PLR0911` (returns) would push guard clauses into nested
tails.

### Security (`S`)

Bandit's rules, on the same terms. The surfaces that matter in this app are the
ones a mock touches: the templated response body (`engine/templating.py`) is
rendered from caller-controlled request data, so it must stay a plain
substitution - no `eval`, no template engine that executes expressions, no
`pickle`/`yaml.load` of a request body. `S` flags those constructs where they
appear.

Tests are exempt from the fixture-shaped rules (`S101`, `S603`): a test
asserts, and runs our own migration binary.

**Suppress at the site, with the reason.** A `# noqa` names one rule on one
line, and a docstring paragraph or comment beside it says why the shape is the
right one - wide, flat, exhaustive dispatch (an exception-handler registry, one
branch per HTTP method) is the usual species, not tangled logic. A file-wide
ignore would exempt every function written there afterwards. A type
suppression carries its reason on the same line, after the pragma
(`# type: ignore[call-arg] - pydantic-settings reads the fields from the
environment`) — convention (not machine-checked).

## Type Checking

- **Pyright**: `typeCheckingMode = "standard"`
- Run: `make -C backend typecheck` (pyright, version pinned in `pyproject.toml`)

## Testing

- Tests use **in-memory SQLite** (`DATABASE_URL=sqlite+aiosqlite://`, forced by
  `pytest-env` in `pyproject.toml`) + `TestClient`
- DI override for `get_session` in `conftest.py`
- Run: `make -C backend test`

## Layer-Specific Conventions

Pydantic/SQLAlchemy/UUID conventions per layer are documented in
`backend-domain.md` — that rule is the single source for the 5-layer pattern.
This rule covers tooling configuration only.
