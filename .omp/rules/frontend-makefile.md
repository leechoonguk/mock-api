---
description: Frontend Makefile usage — targets, commands, and development workflow
globs:
      - frontend/Makefile
      - frontend/package.json
      - frontend/vite.config.ts
      - frontend/tsconfig.json
      - frontend/src/**/*.tsx
      - frontend/src/**/*.css
alwaysApply: false
---

# Frontend Makefile Usage


## Self-Documenting Targets

Every target carries a `## <description>` on its header line. `make help` greps
those descriptions, so a target without one exists but cannot be found - and an
undiscoverable target is re-invented as a raw command. `check-makefiles`
enforces it on the root, backend and frontend Makefiles.

## Makefile Targets

| Target | Command | Purpose |
|---|---|---|
| `make help` | `grep -E 'target:.*?## .*'` | Show this help |
| `make install` | `npm install` | Install frontend dependencies (also the harness's `typescript` and `@ast-grep/cli`) |
| `make dev` | `nohup npx vite` | Vite dev server on the port in `vite.config.ts` (47823, `strictPort`), in the background; log in `/tmp/mock-api-frontend.log` |
| `make down` | kill the listener on `$(FRONTEND_PORT)` | Stop the frontend — the port is read from `vite.config.ts`, so `down` cannot target a stale one |
| `make clean` | `rm -rf dist .vite node_modules/.vite *.tsbuildinfo` | Remove build, Vite, and TypeScript caches |
| `make verify` | `lint + typecheck + build` | Full quality gate (fail-fast) |
| `make lint` | `npx eslint .` | ESLint check |
| `make typecheck` | `npx tsc --noEmit` | TypeScript type check |
| `make build` | `tsc -b && vite build` | Production build |

## Development Commands

1. **Start dev server**: `make dev` — Vite on the configured port (47823)
2. **Stop dev server**: `make down` — kill Vite on that same port
3. **Verify**: `make verify` — lint → typecheck → build (fail-fast)
4. **Build**: `make build` — production assets to `frontend/dist/`
5. **Install**: `make install` — install npm dependencies

## Project Structure

- `frontend/src/` — source files (`.tsx`, `.ts`, `.css`)
- `frontend/vite.config.ts` — Vite config (port 47823, `strictPort`, `/api`, `/mock`, `/health` proxy → `http://127.0.0.1:47821`)
- `frontend/tsconfig.json` — TypeScript config (strict, `@/*` alias)
- `frontend/package.json` — npm package config

## Code Conventions

Code conventions (React/TypeScript/Vite/ESLint/component pattern/API proxy) are
documented in `frontend-code-conventions.md` — that rule is the single source.
This rule only covers Makefile targets and the dev workflow.

## API Proxy

In development `make dev` starts Vite (:47823) and proxies `/api`, `/mock` and
`/health` to the backend on `127.0.0.1:47821`, so the browser talks to one
origin and the backend needs no CORS entry for the admin UI. There is no
production web server: the project runs locally only.

## Never Do These

- Forget `make verify` before commit (lint + typecheck + build)
- Spell a port in `src/` — the proxy and `config.ts` (`VITE_MOCK_ORIGIN`) own the host
