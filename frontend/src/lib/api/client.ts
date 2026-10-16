/**
 * The single HTTP client. Every request in the app goes through it.
 *
 * Every failure becomes an `ApiError` here and nowhere else. A screen that
 * builds its own `axios.create()` (or calls `fetch`) skips that mapping, so
 * `check-frontend-api-layer` forbids it.
 *
 * `api.send` is the one verb that is not an admin call: the endpoint test panel
 * fires an arbitrary request at a mock URL and wants the answer as the wire
 * gave it — any status, raw text, every header — so it bypasses the JSON
 * unwrap and the error mapping on purpose, but still lives in this file.
 */

import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { API_BASE_URL, API_TIMEOUT_MS, MOCK_ORIGIN } from '@/config'
import type { RawRequest, RawResponse } from '@/types/api'
import { ApiError, NETWORK_ERROR_CODE, toApiError } from '@/lib/api/errors'

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: API_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
  // A multi-select filter is one parameter repeated (`a=1&a=2`), which is what
  // FastAPI reads into a list. Axios's default is `a[]=1`, a name no router
  // declares - the filter would be ignored, not refused.
  paramsSerializer: { indexes: null },
})

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(toApiError(error)),
)

/**
 * The mock server is called without the admin client's defaults: no JSON
 * content type forced on the body, no base path, and no status treated as a
 * failure — a 404 `mock_not_matched` is a result the tester wants to read.
 */
const mockClient = axios.create({
  baseURL: MOCK_ORIGIN,
  timeout: API_TIMEOUT_MS,
  validateStatus: () => true,
  // Raw text both ways: the body is shown exactly as typed and as answered.
  transformRequest: [(data: unknown) => data],
  transformResponse: [(data: unknown) => data],
  responseType: 'text',
})

/**
 * Typed verb helpers. They exist so a service reads as one line per endpoint and
 * never repeats `.then((res) => res.data)` — the unwrap is the contract, not a
 * detail each service re-decides.
 */
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.get<T>(url, config).then((res) => res.data),

  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.post<T>(url, data, config).then((res) => res.data),

  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.put<T>(url, data, config).then((res) => res.data),

  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.patch<T>(url, data, config).then((res) => res.data),

  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.delete<T>(url, config).then((res) => res.data),

  /** The absolute URL a mock path is answered at — what a reader copies into `curl`. */
  mockUrl: (path: string) => mockClient.getUri({ url: path }),

  /**
   * One request at the mock origin, answered with status, headers, raw body
   * and the round trip in milliseconds. Only a request that never got an
   * answer throws — as `network_error`, the code every screen already words.
   */
  send: async ({ method, url, headers, body }: RawRequest): Promise<RawResponse> => {
    const started = performance.now()
    try {
      const response = await mockClient.request<string>({
        method,
        url,
        headers,
        data: body === '' ? undefined : body,
      })
      const answered: Record<string, string> = {}
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined && value !== null) answered[name.toLowerCase()] = String(value)
      }
      return {
        status: response.status,
        headers: answered,
        body: typeof response.data === 'string' ? response.data : '',
        ms: Math.round(performance.now() - started),
      }
    } catch (error) {
      throw new ApiError(0, NETWORK_ERROR_CODE, error instanceof Error ? error.message : String(error), null)
    }
  },
}
