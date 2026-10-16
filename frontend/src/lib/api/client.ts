/**
 * The single HTTP client. Every request in the app goes through it.
 *
 * Every failure becomes an `ApiError` here and nowhere else. A screen that
 * builds its own `axios.create()` (or calls `fetch`) skips that mapping, so
 * `check-frontend-api-layer` forbids it.
 */

import axios from 'axios'
import type { AxiosRequestConfig } from 'axios'
import { API_BASE_URL, API_TIMEOUT_MS } from '@/config'
import { toApiError } from '@/lib/api/errors'

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

  /** The URL an admin path is served at — for a link the browser follows itself, like a download. */
  url: (path: string) => apiClient.getUri({ url: path }),
}
