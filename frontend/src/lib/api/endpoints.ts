/**
 * Every backend path, in one place.
 *
 * A URL literal inside a service or a screen is a path that no longer matches
 * the router when the backend moves it. Endpoints and logs are children of a
 * project, so their paths take the project id first — the backend answers 404
 * for a child asked for under another project.
 */

/** The mock router's prefix (`MOCK_PREFIX` in `app/core/settings.py`). */
const MOCK_PREFIX = '/mock'

export const PROJECT_ENDPOINTS = {
  LIST: '/project/',
  CREATE: '/project/',
  DETAIL: (id: string) => `/project/${id}`,
  UPDATE: (id: string) => `/project/${id}`,
  DELETE: (id: string) => `/project/${id}`,
} as const

export const ENDPOINT_ENDPOINTS = {
  LIST: (projectId: string) => `/project/${projectId}/endpoints`,
  CREATE: (projectId: string) => `/project/${projectId}/endpoints`,
  DETAIL: (projectId: string, id: string) => `/project/${projectId}/endpoints/${id}`,
  UPDATE: (projectId: string, id: string) => `/project/${projectId}/endpoints/${id}`,
  DELETE: (projectId: string, id: string) => `/project/${projectId}/endpoints/${id}`,
} as const

export const LOG_ENDPOINTS = {
  LIST: (projectId: string) => `/project/${projectId}/logs`,
  DETAIL: (projectId: string, id: string) => `/project/${projectId}/logs/${id}`,
  CLEAR: (projectId: string) => `/project/${projectId}/logs`,
} as const

/**
 * The mock router sits outside `/api/v1`, so these are absolute paths on the
 * mock origin rather than suffixes of `API_BASE_URL`.
 */
export const MOCK_ENDPOINTS = {
  BASE: (slug: string) => `${MOCK_PREFIX}/${slug}`,
  SEND: (slug: string, path: string) => `${MOCK_PREFIX}/${slug}${path.startsWith('/') ? path : `/${path}`}`,
} as const
