/**
 * Request log service — read and clear; the mock server is the only writer.
 *
 * `remove` clears the whole project's log: there is no per-row delete, because
 * a log with holes cut by hand no longer says what was called.
 */

import { api } from '@/lib/api/client'
import { LOG_ENDPOINTS } from '@/lib/api/endpoints'
import type { OkResponse, Page } from '@/types/api'
import type { LogListParams, RequestLog, RequestLogDetail } from '@/types/log'

export const logService = {
  list: ({ projectId, ...params }: LogListParams, signal?: AbortSignal) =>
    api.get<Page<RequestLog>>(LOG_ENDPOINTS.LIST(projectId), { params, signal }),

  detail: (projectId: string, id: string) =>
    api.get<RequestLogDetail>(LOG_ENDPOINTS.DETAIL(projectId, id)),

  remove: (projectId: string) => api.delete<OkResponse>(LOG_ENDPOINTS.CLEAR(projectId)),
}
