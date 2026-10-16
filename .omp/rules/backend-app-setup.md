---
description: Backend app setup — health check, OpenAPI metadata, API versioning, unversioned health and mock mounts
globs:
      - backend/app/main.py
      - backend/app/routers/health.py
      - backend/app/routers/mock.py
alwaysApply: false
---

# Backend App Setup

## Purpose

Application-level setup in `main.py`: health endpoint, OpenAPI metadata, API
versioning, and where each router is mounted.

## 1. Health Check

`app/routers/health.py`:

```python
@router.get("/health")
async def health(session: SessionDep) -> dict[str, str]:
    try:
        await session.execute(text("SELECT 1"))
    except SQLAlchemyError as error:
        raise ServiceUnavailableError("Database unavailable") from error
    return {"status": "ok"}
```

- Returns 200 `{"status": "ok"}` when the database is reachable, 503 otherwise
- The 503 lives in the `ServiceUnavailableError` handler in
  `core/exceptions.py` (`code: service_unavailable`), never in an
  `HTTPException` at the raise site (rule://backend-exceptions)
- Mounted directly on `app`, **outside** the `/api/v1` prefix: probes use a
  fixed path

## 2. OpenAPI Metadata

```python
app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="...",
    lifespan=_lifespan,
)
```

- Tags from router `tags=[...]`; `/docs` reachable in dev only

## 3. API Versioning

- The prefix is declared once, `API_V1_PREFIX = "/api/v1"` in
  `core/settings.py`, and `main.py` imports it - never retypes it
- Every admin router is mounted on `api_router = APIRouter(prefix=API_V1_PREFIX)`,
  which is then included on `app`
- `health` (`/health`) and `mock` (`/mock/{slug}/{path:path}`) stay unversioned

## Router Mounting

```python
app.include_router(health.router)
app.include_router(mock.router)

api_router = APIRouter(prefix=API_V1_PREFIX)
api_router.include_router(project.router)
app.include_router(api_router)
```

Every router module in `app/routers/` is mounted on `api_router` - except the
two unversioned ones, which are mounted directly on `app`:

| Router | Path | Why unversioned |
|---|---|---|
| `health` | `/health` | probes use a fixed path |
| `mock` | `/mock/{slug}/{path:path}` (`MOCK_PREFIX`) | a mocked URL is what the app under test calls; versioning the admin API must not change it |

`check-backend-app-setup` (`make check-backend-app-setup`) compares the modules
on disk against the mounts in `main.py`: an admin router mounted on `app` is a
second, unversioned API; `health` or `mock` mounted on `api_router` moves a
fixed URL; and a router that is never mounted answers nothing. It also requires
the literal `api_router = APIRouter(prefix=API_V1_PREFIX)`, the health route and
its `ServiceUnavailableError`, a 503 handler in `core/exceptions.py`, and
`FastAPI(title=...)`. Checking only that the string `/api/v1` appears in
`main.py` could see none of the mounting mistakes.

The mock router's own placement rules (CSRF exemption, CORS, headers the mock
declares) are in rule://backend-middleware.

## Never Do These

- Add an admin router without mounting it on `api_router`
- Mount `health` or `mock` under `/api/v1`
- Retype `"/api/v1"` in `main.py` instead of importing `API_V1_PREFIX`
- Raise `HTTPException` for the health 503
- Skip `title`/`version` in `FastAPI(...)`
