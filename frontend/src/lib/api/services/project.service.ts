/**
 * Project service — one function per backend endpoint, no more.
 */

import { api } from '@/lib/api/client'
import { PROJECT_ENDPOINTS } from '@/lib/api/endpoints'
import type { OkResponse, Page } from '@/types/api'
import type {
  Project,
  ProjectCreateRequest,
  ProjectListParams,
  ProjectUpdateRequest,
} from '@/types/project'

export const projectService = {
  list: (params: ProjectListParams, signal?: AbortSignal) =>
    api.get<Page<Project>>(PROJECT_ENDPOINTS.LIST, { params, signal }),

  detail: (id: string) => api.get<Project>(PROJECT_ENDPOINTS.DETAIL(id)),

  create: (data: ProjectCreateRequest) => api.post<Project>(PROJECT_ENDPOINTS.CREATE, data),

  update: (id: string, data: ProjectUpdateRequest) =>
    api.patch<Project>(PROJECT_ENDPOINTS.UPDATE(id), data),

  remove: (id: string) => api.delete<OkResponse>(PROJECT_ENDPOINTS.DELETE(id)),
}
