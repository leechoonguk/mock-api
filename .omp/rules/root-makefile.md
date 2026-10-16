---
description: Root Makefile — the gate, the harness checks, and delegation to backend/frontend
globs:
      - Makefile
      - .env.example
alwaysApply: false
---

# Root Makefile Usage


## Self-Documenting Targets

Every target carries a `## <description>` on its header line. `make help` greps
those descriptions, so a target without one exists but cannot be found - and an
undiscoverable target is re-invented as a raw command. `check-makefiles`
enforces it on the root, backend and frontend Makefiles.

## Verify Membership

`make verify` is the gate: `strict-verified-git` runs it before every commit
and the `commit` skill treats its exit status as authoritative. A `check-*`
target that exists but is not a prerequisite of `verify` passes when run by
hand and is never run by the gate. The contract, enforced by `check-makefiles`:

- Every `check-<name>` target whose recipe runs `node .omp/hooks/post/...`
  **must** be a prerequisite of `verify`. Post hooks are hermetic by design, so
  there is no reason for one to stay outside the gate.
- `make hook-report` is backed by `.omp/hooks/lib/` and reports on past
  sessions; it is not a check and stays out of `verify`.
- The `make verify` row in the table below lists **exactly** the Makefile's
  prerequisites, joined by ` + `, in the same order. The doc is the reviewable
  contract, the Makefile is the executed one — `check-makefiles` diffs them in
  both directions, so editing one without the other fails the gate.

Adding a post hook therefore touches five places: the hook file, its
`check-<name>` target, the `verify:` prerequisite list, this table (its own
row plus the `make verify` row), and `disabledExtensions` in `.omp/config.yml`.

## Overview

The root `Makefile` runs the harness checks and delegates everything else to
`backend/Makefile` and `frontend/Makefile`. There is no container stack: the
backend is uvicorn on `127.0.0.1:47821` with a SQLite file under
`backend/data/`, the frontend is Vite on `:47823`. Run from the project root.

## Makefile Targets

| Target | Command | Purpose |
|---|---|---|
| `make help` | `grep -E '^[a-zA-Z_-]+:.*?## .*'` | Show this help |
| `make install` | `make -C backend install` + `make -C frontend install` | Install backend (`uv sync`) and frontend (`npm install`) dependencies |
| `make dev` | `make -C backend dev` + `make -C frontend dev` | Start both dev servers in the background (logs in `/tmp/mock-api-backend.log`, `/tmp/mock-api-frontend.log`) |
| `make down` | `make -C backend down` + `make -C frontend down` | Stop both dev servers (kills the port listeners) |
| `make clean` | `make -C backend clean` + `make -C frontend clean` | Remove backend and frontend caches |
| `make migrate` | `make -C backend migrate` | Apply Alembic migrations to the local SQLite database |
| `make hook-report` | `node .omp/hooks/lib/hook-metrics.ts` | Report what the post hooks cost per run and which ones never warned |
| `make verify` | `check-backend-model-files + check-backend-repository-files + check-backend-service-injection + check-backend-layout + check-backend-exceptions + check-backend-router-params + check-backend-naming + check-backend-transaction + check-backend-tests + check-backend-middleware + check-backend-app-setup + check-backend-core-config + check-duplicate-blocks + check-code-layout + check-tooling + check-frontend-code + check-frontend-layout + check-frontend-domain + check-frontend-api-layer + check-frontend-routing + check-frontend-i18n + check-omp-types + check-makefiles + check-verify` | Run all OMP hooks + backend + frontend verify (hermetic — no running server needed) |
| `make check-backend-model-files` | `node .omp/hooks/post/check-backend-model-files.ts` | Check model files — one table, one class, one file (`rule://backend-model-files`) |
| `make check-backend-repository-files` | `node .omp/hooks/post/check-backend-repository-files.ts` | Check repository files — one repository, one table, named after it (`rule://backend-repository-files`) |
| `make check-backend-service-injection` | `node .omp/hooks/post/check-backend-service-injection.ts` | Check no service imports another service (`rule://backend-service-injection`) |
| `make check-backend-layout` | `node .omp/hooks/post/check-backend-layout.ts` | Check the backend directory charter — every directory declared, every module named for its directory, every import inside its charter (`rule://backend-layout`) |
| `make check-backend-exceptions` | `node .omp/hooks/post/check-backend-exceptions.ts` | Check core exception policy (raise only core exceptions) |
| `make check-backend-router-params` | `node .omp/hooks/post/check-backend-router-params.ts` | Check backend router parameter standard (path/body/dep/query) |
| `make check-backend-naming` | `node .omp/hooks/post/check-backend-naming.ts` | Check backend naming conventions |
| `make check-backend-transaction` | `node .omp/hooks/post/check-backend-transaction.ts` | Check backend transaction conventions |
| `make check-backend-tests` | `node .omp/hooks/post/check-backend-tests.ts` | Check backend test standard (mirrored test tree, 9 API cases, conftest) |
| `make check-backend-middleware` | `node .omp/hooks/post/check-backend-middleware.ts` | Check backend middleware (CORS, CSRF, security headers, request ID, logging) |
| `make check-backend-app-setup` | `node .omp/hooks/post/check-backend-app-setup.ts` | Check backend app setup (health, OpenAPI metadata, /api/v1, unversioned mock) |
| `make check-backend-core-config` | `node .omp/hooks/post/check-backend-core-config.ts` | Check backend core config (settings validators, DB pool, error schema) |
| `make check-duplicate-blocks` | `node .omp/hooks/post/check-duplicate-blocks.ts` | Check for duplicated block runs (stale rewrite + partial edits) |
| `make check-code-layout` | `node .omp/hooks/post/check-code-layout.ts` | Check code layout (comments, banners, constants, member order) |
| `make check-tooling` | `node .omp/hooks/post/check-tooling.ts` | Check tooling language policy (TypeScript hooks, no Python scripts) |
| `make check-frontend-code` | `node .omp/hooks/post/check-frontend-code.ts` | Check frontend code conventions |
| `make check-frontend-layout` | `node .omp/hooks/post/check-frontend-layout.ts` | Check the frontend directory charter — every src/ entry declared, every file named for its directory, every import inside its charter, no component cycle (`rule://frontend-layout`) |
| `make check-frontend-domain` | `node .omp/hooks/post/check-frontend-domain.ts` | Check the frontend 6-layer domain pattern (child and read-only domains included) |
| `make check-frontend-api-layer` | `node .omp/hooks/post/check-frontend-api-layer.ts` | Check the frontend API layer (one client, keys, invalidation) |
| `make check-frontend-routing` | `node .omp/hooks/post/check-frontend-routing.ts` | Check paths ↔ routes ↔ navigation and the catch-all inside the shell |
| `make check-frontend-i18n` | `node .omp/hooks/post/check-frontend-i18n.ts` | Check locale parity, referenced keys and hardcoded text |
| `make check-omp-types` | `node .omp/hooks/post/check-omp-types.ts` | Type-check the harness TypeScript (`.omp/**/*.ts`) |
| `make check-makefiles` | `node .omp/hooks/post/check-makefiles.ts` | Check Makefile targets consistency |
| `make check-verify` | `node .omp/hooks/post/check-verify.ts` | Run backend + frontend verify (lint, typecheck, test/build) |
| `make commit` | `git add -A` + `git commit` behind `verify` | Commit the verified worktree — `m="type(scope): subject"` for a one-liner, `f=<file>` for a message with a body; the gate is a prerequisite, so the tree that is committed is the tree that passed |
| `make push` | `git push origin <current branch>` behind `verify` | Push after the gate passes again, because the worktree may have moved since the commit |

