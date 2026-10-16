/**
 * Cache-policy constants.
 *
 * A `staleTime: 30000` typed into a hook is a number nobody can review: it says
 * how long, never why. These names say why, so a change to "reference data is
 * cached for 10 minutes" is one edit instead of a grep.
 */

export const QUERY_STALE_TIME = {
  /** Always refetch — a list the user just mutated must not lag. */
  REALTIME: 0,
  /** Lists and search results; a few seconds of staleness is invisible. */
  STANDARD: 30_000,
  /** Reference data that changes on a human timescale. */
  LONG: 600_000,
} as const

export const QUERY_GC_TIME = {
  STANDARD: 300_000,
} as const

/**
 * One retry, then report. The backend already retries outbound integrations
 * itself, so a client-side retry storm only multiplies a provider outage.
 */
export const QUERY_RETRY = 1

export const QUERY_RETRY_DELAY_MAX_MS = 30_000
