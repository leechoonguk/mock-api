/**
 * Shared API types — the wire contract every domain type builds on.
 *
 * The shapes here mirror the backend exactly: `AuditedResource` is
 * `AuditMixin` (backend/app/models/base.py), and `ApiErrorBody` is the single
 * error body every handler in `app/core/exceptions.py` returns.
 */

/** Every failure body the backend produces: `detail`, `code`, `request_id`. */
export interface ApiErrorBody {
  detail: string
  code: string
  request_id: string | null
  /** Only on a 409 `host_taken`: the host another project already intercepts. */
  host?: string
}

/**
 * Columns every audited row carries. `version` is the optimistic-lock counter —
 * a stale write answers 409 `stale_version`, which the UI reports as "reload".
 * There is no sign-in, so no actor columns.
 */
export interface AuditedResource {
  id: string
  created_at: string
  updated_at: string
  version: number
}

/**
 * One page of a collection — the shape every list endpoint answers with
 * (`backend/app/core/page.py`).
 *
 * `total` is the count under the same filter as `items`, without the window, so
 * a footer can say "1–20 of 240" on the first page instead of discovering the
 * number on the last.
 */
export interface Page<T> {
  items: T[]
  total: number
}

export interface OffsetLimitParams {
  offset: number
  limit: number
}

/**
 * The page plus the one sorted column: `sort` is a column the router's
 * `<Domain>SortQuery` Literal closes, `order` the `OrderQuery` pair. Both
 * omitted on an unsorted grid, so the endpoint pages by its own order.
 */
export interface PageParams extends OffsetLimitParams {
  sort?: string
  order?: 'asc' | 'desc'
}

/**
 * A list's field filters, one interface per domain, kept apart from
 * `OffsetLimitParams` on purpose.
 *
 * One optional field per filterable column, named exactly as the query
 * parameter (`TextFilterQuery` in `app/dependencies/query.py`) — so a reader
 * sees which column each box narrows instead of guessing what a combined
 * keyword covers.
 *
 * Every field is omitted rather than sent empty — the backend declares
 * `min_length=1`, so `field=` is a 422, not "no filter".
 */
export interface ProjectFilterParams {
  name?: string
}

/** `DELETE` endpoints answer `{"ok": true}` rather than 204. */
export interface OkResponse {
  ok: boolean
}
