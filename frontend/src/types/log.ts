/**
 * Request log types — mirror of `backend/app/schemas/request_log.py`.
 *
 * One row per call the mock server answered for a known project, matched or
 * not. The list row leaves out the request's headers and body; the detail
 * carries them.
 */

import type { AuditedResource, OffsetLimitParams } from '@/types/api'

export interface RequestLog extends AuditedResource {
  project_id: string
  /** The endpoint that answered; `null` when nothing matched or it was deleted since. */
  endpoint_id: string | null
  method: string
  path: string
  query_string: string
  response_status: number
  matched: boolean
  /** Includes the endpoint's configured delay. */
  duration_ms: number
}

export interface RequestLogDetail extends RequestLog {
  request_headers: Record<string, string>
  /** Cut at the server's log body limit. */
  request_body: string
}

/** What `GET /project/{id}/logs` accepts, with the project it is under. */
export interface LogListParams extends OffsetLimitParams {
  projectId: string
}
