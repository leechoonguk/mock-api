---
description: Environment — .env conventions (root, backend, frontend), settings.py, no direct os.environ
globs:
      - .env*
      - backend/.env*
      - frontend/.env*
      - backend/app/core/settings.py
      - backend/pyproject.toml
alwaysApply: false
---

# Environment

Convention (not machine-checked): no `check-environment` hook is ported, so
everything below is guidance the reviewer and the author hold, not a gate.

## Three Env Pairs

Each env file has a committed `.env.example` reference beside a gitignored
`.env`. The app is local-only: there is no container, no compose file, and no
second deployment target reading these values.

| Pair | Read by | Keys |
|---|---|---|
| root `.env` / `.env.example` | `backend/Makefile` (`BACKEND_PORT`); `FRONTEND_PORT` documents the Vite port | `BACKEND_PORT`, `FRONTEND_PORT` |
| `backend/.env` / `.env.example` | `pydantic-settings` (`backend/app/core/settings.py`) | `ENV`, `DATABASE_URL`, `APP_NAME`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `CORS_ORIGINS`, `ITEMS_PER_USER` |
| `frontend/.env` / `.env.example` | Vite (`import.meta.env`, `frontend/src/config.ts`) | `VITE_MOCK_ORIGIN` |

The root pair is **not** a settings source: the backend app never reads it. It
holds the host ports the Makefiles and the developer agree on (backend
`127.0.0.1:47821`, Vite `47823`). The Vite port and its proxy target
(`/api`, `/mock`, `/health` → backend) live in `frontend/vite.config.ts`
(`strictPort`, so a clash fails fast instead of drifting to another port).

`VITE_MOCK_ORIGIN` is optional: unset, the admin UI uses the page's own origin
and the Vite proxy forwards `/mock` to the backend. Set, it points a copied mock
URL straight at the backend, so a pasted `curl` does not depend on Vite running.

### Source Precedence: the Environment Wins

`pydantic-settings`' own order stands: **an environment variable outranks the
dotenv file**, and `Settings` declares no `settings_customise_sources`. The
`.env` file is the fallback for a process a developer starts by hand;
`make -C backend dev` sets `ENV=local` on the command line and that wins.

**The test suite declares its own environment.** `app.main` constructs
`Settings()` when the conftest imports it, before any fixture runs, so every
required field is declared under `[tool.pytest.ini_options] env` (pytest-env)
in `backend/pyproject.toml` and **forced**, not defaulted: a value the shell
happens to export must not change what the suite constructs, and the suite must
be a function of the checkout alone (the `.env` it would otherwise read is
gitignored). A new required setting is added there in the same change.

### Env File Format

Root and backend env files use one style:

- A `# ===...` header banner at the top (file purpose + how it is read)
- `# --- <Section> ---` markers grouping related variables
- A `# <description>` comment line above any variable that needs one
- Every assignment uses the aligned **`KEY = value`** form — a space on both
  sides of `=`
- Same keys, the same `# --- <Section> ---` markers, and the same
  per-variable comment in `.env` and its `.env.example`

```bash
# =============================================================================
# Backend environment — copy to .env and adjust as needed.
# =============================================================================

# --- Database ---
# SQLite file the app and Alembic use (relative to backend/)
DATABASE_URL = sqlite+aiosqlite:///./data/mock.db

# --- App ---
APP_NAME = "Mock API"
```

`frontend/.env` follows Vite's dotenv parser, which takes `KEY=value`; keep a
comment above each key there instead of the banner/section layout.

### A Pair Carries One Set of Values

`.env.example` is a **copy** of its `.env`, not a variant: same keys, same
sections, same comments, **same values**. When an environment really needs
different values, it gets its own file (`.env.local`), never a silent
divergence inside one pair: an `ALLOWED_HOSTS` entry added to `backend/.env`
and not to `.env.example` is a setting the next clone does not have.

### Backend Settings

| Variable | Type | Default | Description |
|---|---|---|---|
| `ENV` | `str` | — | `local`, `test`, or `production` (validated) |
| `DATABASE_URL` | `str` | — | Must start with `sqlite+aiosqlite://` (validated), e.g. `sqlite+aiosqlite:///./data/mock.db` |
| `APP_NAME` | `str` | — | Application display name |
| `ALLOWED_HOSTS` | `list[str]` | — | Host allowlist; must name at least one host (validated) |
| `CSRF_TRUSTED_ORIGINS` | `list[str]` | — | Admin UI origins allowed to send unsafe admin requests; the mocks are exempt |
| `CORS_ORIGINS` | `list[str]` | `["*"]` | `*` is safe: no cookies or credentials exist, and mocks are called from any origin |
| `ITEMS_PER_USER` | `int` | — | Required integer setting |

`ALLOWED_HOSTS` has no default on purpose: a Host allowlist that falls back to
"accept anything" is the vulnerability it exists to close. Include `testserver`
in the test environment — it is the Host Starlette's `TestClient` sends.

`make -C backend migrate` creates `backend/data/` before running Alembic, which
needs `DATABASE_URL` in the environment or `backend/.env`, so the file database
lives where the app expects it. `make -C backend migrate-check` uses a
throwaway database and never touches the developer's data.

## Pydantic Settings (`backend/app/core/settings.py`)

```python
class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str
    env: str
    database_url: str
    allowed_hosts: list[str]
    csrf_trusted_origins: list[str]
    items_per_user: int
    cors_origins: list[str] = ["*"]
```

Settings are loaded from the environment and `.env` by `BaseSettings`, with
validators for `env`, `allowed_hosts`, and `database_url`. Values that are not
per-environment (`API_V1_PREFIX`, `MOCK_PREFIX`, `LOG_RETENTION_PER_PROJECT`,
`MAX_LOG_BODY_BYTES`, `MAX_DELAY_MS`) are module constants in `settings.py`,
not env vars — a knob nobody turns is a key that drifts between files.

## No Direct Environment Access

Application code reads configuration through `settings.<field>`, never
`os.environ[...]` / `os.getenv(...)`: direct access bypasses validation and
defaults, so a typo yields `None` at first use instead of a startup failure.

AST rules for this exist in `.omp/ast-grep/rules/environment/`, but **no ported
hook runs them** — they are not wired to any check, so treat them as a
statement of the convention, not a gate:

| Rule | States |
|---|---|
| `os-environ-direct.yml` | no `os.environ[...]` / `os.getenv(...)` — use `settings.py` |
| `hardcoded-connection.yml` | no literal connection strings — use `settings.database_url` |
| `hardcoded-port.yml` | no literal `localhost:<port>` in code — use settings or Vite config |

## settings.env Is Not a Security Input

`settings.env` says **where** the code runs, never what a request may do. A
safety path (Host allowlist, CSRF, CORS) that branches on it is a different
program in every environment, so the version that is tested is not the version
that runs. Decide from an explicit setting instead.

## Never Do These

- Commit a `.env` (use `.env.example` instead)
- Read `os.environ` / `os.getenv` in `backend/app/` — use `settings.py`
- Hardcode a connection string or a `localhost:<port>` in backend code
- Add a required setting without adding it to `backend/.env.example` and to
  `[tool.pytest.ini_options] env`
- Let `.env` and `.env.example` drift (keys, section markers, comments, values)
- Use unaligned assignments (`KEY=value`) in root or backend env files
- Branch a security decision on `settings.env`
