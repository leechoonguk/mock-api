# Mock API — Project Guide

## Overview

A Postman-like mock API server with an admin UI. A **project** (unique `slug`)
owns **endpoints** — method, path pattern (`/users/{id}`), status code, headers,
a body template (`{{path.id}}`, `{{query.x}}`, `{{headers.x}}`, `{{body.a.b}}`,
`{{now}}`, `{{uuid}}`) and a delay. Any request to `/mock/{slug}/{path}` is
matched against the project's enabled endpoints and answered; every request to
an existing project is written to its **request log**.

FastAPI + SQLAlchemy 2.0 (async, SQLite via aiosqlite) + Alembic + Pydantic 2 +
structlog. Backend in `backend/`, frontend in `frontend/` (Vite + React 19 +
TypeScript + MUI 7 + react-query + i18next ko/en). Python ≥ 3.13, uv for
dependency management. Local only: backend on `127.0.0.1:47821` (no
authentication, so never bound wider), Vite on `:47823` proxying `/api`,
`/mock` and `/health` to it.

## Project Structure

```
backend/
  app/
    core/           Settings, database engine, exceptions, logging, Page envelope
    engine/         Pure functions: path matcher (METHODS, find_best), body templating
    models/         SQLAlchemy ORM models (Base, AuditMixin, project, endpoint, request_log)
    schemas/        Pydantic schemas (Create/Update requests, Read responses, internal)
    repositories/   Async repositories, one per table (flush only)
    services/       Transactions and domain rules; mock.py resolves and logs mocked requests
    dependencies/   DI wiring (core, services, query)
    routers/        health, project (/api/v1, endpoints + logs nested), mock (/mock/{slug}/...)
    main.py         App assembly, middleware, router registration
  tests/            pytest + httpx, 100% coverage, mirrors app/
  alembic/          DB migrations (integer revision ids, render_as_batch)
  scripts/          start.sh
  Makefile
  pyproject.toml
frontend/
  src/              types, utils, locales, routes, theme, lib/api, hooks, components,
                    layouts, sections/project (list, form, detail dialog + tabs/panels), pages
  vite.config.ts
  Makefile
api/                REST Client .http files (health, project, mock)
.omp/               RULES.md, rules/, hooks/ (pre, post, lib), extensions/continuity, ast-grep/, skills/
Makefile            install, dev, down, migrate, verify (every check-* + backend/frontend verify), commit, push
```

## Rules (`.omp/rules/`)

Domain rules live in `.omp/rules/` and are **never** imported here. There are
exactly three delivery channels, and only one of them puts a rule body in front
of the model on its own:

| Channel | Frontmatter | What actually reaches the model |
|---|---|---|
| Rulebook | `description` + `globs` | Only the line `- <name> (<globs>): <description>`. The body is read on demand via `rule://<name>` |
| Always-apply | `alwaysApply: true` | Full body in every session's system prompt — keep it to at most 2 rules |
| TTSR trigger | `condition` (regex) + `scope` + `interruptMode` | Full body injected the moment a matching stream appears — an edit is aborted before it lands |

**`globs` do not deliver anything.** Editing a file that matches a rule's globs
injects nothing (the harness docs: `globs` "is not used to automatically select
rulebook rules"). On a TTSR rule, `globs` is only a path gate. So a rulebook
rule is documentation of an invariant that a hook enforces mechanically — the
enforcement is the hook (`make verify`), never the listing.

`RULES.md` (this directory, not `rules/`) is the sticky always-apply rule.

Naming: `<scope>-<name>.md` (e.g. `backend-layout.md`). A post hook
`check-<x>.ts` prints the rule named `<x>.md` as its hint when one exists.
Adding a rule = creating the file only; no `@rules/` entry here. A TTSR trigger
additionally needs `omp ttsr test` proof that it fires on the construct and
stays quiet on prose.

## Development Workflow

Before applying or modifying any code pattern for the first time, use **Context7** (`context7-mcp`) to look up relevant library/framework documentation. Query the library ID, fetch the current docs, and apply patterns based on verified content — not assumptions. This applies to backend (FastAPI, SQLAlchemy, Alembic, Pydantic, pydantic-settings, structlog) and frontend (Vite, React, TypeScript, MUI, TanStack Query, react-hook-form, i18next) libraries.

Run everything through make targets (`make dev`, `make -C backend test`,
`make verify`); the pre hooks refuse bare `pytest`, `.venv/bin/*` and
`npx tsc|eslint|vite`. Finish every change with a green root `make verify`.
