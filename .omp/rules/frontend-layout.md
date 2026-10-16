---
description: Frontend directory charter — what each src/ directory holds, what it may import, how its files are named; declared in lib/frontend-source.ts
globs:
      - frontend/src/**/*.ts
      - frontend/src/**/*.tsx
      - .omp/hooks/lib/frontend-source.ts
      - .omp/hooks/lib/frontend-layout.ts
      - .omp/hooks/post/check-frontend-layout.ts
      - .omp/hooks/pre/strict-frontend-app-structure.ts
alwaysApply: false
---

# Frontend Layout

Every entry directly under `frontend/src/` has a charter on three axes: what
it **holds**, what it may **import**, and how its **files** are named. The
declaration is one value, `SRC_LAYOUT` in `.omp/hooks/lib/frontend-source.ts`;
this table is its prose, and `check-frontend-layout` holds the two row for row.

## Directories

| Entry | Holds | Imports | Files |
|---|---|---|---|
| `src/types/` | Wire types mirroring the backend schemas, one file per domain and `api.ts` | — | `^[a-z]+\.ts$` |
| `src/utils/` | Pure helpers — no React, no API | — | `^[a-z][A-Za-z]*\.ts$` |
| `src/locales/` | i18n setup and one dictionary per language | — | — |
| `src/routes/` | The path registry | — | `^paths\.ts$` |
| `src/theme/` | The one MUI theme | `config` | — |
| `src/lib/` | The API layer: one client, endpoints, query keys, services, query hooks | `config`, `types` | — |
| `src/hooks/` | React hooks that belong to no one component family | `config`, `lib`, `locales`, `types`, `utils` | `^use[A-Z][A-Za-z]*\.ts$` |
| `src/components/` | Reusable UI, one folder per family; a family may use another, never in a cycle | `config`, `hooks`, `lib`, `locales`, `theme`, `types`, `utils` | — |
| `src/layouts/` | The dashboard shell | `components`, `config`, `hooks`, `lib`, `locales`, `routes`, `theme`, `types`, `utils` | — |
| `src/sections/` | One folder per domain's screens; a domain never imports another's | `components`, `config`, `hooks`, `lib`, `locales`, `routes`, `theme`, `types`, `utils` | — |
| `src/pages/` | Route components, one per screen | `components`, `config`, `hooks`, `locales`, `routes`, `sections`, `types` | `^[A-Z][A-Za-z]*Page\.tsx$` |
| `src/App.tsx` | The route table | `*` | — |
| `src/main.tsx` | The entry | `*` | — |
| `src/Providers.tsx` | The provider stack the entry mounts | `*` | — |
| `src/config.ts` | API base, mock origin, timeouts, page sizes | — | — |
| `src/styles.css` | The document reset | — | — |
| `src/vite-env.d.ts` | Vite's client types | — | — |

## Reading The Imports

- An entry always imports itself. Its subfolders follow its `peers` policy:
  `components/` families may use one another but never in a cycle
  (`components/data-grid → components/detail → components/data-grid` is a
  finding); a `sections/` domain and a `layouts/` shell never import another's
  folder.
- Every other `@/` import — static, type-only, dynamic (`import('@/…')`) and
  side-effect — must name a top-level entry the Imports cell lists. `*` is the
  assembly: the route table, the entry and the provider stack import anything.
- `components/` may use `lib/`: a family that shows server data reads it
  through the query hooks, never through its own request.
- The project's child screens (endpoints, request logs) live under
  `sections/project/detail/`, inside the one domain folder that owns them.

A new edge is decided by what the two entries hold. When the target is
something the source's Holds sentence needs, add it to `SRC_LAYOUT` and this
table together; otherwise move the shared piece to the entry both may read.

## Enforcement

| Hook | Fires when |
|---|---|
| `strict-frontend-app-structure` (write) | a new top-level directory or src-root file is written, or a file directly in a directory with a Files pattern is named against it (`pages/Foo.tsx`, `hooks/toast.ts`) |
| `check-frontend-layout` (`lib/frontend-layout.ts`) | a `src/` entry has no charter; a file is not named for its directory; an `@/` import leaves its charter; component families form a cycle; this table's rows, Imports or Files disagree with `SRC_LAYOUT`; a planted self-test case judges wrong |
