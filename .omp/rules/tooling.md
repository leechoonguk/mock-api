---
description: Tooling language — checks, runners and scripts are TypeScript under .omp/hooks/ or .omp/extensions/, never Python
globs:
      - .omp/hooks/**/*.ts
      - .omp/extensions/**/*.ts
      - Makefile
      - backend/scripts/**
alwaysApply: false
---

# Tooling Language

Automation is read far more often than it is written, and it must run on any
machine that can run the harness. That fixes the language and the location:
**tooling is TypeScript under `.omp/hooks/`, executed by a `make` target.**

Machine-checked by `strict-tooling.ts` (write time) and `check-tooling.ts`
(tree scan).

## Placement

| Kind | Location | Executed by |
|---|---|---|
| Automatic check | `.omp/hooks/post/check-<name>.ts` | `tool_result` event **and** `make check-<name>` |
| Write-time block | `.omp/hooks/pre/strict-<name>.ts` | `tool_call` event |
| Shared logic | `.omp/hooks/lib/<scope>-<name>.ts` | the hooks that import it |
| Package build config | that package (`frontend/*.config.*`) | that package's Makefile |
| Session-lifetime behaviour | `.omp/extensions/<name>/*.ts` | the extension runner — **auto-loaded**, never invoked |
| Application code | `backend/app`, `backend/tests`, `backend/alembic` | the app, pytest, alembic |

- **Python is application code only.** A Python helper for a check needs a
  virtualenv, a second toolchain and a second dependency set to answer one
  question. `node` already runs the harness, and it strips TypeScript types
  natively — a `.ts` file is directly executable, with no build step.
- **One sanctioned shell script**: `backend/scripts/start.sh`. Shell has no
  types, no imports and no tests; a second one is an unreviewable check.
- **`.omp/hooks/` is TypeScript only.** Hooks and libs import each other, so a
  stray `.js`/`.mjs` breaks the import graph and the type contract.
- **No root `scripts/`, `tools/`, `bin/`, `utils/`.** Tooling outside
  `.omp/hooks/` has no make target and no rule mapping, so nothing runs it.
- **No throwaway scripts.** A verification script kept outside the repository
  proves nothing after the session ends: land it as a hook with a make target,
  or do not rely on it.

## Toolchain: Borrowed From `frontend/`

`.omp/` has no `package.json` of its own. The two tools the harness needs
beyond `node` come from `frontend/node_modules`, which `make install` already
populates:

- **`typescript`** — `check-omp-types` runs `frontend/node_modules/typescript/bin/tsc`
  over `.omp/tsconfig.json` (`make check-omp-types`).
- **`@ast-grep/cli`** — `lib/ast-rules.ts` runs the `.omp/ast-grep/rules/`
  configs with `frontend/node_modules/.bin/ast-grep`, falling back to `$PATH`.
  A missing binary is reported as "the rules did not run", never as a pass.

A new harness dependency is added to `frontend/package.json` dev dependencies,
not to a second package under `.omp/`.

## Execution

- Every `check-*` target in the root `Makefile` runs `node .omp/hooks/...` —
  never an interpreter, virtualenv or shell wrapper. A check that needs
  `.venv/bin/python` cannot run before `make install`.
- A check is read-only: it answers a question about the workspace. Anything
  that mutates state or calls the network is not a post hook.
- Register the target in the root `Makefile` and `root-makefile.md` —
  `check-makefiles` enforces that every backticked `make` target resolves.

## Hooks vs Extensions

Both are TypeScript, both load through the same extension runner, and the split
is by *what the code needs*:

- **`.omp/hooks/`** — a check or a block tied to one tool call. It answers a
  question about the workspace, and `make check-<name>` must be able to run the
  same logic from the CLI.
- **`.omp/extensions/`** — behaviour that needs the *session*: lifecycle events
  (`session_start`, `session_stop`, compaction), persisted session state
  (`appendEntry`), a registered tool or command, or UI status. This is the
  native auto-discovery root (`<cwd>/.omp/extensions/`), so an extension is
  **loaded automatically and applies without anyone invoking it**.

An extension may be disabled by name without deleting it:
`disabledExtensions: ["extension-module:<dir or file stem>"]`. Hook-capability
modules under `.omp/hooks/` do not honour that key, so anything that must be
switchable belongs here.

## Unattended Verification

An extension that runs a command at settle time has no approval gate in front of
it. Such a command is therefore restricted to an allowlist — `make …`,
`node .omp/hooks/…`, `git status --porcelain`, `git diff --stat` — and anything
else is **reported as rejected, never run**. A verification is a question about
the workspace; if a predicate needs to change the workspace, it is not a
predicate.

## Never Do These

- Write a Python script for a check, a migration helper, a runner or a fixture
  generator outside `backend/app|tests|alembic`
- Add a second shell script, or hide logic in a Makefile recipe instead of a hook
- Put a `.js`/`.mjs` file under `.omp/hooks/` or `.omp/extensions/`
- Add a `package.json` under `.omp/` — harness dependencies live in `frontend/`
- Let an extension run an unallowlisted command without an approval gate
- Create a root `scripts/`, `tools/`, `bin/` or `utils/` directory
- Run a check through an interpreter or virtualenv instead of `node`
- Keep verification code outside the repository (temp dir, home directory)
- Wire a state-mutating or network-calling runner to a post hook
