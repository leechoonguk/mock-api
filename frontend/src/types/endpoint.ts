/**
 * Endpoint domain types — mirror of `backend/app/schemas/endpoint.py`.
 *
 * An endpoint is one canned answer: a method, a host and a path pattern, and
 * the status, headers and body template the mock answers an intercepted
 * request with.
 */

import type { AuditedResource, OffsetLimitParams } from '@/types/api'

/** `METHODS` in `app/engine/matcher.py` and `ck_endpoint_method`, verbatim. */
export const MOCK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY'] as const

export type MockMethod = (typeof MOCK_METHODS)[number]

export interface Endpoint extends AuditedResource {
  project_id: string
  method: MockMethod
  /** The one host it answers on; `""` answers on every host of the project. */
  host: string
  /** A pattern: a `{name}` segment matches any one segment. */
  path: string
  status_code: number
  headers: Record<string, string>
  /** A template: `{{path.id}}`-style tokens are filled per request. */
  body: string
  delay_ms: number
  enabled: boolean
  description: string
  /** The exact query a request must carry (canonical sorted pairs); `null` answers any query. */
  match_query: string | null
  /** The exact body a request must carry (JSON by value); `null` answers any body. */
  match_body: string | null
  /** A stored file (sha256) answered verbatim instead of `body`, which is then `""`; `null` answers `body`. */
  body_ref: string | null
}

export interface EndpointCreateRequest {
  method: MockMethod
  host?: string
  path: string
  status_code?: number
  headers?: Record<string, string>
  body?: string
  delay_ms?: number
  enabled?: boolean
  description?: string
  match_query?: string | null
  match_body?: string | null
  /** A stored file's sha256; set only by saving from logs. */
  body_ref?: string | null
}

export interface EndpointUpdateRequest {
  method?: MockMethod | null
  /** `""` answers on every host again; omitted or `null` leaves it. */
  host?: string | null
  path?: string | null
  status_code?: number | null
  headers?: Record<string, string> | null
  body?: string | null
  delay_ms?: number | null
  enabled?: boolean | null
  description?: string | null
  /** Unlike the other fields, `null` clears the condition; omit it to leave it. */
  match_query?: string | null
  match_body?: string | null
  /** Only `null` is taken: the endpoint answers its typed `body` again. Omit it to leave it. */
  body_ref?: null
}

/** Saves a recorded request's real-server answer as an endpoint. */
export interface EndpointRecordRequest {
  /** Replaces the logged path; omitted or `null` keeps it. */
  path?: string | null
}

/** Saves several logged exchanges, each at its logged path, query and body. */
export interface EndpointRecordManyRequest {
  request_log_ids: string[]
}

/** `RecordSkipReason`: gone, not savable, a repeat of another selected request, or a route already held. */
export type RecordSkipReason = 'not_found' | 'not_recordable' | 'duplicate' | 'conflict'

export interface RecordSkip {
  request_log_id: string
  reason: RecordSkipReason
}

export interface EndpointRecordManyResponse {
  created: Endpoint[]
  skipped: RecordSkip[]
}

/** `RECORD_MANY_MAX`: how many logs one bulk save takes. */
export const RECORD_MANY_MAX = 100

/** What `GET /project/{id}/endpoints` accepts, with the project it is under. */
export interface EndpointListParams extends OffsetLimitParams {
  projectId: string
}
