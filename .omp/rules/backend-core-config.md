---
description: Backend core config — settings validation, SQLite engine, error response schema
globs:
      - backend/app/core/settings.py
      - backend/app/core/database.py
      - backend/app/core/exceptions.py
alwaysApply: false
---

# Backend Core Config

## Purpose

Core configuration standards: Pydantic settings validation, an explicit SQLite
engine config, and a uniform error response schema.

## 1. Settings Validation

```python
@field_validator("env")
@classmethod
def validate_env(cls, value: str) -> str:
    if value not in ENVIRONMENTS:
        raise ValueError("env must be local|test|production")
    return value
```

- `env` enum: `local` | `test` | `production` (`ENVIRONMENTS`)
- `DATABASE_URL` must start with `sqlite+aiosqlite://` (`DATABASE_URL_SCHEME`):
  the app is SQLite-only, and a URL the engine cannot drive stops startup
  instead of failing on the first query
- `allowed_hosts` is required and non-empty (rule://backend-middleware)
- Fixed app constants (`API_V1_PREFIX`, `MOCK_PREFIX`, log retention, body and
  delay caps) live as module constants in `settings.py`, read from there,
  never retyped

## 2. Database Engine

```python
@event.listens_for(Engine, "connect")
def _enable_foreign_keys(dbapi_connection: Any, _record: Any) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


if make_url(settings.database_url).database in IN_MEMORY_DATABASES:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
else:
    engine = create_async_engine(
        settings.database_url,
        pool_size=5,
        max_overflow=10,
        pool_timeout=30,
        pool_pre_ping=True,
    )
```

- **`PRAGMA foreign_keys=ON` on every connection.** SQLite ignores
  `ON DELETE CASCADE` / `SET NULL` unless each connection asks for them, so
  without it a deleted project would leave its endpoints and request logs
  behind. The listener is registered on the `Engine` class, not the module
  engine, so the test suite's in-memory engines enforce the same constraints.
- **A file database gets explicit `pool_size`/`max_overflow`/`pool_timeout`** —
  never rely on defaults.
- **An in-memory URL (`sqlite+aiosqlite://`, `:memory:`) gets no pool args**: an
  in-memory database lives in one connection, so it has no pool to size, and
  the pool arguments do not apply to the pool SQLAlchemy picks for it.

## 3. Error Response Schema

- `core/exceptions.py` handlers return `{"detail", "code", "request_id"}`
- `code` is a stable machine-readable snake_case string (`not_found`,
  `conflict`, `stale_version`, `mock_not_matched`, `service_unavailable`); it is
  also the frontend's locale key (`errors.<code>`)
- `request_id` from the request middleware context
- `IntegrityError` maps to 409 `conflict` (a taken slug, a duplicate method and
  path) with a generic detail - a database message names columns and
  constraints; `StaleDataError` maps to 409 `stale_version`
- A mock miss (`MockNotMatchedError`) adds the `method` and `path` the mock was
  asked for, so the caller can tell "no such route" from "no such project"
- Each handler writes its own `detail`/`code`/`request_id` literals:
  `check-backend-exceptions` reads the body of the handler it governs, and
  `check-frontend-i18n` discovers the server's error codes from those literals,
  so a shared body builder would make both checks blind.

## Validation (Post-Hook)

`check-backend-core-config.ts` (`make check-backend-core-config`) verifies that
`settings.py` has a `@field_validator`, that `database.py` names
`pool_size`/`max_overflow`/`pool_timeout`, and that `exceptions.py` returns a
`"code"` and a `request_id`. The foreign-key pragma and the in-memory branch
are conventions (not machine-checked); the API tests depend on both.

## Never Do These

- Skip `pool_size`/`max_overflow` when creating the file-database engine
- Pass pool arguments to the in-memory engine
- Open a connection without `PRAGMA foreign_keys=ON`
- Return raw `{"detail": ...}` from a new exception without `code`/`request_id`
- Accept an invalid `env` value or a non-SQLite `DATABASE_URL` silently
