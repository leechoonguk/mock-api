---
description: Frontend domain conventions — 6-layer screen pattern, types/service/hooks/section/page/route
globs:
      - frontend/src/types/*.ts
      - frontend/src/lib/api/**/*.ts
      - frontend/src/sections/**/*.tsx
      - frontend/src/pages/*.tsx
      - frontend/src/routes/paths.ts
alwaysApply: false
---

# Frontend Domain

A backend domain reaches the user through six files, always the same six. The
point is not ceremony: each layer is the only place one decision is made, so a
reader who knows one domain can review the next one by diffing it.

Machine-checked by `check-frontend-domain.ts` (`make check-frontend-domain`).

## Child Domains and Narrow Services

`check-frontend-domain` reads two tables from the hook itself:

| Table | Entry | Effect |
|---|---|---|
| `CHILD_DOMAINS` | `endpoint → project` | screen is `sections/project/detail/ProjectEndpointsTab.tsx`; no list, form dialog or page owed |
| `CHILD_DOMAINS` | `log → project` | screen is `sections/project/detail/ProjectLogsTab.tsx`; no list, form dialog or page owed |
| `DOMAIN_METHODS` | `log: list/detail/remove` | service owes `list`/`detail`/`remove` only; hooks owed are `useLogList`, `useLog`, `useDeleteLog` |

A child domain is reached only inside its parent's detail dialog (URL dialog +
tabs), so its screen is the tab `sections/<parent>/detail/<Parent><Domain>sTab.tsx`.
Types, hooks, `<DOMAIN>_ENDPOINTS` and `<domain>Keys` are still required.
The request log is append-only from the server side (the mock router writes it),
so the UI may read and clear it but never create or edit an entry. A stale
entry in either table fails as a missing tab or a missing method.

## The Six Layers

| Layer | File | Owns |
|---|---|---|
| Types | `types/<domain>.ts` | the wire shape, mirroring the Pydantic schema |
| Endpoints | `lib/api/endpoints.ts` | `<DOMAIN>_ENDPOINTS` — every URL of the domain |
| Keys | `lib/api/queryKeys.ts` | `<domain>Keys` from `createQueryKeys` |
| Service | `lib/api/services/<domain>.service.ts` | transport: `list`/`detail`/`create`/`update`/`remove` |
| Hooks | `lib/api/hooks/use<Domain>.ts` | caching + invalidation: `use<Domain>List`, `use<Domain>`, `useCreate<Domain>`, `useUpdate<Domain>`, `useDelete<Domain>` |
| Screen | `sections/<domain>/<Domain>List.tsx` + `<Domain>FormDialog.tsx`¹ | presentation and the dialogs |
| Route | `pages/<Domain>Page.tsx` + `PATHS.<domain>` | the URL and the page header |

¹ The form dialog is required **unless the record is a row**, and that is not a
matter of taste: `check-frontend-domain` compares every field of
`<Domain>CreateRequest` against the list's columns marked `editable: true`.

- All of them are editable columns (a record of a few scalars) →
  the list **must** create in the grid and have no dialog. A dialog there is a
  second surface asking for what the row already shows.
- One of them cannot be a cell (`project`'s multiline `description`) → the
  dialog **must** exist, and a list that
  carries a draft row anyway fails: the draft cannot hold that field.

Both directions are checked, so the answer moves the moment the create request or
the columns do.

A domain is discovered by its service file, because the service is the layer
nothing can skip. `mock` is exempt (`NON_RESOURCE_DOMAINS` in
`hooks/lib/frontend-source.ts`): its service is an action (`send`) for the
endpoint test panel, not a collection — no list, no CRUD dialog, no navigation entry.

## Adding a New Domain

1. `types/<domain>.ts` — one interface per request/response class of
   `backend/app/schemas/<domain>.py`; the read model extends `AuditedResource`
2. `lib/api/endpoints.ts` — add `<DOMAIN>_ENDPOINTS` with one entry per route
3. `lib/api/queryKeys.ts` — add `<domain>Keys = createQueryKeys('<plural>')`
4. `lib/api/services/<domain>.service.ts` — five functions, `api.*` only
5. `lib/api/hooks/use<Domain>.ts` — five hooks, keys from the factory
6. `sections/<domain>/` — the screen's **type is a property judgement** (list /
   form-dialog / read-only), made before choosing what to copy: copy the nearest
   screen of the *same type*, never the most familiar name, then change the
   columns, the fields and the strings
7. `pages/<Domain>Page.tsx`, `PATHS.<domain>`, a `NAV_ITEMS` entry
8. `frontend/src/locales/ko.ts` + `en.ts` — a namespace for the domain — **both** locales:
   `check-frontend-i18n` fails on a key present in one language only.
9. Verify as you go, finish end to end: `make -C frontend verify` after the wiring,
   then the root `make verify`.

## Layering

- A **screen** imports hooks, never a service and never `endpoints.ts`.
- A **hook** imports its service and the key factory, never `apiClient`.
- A **service** imports `api` from `lib/api/client` and its endpoints, nothing else.
- A **page** imports one section and `PageHeader`, and fetches nothing.

## Review Judgement (not machine-checked)

- Whether a domain deserves to be one. The check counts layers; it cannot say
  that two "domains" are one concept split by an API accident.
- Whether a section's components have divided sensibly. `<Domain>List.tsx` is
  required and `<Domain>FormDialog.tsx` is unless the grid creates rows; a
  600-line list is still a pass.
- Whether the screen shows the *useful* columns of the read model.

## Never Do These

- Ship a service with no hook — the screen will call it directly and lose caching
- Ship a section with no service — it reaches the API some other way
- Put a domain's URL in its service instead of `endpoints.ts`
- Spell a query key inline instead of taking it from the factory
- Give one domain two list screens with different shapes
