/**
 * Project domain types — mirror of `backend/app/schemas/project.py`.
 *
 * A project is the namespace of a set of mocked endpoints: its `slug` is the
 * first segment of every mocked URL under the mock prefix, so it is chosen once at
 * creation and never edited.
 */

import type { AuditedResource, PageParams, ProjectFilterParams } from '@/types/api'

export interface Project extends AuditedResource {
  name: string
  slug: string
  description: string
  /** How many endpoints the project holds, counted by the server per row. */
  endpoint_count: number
}

export interface ProjectCreateRequest {
  name: string
  slug: string
  description?: string
}

/** The slug is absent on purpose: changing it would move every mocked URL. */
export interface ProjectUpdateRequest {
  name?: string | null
  description?: string | null
}

/** What `GET /project/` accepts: the page, its sort, and the name filter. */
export type ProjectListParams = PageParams & ProjectFilterParams