## Workflow

1. **Install**: `make install` (uv sync + npm install)
2. **Migrate**: `make migrate` (also run by `make dev` through `backend/scripts/start.sh`)
3. **Run**: `make dev`, open `http://localhost:47823`
4. **Stop**: `make down`
5. **Gate**: `make verify` before finishing any change

## Verification Status

- A `make verify` failure is authoritative only when the command's captured exit
  status is nonzero.
- If a tool wrapper reports a nonzero status while every check prints `PASS`, rerun
  the command and capture Make's status before changing code:

  ```bash
  make verify; status=$?; printf 'MAKE_VERIFY_EXIT=%s\n' "$status"
  ```

- `MAKE_VERIFY_EXIT=0` means verification passed. Report the wrapper discrepancy
  as a harness issue; do not change project code to satisfy a contradictory status.

## Environment

- **Root `.env`** (from `.env.example`) — the host ports: `BACKEND_PORT=47821`,
  `FRONTEND_PORT=47823`. `backend/Makefile` reads `BACKEND_PORT` from it.
- **`backend/.env`** — the backend app's own settings (`ENV`, `DATABASE_URL`,
  `APP_NAME`, `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `ITEMS_PER_USER`), read by
  pydantic-settings. See `environment.md`.
- **`frontend/.env`** — `VITE_MOCK_ORIGIN`, the origin the endpoint test panel
  sends mocked requests to.

## Delegation

`migrate` delegates to `make -C backend migrate`. Spelling out
`.venv/bin/alembic upgrade head` here would duplicate what that target owns, so
the root Makefile runs the harness and hands backend and frontend work to their
own Makefiles.

## Never Do These

- Declare a catch-all rule (`%:`, `.DEFAULT:`) in any Makefile — it answers every
  unknown target with success, so `make check-anything` passes and the whole gate
  reads green without running. `check-makefiles` rejects it, and an acceptance
  predicate should be the whole gate (`make verify`) precisely because a narrow
  one invites rewriting the gate instead of doing the work.
- Pipe `make verify` into `tail`/`head`/`grep` — a truncated gate hides the
  failing check, and `strict-command-routing` refuses it.
- Bind the backend to anything but `127.0.0.1` — the admin API has no
  authentication.
