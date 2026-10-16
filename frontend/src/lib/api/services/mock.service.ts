/**
 * Mock service — the one verb that calls a mocked URL instead of the admin API.
 *
 * Not a resource: it sends one request as the endpoint test panel composed it
 * and hands back whatever the mock server answered, any status included.
 */

import { api } from '@/lib/api/client'
import { MOCK_ENDPOINTS } from '@/lib/api/endpoints'
import type { RawResponse } from '@/types/api'

export interface MockSendInput {
  slug: string
  method: string
  /** The path under the project's slug, as typed: `/users/1?page=2`. */
  path: string
  headers: Record<string, string>
  body: string
}

export const mockService = {
  send: ({ slug, method, path, headers, body }: MockSendInput): Promise<RawResponse> =>
    api.send({ method, url: MOCK_ENDPOINTS.SEND(slug, path), headers, body }),

  /** Where a project's endpoints answer: its slug under the mock origin. */
  baseUrl: (slug: string) => api.mockUrl(MOCK_ENDPOINTS.BASE(slug)),
}
