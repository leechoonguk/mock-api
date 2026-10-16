---
description: Frontend API layer — one axios client, services, query keys, cache policy, invalidation
globs:
      - frontend/src/lib/api/**/*.ts
      - frontend/src/types/api.ts
alwaysApply: false
---

# Frontend API Layer

Three responsibilities, three layers, and nothing shared between them: the
client owns the transport, a service owns one endpoint each, a hook owns the
cache. A screen that reaches past any of them loses what that layer guarantees.

Machine-checked by `check-frontend-api-layer.ts`
(`make check-frontend-api-layer`) plus `ast-grep/rules/frontend-api/`.

## One Client

`lib/api/client.ts` is the only file that may build a client or call the
platform. It is the only place that:

- sets the base URL (`API_BASE_URL`) and the timeout
- serialises a repeated parameter as `a=1&a=2`, the shape FastAPI reads
- converts every failure into `ApiError` (`detail` / `code` / `request_id`)

A second `axios.create` or a raw `fetch` skips all three, and the failure is
invisible: the request still works, the error mapping does not.

## An Identity Lookup Serves Its Own Answer

`placeholderData: (previous) => previous` belongs to a **list**: the table keeps
its rows while the next page loads. It does not belong to a read that answers
*which row is this* - a detail (`…Keys.detail(id)` with no window) - because
the previous answer is a different row, and whatever the screen does with the
id it now does to the wrong one: a log detail opened on the previous entry
while the next one loads. Such a read is `enabled`-gated too, so nothing is
fetched while nothing is open and nothing is left behind for the next key to
inherit.

## The One Verb That Is Not an Admin Call

**The endpoint test panel goes through `api.send`, still inside
`lib/api/client.ts`.** It fires an arbitrary request at a mock URL and wants the
answer as the wire gave it, so it uses a second client built in the same file:

- `baseURL: MOCK_ORIGIN` — the mock router is unversioned (`/mock/{slug}/...`),
  not under `API_BASE_URL`
- `validateStatus: () => true` — every status is a result; a 404
  `mock_not_matched` is what the tester wants to read, not an exception
- `transformRequest` / `transformResponse` identity and `responseType: 'text'` —
  the body is shown exactly as typed and as answered, never JSON-parsed

It returns status, headers, raw text and the round trip in milliseconds. Only a
request that never got an answer throws, as `ApiError` with the internal code
`network_error` (no locale key; the screen reads `errors.unknown`).
That is why the ban is on a second client in a screen, not on two clients in
`client.ts`.

`api.send` has no cache: the `mock` service is an action, reached through a
mutation, and the request log it produces is read through `useLogList`.

## Services

```ts
export const projectService = {
  list: (params: ProjectListParams, signal?: AbortSignal) =>
    api.get<Page<Project>>(PROJECT_ENDPOINTS.LIST, { params, signal }),
  remove: (id: string) => api.delete<OkResponse>(PROJECT_ENDPOINTS.DELETE(id)),
}
```

- One function per endpoint, named for the verb, not the screen.
- No `useQuery` / `useMutation` — a service that caches cannot be reused.
- No URL literal: the path comes from `endpoints.ts`. Two files are exempt and
  the check knows it — `routes/paths.ts` holds **browser** routes (owned by
  `frontend-routing.md`), and `client.ts` owns the transport.

## Hooks

| Concern | Rule |
|---|---|
| Key | from the `*Keys` factory — never a `queryKey: [...]` literal |
| Staleness | `staleTime: QUERY_STALE_TIME.<NAME>` — a bare number says how long, never why |
| Paging | a `use*List` hook declares `placeholderData: (previous) => previous` |
| Invalidation | `useCreate*` / `useUpdate*` / `useDelete*` invalidate the list key |

`placeholderData` is load-bearing, not a nicety: without it `data` is
`undefined` during a fetch, so the grid loses its rows and its `rowCount` on
every page change and the footer blinks between "1–10 of 240" and nothing.

