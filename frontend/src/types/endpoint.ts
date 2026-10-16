/**
 * Endpoint domain types — mirror of `backend/app/schemas/endpoint.py`.
 *
 * An endpoint is one canned answer: a method and a path pattern under its
 * project's slug, and the status, headers and body template the mock server
 * replies with.
 */

import type { AuditedResource, OffsetLimitParams } from '@/types/api'

/** `METHODS` in `app/engine/matcher.py` and `ck_endpoint_method`, verbatim. */
export const MOCK_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'ANY'] as const

export type MockMethod = (typeof MOCK_METHODS)[number]

export interface Endpoint extends AuditedResource {
  project_id: string
  method: MockMethod
  /** A pattern: a `{name}` segment matches any one segment. */
  path: string
  status_code: number
  headers: Record<string, string>
  /** A template: `{{path.id}}`-style tokens are filled per request. */
  body: string
  delay_ms: number
  enabled: boolean
  description: string
}

export interface EndpointCreateRequest {
  method: MockMethod
  path: string
  status_code?: number
  headers?: Record<string, string>
  body?: string
  delay_ms?: number
  enabled?: boolean
  description?: string
}

export interface EndpointUpdateRequest {
  method?: MockMethod | null
  path?: string | null
  status_code?: number | null
  headers?: Record<string, string> | null
  body?: string | null
  delay_ms?: number | null
  enabled?: boolean | null
  description?: string | null
}

/** What `GET /project/{id}/endpoints` accepts, with the project it is under. */
export interface EndpointListParams extends OffsetLimitParams {
  projectId: string
}
