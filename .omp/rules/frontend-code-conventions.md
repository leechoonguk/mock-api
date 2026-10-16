---
description: Frontend code conventions — React, TypeScript, Vite, MUI, ESLint, file structure
globs:
      - frontend/package.json
      - frontend/vite.config.ts
      - frontend/tsconfig.json
      - frontend/src/**/*.tsx
      - frontend/src/**/*.ts
      - frontend/src/**/*.css
alwaysApply: false
---

# Frontend Code Conventions

Machine-checked by `check-frontend-code.ts` (`make check-frontend-code`) for the
structural half; the toolchain (`make verify` → lint, typecheck, build) owns the
rest.

## Structure Is Gated at Write Time

`frontend/src/` has a declared layout — `SRC_LAYOUT` in
`.omp/hooks/lib/frontend-source.ts`, the same module every frontend scan reads
its directories from; it declares each directory's imports and file names too. `strict-frontend-app-structure` refuses a new top-level
directory (`src/adapters/`) or a stray src-root file at write time, the way the
backend gate refuses `backend/app/adapters/`. The scans here are recursive, so
an undeclared directory would still be *seen* — the harm is quieter: every
convention keyed on directory role (sections are screens, `lib/api` is the
transport, pages are thin) simply fails to apply to a directory no rule names.
Extending the layout is editing that one declaration.

## Stack

| Concern | Choice |
|---|---|
| Framework | React 19, functional components only |
| Language | TypeScript 5.9, `strict`, `verbatimModuleSyntax`, `noUnusedLocals` |
| Build | Vite (dev server 47823, `/api`, `/mock`, `/health` proxied to `127.0.0.1:47821`) |
| UI | MUI 7 + Emotion, `@mui/x-data-grid` 8 |
| Server state | TanStack Query 5 |
| Forms | react-hook-form 7 + yup via `@hookform/resolvers` |
| HTTP | axios (one instance, `lib/api/client.ts`) |
| Routing | react-router 7 (`BrowserRouter`) |
| i18n | i18next + react-i18next (ko default, en) |
| Notifications | notistack, through `useToast` |
| Icons | `@iconify/react`, through `components/iconify` |

A package used in `src/` must be declared in `package.json`: the check cannot see
`node_modules`, only what the manifest claims.

## File Structure

What each directory holds and may import is rule://frontend-layout.

## Components

- One component per file, `export default function <Name>`, file named `<Name>.tsx`
- Props as a named `interface <Name>Props` (inline for one or two props)
- No `React.FC`, no class components
- Imports through the `@/` alias — a relative import breaks when the file moves
- `sx` for layout, the theme for appearance: a repeated `sx` is a theme default
  that has not been written yet
- Constants (widths, page sizes, cycles) after the imports, `UPPER_SNAKE_CASE`,
  never inline magic numbers in JSX

## Styling

- `styles.css` carries only the document reset; everything else is MUI
- No CSS modules, no Tailwind, no styled-components: two styling systems means
  two answers to "where does this colour come from"
- Colours and radii come from the theme, never a literal in a component

## Hosts and Ports

There is no image and no reverse proxy: the app is local only. In development
Vite's proxy (`vite.config.ts`) forwards `/api`, `/mock` and `/health` to the
backend at `127.0.0.1:47821` — the address, not `localhost`, because the
backend binds IPv4 only and `localhost` may resolve to `::1` first. Paths pass
through unchanged.

So `src/` never spells a port: `check-frontend-code` fails on a port literal
there. The only origin the code needs is `MOCK_ORIGIN` (`config.ts`), the base
of the mock URL the screen shows and the test panel calls:
`import.meta.env.VITE_MOCK_ORIGIN` when set (a copied `curl` that does not
depend on Vite running), otherwise `window.location.origin`, which the proxy
already serves.

## Review Judgement (not machine-checked)

- Whether a `sx` block should have become a theme default
- Whether a component with six props should have been two components
- Whether a copied screen should have diverged as much as it did

## Never Do These

- Use a class component
- Import with a relative path inside `src/`
- Hardcode a port or a host in `src/` — the Vite proxy and `MOCK_ORIGIN` own that
- Add an npm package without adding it to `package.json`
- Introduce a second styling system
- Name a file differently from the component it default-exports