### A scope nothing invalidates is `REALTIME`

`invalidateQueries` is this application's only cache-refresh path. So if no
mutation names a scope, a non-zero `staleTime` is a window in which the screen
cannot show the truth and nothing on it can ask again. The request log is the
case: the mock router writes those rows outside the admin API, so `logKeys`
is `QUERY_STALE_TIME.REALTIME`, and `useLogList` also sets a `refetchInterval`
so a request fired from another client appears while the Logs tab is open.

One-way. A scope that *is* invalidated may still choose `REALTIME` — a judgement
the check does not make.

**A child collection gets its own scope**, never a discriminator folded into the
parent's list key. Invalidation matches by prefix, so a project's endpoints
keyed as `projectKeys.list({scope: 'endpoints'})` would sit under
`projectKeys.lists()` and every project rename would mark them invalid — a
containment the key claimed and the data does not have. `endpointKeys` and
`logKeys` are their own factories; the split is also what makes the rule above
computable at all.

**Every declared scope is read by a query.** A scope with no reader is a screen
that was never built, or a key waiting to be copied onto the wrong collection.

### An action verb invalidates nothing it does not change

Not machine-checked — whether a mutation *should* invalidate is domain
knowledge. Sending a test request through `api.send` changes no admin row the
screen draws except the log, and the log refreshes itself (`REALTIME` +
`refetchInterval`); refetching the endpoint list would flicker for a state it
does not draw.

## Pagination Reality

The backend paginates with `offset`/`limit` and answers `Page<T>` — `items` plus
the collection's `total`. The project list also takes `name`, `sort`
(`name`|`slug`|`created_at`) and `order` (`app/dependencies/query.py`). So:

- `useDataGridState` requests exactly `pageSize` rows and `rowCount` is the
  total the response carried.
- a search box or a sortable column exists only where the API has the
  parameter. A control the API cannot honour is a lie in the UI.

## A Superseded Read Is Cancelled

Every `list*` service takes `signal?: AbortSignal` into its request config, and
its `use…List` hook hands over React Query's own
(`queryFn: ({ signal }) => service.list(params, signal)`): typing in the name
filter would otherwise leave one list read in flight per keystroke; with the
signal, a new key aborts the old request. Machine-checked by `checkServices`
and `checkQueryHooks`.

## A Refusal Is Not Retried

The query client's `retry` is a function that answers `false` for 400-499: a
4xx is the request's own fault and asking again answers the same (a duplicate
slug's 409 retried is the same 409, later). Machine-checked by
`checkRefusalsAreNotRetried` (`Providers.tsx`).

## A Surface Is One Request, Not One Per Row

A collection a surface needs across rows is one endpoint, read by one query
(the project list carries `endpoint_count` rather than one endpoint-list read
per row). `useQueries` over a list asks once per row on every mount. Refused
by `checkNoPerRowFanOut`; a fan-out that truly cannot be one request says why
on its line or the two above (`// fan-out-ok: <reason>`).

## Review Judgement (not machine-checked)

- Whether a `staleTime` constant is the *right* one for the data. The check sees
  that a named constant was used, never that `LONG` suits a collection someone
  edits hourly.
- Whether a mutation should also invalidate a **sibling** domain's key. Only the
  domain's own list key is required, because that is the one the check can
  derive; a cross-domain effect is a decision.
- Whether a service function belongs at all — a service with one caller and a
  screen-shaped name is a screen leaking into the transport layer.

## Never Do These

- Call `axios.create` or `fetch` outside `lib/api/client.ts`
- Import `axios` outside the client and its error mapper
- Write a backend path literal outside `endpoints.ts`
- Put `useQuery` in a service, or `apiClient` in a hook
- Import a service from a screen — go through the hooks layer
- Write a mutation that changes a collection without invalidating its list key
- Read a list or a facets vocabulary without the query's `AbortSignal`
- Retry a 4xx
- Fan a request out per row with `useQueries` — ask the backend for the
  collection
