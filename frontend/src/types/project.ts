/**
 * Project domain types — mirror of `backend/app/schemas/project.py`.
 *
 * A project is a set of mocked endpoints and the hosts it intercepts: a
 * request through the forward proxy to one of its `hosts` is answered by the
 * endpoints (`mock`) or forwarded to the real server and logged (`record`).
 */

import type { AuditedResource, PageParams, ProjectFilterParams } from '@/types/api'

/** `ProjectMode` in `app/models/project.py`. */
export const PROJECT_MODES = ['mock', 'record'] as const

export type ProjectMode = (typeof PROJECT_MODES)[number]

export interface Project extends AuditedResource {
  name: string
  description: string
  /** Host names (`api.example.com`) or `*.suffix` wildcards; normalized by the server. */
  hosts: string[]
  /** `mock`: endpoints answer, the rest is a 404. `record`: the real server answers and every exchange is logged. */
  mode: ProjectMode
  /**
   * Query parameter names and JSON keys (any depth) a client changes on every
   * call - a nonce, a counter, a timestamp. Left out of a recorded endpoint's
   * conditions and of both sides of a match.
   */
  ignored_fields: string[]
  /** How many endpoints the project holds, counted by the server per row. */
  endpoint_count: number
}

export interface ProjectCreateRequest {
  name: string
  description?: string
  hosts?: string[]
  mode?: ProjectMode
  ignored_fields?: string[]
}

export interface ProjectUpdateRequest {
  name?: string | null
  description?: string | null
  /** The whole list: `[]` intercepts nothing, `null` leaves it. */
  hosts?: string[] | null
  /** `null` leaves the mode as it is. */
  mode?: ProjectMode | null
  /** The whole list: `[]` ignores nothing, `null` leaves it. */
  ignored_fields?: string[] | null
}

/** What `GET /project/` accepts: the page, its sort, and the name filter. */
export type ProjectListParams = PageParams & ProjectFilterParams
