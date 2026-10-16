/**
 * Every backend path, in one place.
 *
 * A URL literal inside a service or a screen is a path that no longer matches
 * the router when the backend moves it. Endpoints and logs are children of a
 * project, so their paths take the project id first — the backend answers 404
 * for a child asked for under another project.
 */

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
  BODY: (projectId: string, id: string) => `/project/${projectId}/endpoints/${id}/body`,
  RECORD: (projectId: string, logId: string) => `/project/${projectId}/logs/${logId}/endpoint`,
  RECORD_MANY: (projectId: string) => `/project/${projectId}/logs/endpoints`,
  UPDATE: (projectId: string, id: string) => `/project/${projectId}/endpoints/${id}`,
  DELETE: (projectId: string, id: string) => `/project/${projectId}/endpoints/${id}`,
} as const

export const LOG_ENDPOINTS = {
  LIST: (projectId: string) => `/project/${projectId}/logs`,
  DETAIL: (projectId: string, id: string) => `/project/${projectId}/logs/${id}`,
  RESPONSE_BODY: (projectId: string, id: string) => `/project/${projectId}/logs/${id}/response-body`,
  CLEAR: (projectId: string) => `/project/${projectId}/logs`,
  VOLATILE_FIELDS: (projectId: string) => `/project/${projectId}/logs/volatile-fields`,
} as const

/** The forward proxy the API runs beside: its status, and the CA a client must trust. */
export const PROXY_ENDPOINTS = {
  STATUS: '/proxy/',
  CA: '/proxy/ca',
} as const
