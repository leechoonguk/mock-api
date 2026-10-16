/**
 * Request log types — mirror of `backend/app/schemas/request_log.py`.
 *
 * One row per request the forward proxy intercepted for a project, matched or
 * not. The list row leaves out the request's headers and body; the detail
 * carries them.
 */

import type { AuditedResource, OffsetLimitParams } from '@/types/api'

export interface RequestLog extends AuditedResource {
  project_id: string
  /** The endpoint that answered; `null` when nothing matched or it was deleted since. */
  endpoint_id: string | null
  method: string
  /** `http` or `https`. */
  scheme: string
  host: string
  path: string
  query_string: string
  response_status: number
  matched: boolean
  /** Answered by the real server (record mode): `matched` is false and the status is the server's. */
  proxied: boolean
  /** The exchange can be saved as an endpoint. */
  recordable: boolean
  /** Bytes of the real server's answer (record mode); `null` for every other request. */
  response_size: number | null
  /** Includes the endpoint's configured delay. */
  duration_ms: number
}

export interface RequestLogDetail extends RequestLog {
  request_headers: Record<string, string>
  /** Cut at the server's log body limit. */
  request_body: string
  /** The real server's answer in record mode; `null` for every other request. */
  response_headers: Record<string, string> | null
  /** Cut at the server's log body limit. */
  response_body: string | null
  /**
   * Set when the answer was binary or over the log body limit and was stored
   * whole as a file; `response_body` is then only a cut, decoded preview.
   */
  response_body_ref: string | null
}

/** A field whose value changed between calls to one route (method, host and path) in the log. */
export interface VolatileField {
  name: string
  /** On how many routes its value changed. */
  routes: number
}

/** `GET /project/{id}/logs/volatile-fields`: most widespread first, ignored names left out. */
export interface VolatileFieldsResponse {
  fields: VolatileField[]
}

/** `REQUEST_METHODS` the proxy logs: every method but the endpoint-only `ANY`. */
export const LOG_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** `StatusClass`: a status's hundreds digit, so `2` is every 2xx. */
export const STATUS_CLASSES = ['2', '3', '4', '5', '1'] as const

export type StatusClass = (typeof STATUS_CLASSES)[number]

/** `LogOutcome`: who answered - an endpoint, the real server, or nobody. */
export const LOG_OUTCOMES = ['matched', 'proxied', 'unmatched'] as const

export type LogOutcome = (typeof LOG_OUTCOMES)[number]

/** `RequestLogFilter`: each list any-of (the parameter repeated), `host` and `path` contains. */
export interface LogFilterParams {
  method?: readonly string[]
  status_class?: readonly string[]
  outcome?: readonly string[]
  host?: string
  path?: string
}

/** What `GET /project/{id}/logs` accepts, with the project it is under. */
export interface LogListParams extends OffsetLimitParams, LogFilterParams {
  projectId: string
}
