/**
 * Mock service — the forward proxy that serves the mocks.
 *
 * Not a resource: the proxy is one process beside the API, read for where a
 * client points at it and whether its CA certificate can be downloaded yet.
 */

import { api } from '@/lib/api/client'
import { PROXY_ENDPOINTS } from '@/lib/api/endpoints'
import type { ProxyStatus } from '@/types/proxy'

export const mockService = {
  status: () => api.get<ProxyStatus>(PROXY_ENDPOINTS.STATUS),

  /** The CA certificate download — a link the browser follows, not a read of this app. */
  caUrl: () => api.url(PROXY_ENDPOINTS.CA),
}
