/**
 * Endpoint service — one function per backend endpoint, no more.
 *
 * Every path is under the project, so every verb takes the project id first.
 */

import { api } from '@/lib/api/client'
import { ENDPOINT_ENDPOINTS } from '@/lib/api/endpoints'
import type { OkResponse, Page } from '@/types/api'
import type {
  Endpoint,
  EndpointCreateRequest,
  EndpointListParams,
  EndpointUpdateRequest,
} from '@/types/endpoint'

export const endpointService = {
  list: ({ projectId, ...params }: EndpointListParams, signal?: AbortSignal) =>
    api.get<Page<Endpoint>>(ENDPOINT_ENDPOINTS.LIST(projectId), { params, signal }),

  detail: (projectId: string, id: string) =>
    api.get<Endpoint>(ENDPOINT_ENDPOINTS.DETAIL(projectId, id)),

  create: (projectId: string, data: EndpointCreateRequest) =>
    api.post<Endpoint>(ENDPOINT_ENDPOINTS.CREATE(projectId), data),

  update: (projectId: string, id: string, data: EndpointUpdateRequest) =>
    api.patch<Endpoint>(ENDPOINT_ENDPOINTS.UPDATE(projectId, id), data),

  remove: (projectId: string, id: string) =>
    api.delete<OkResponse>(ENDPOINT_ENDPOINTS.DELETE(projectId, id)),
}
