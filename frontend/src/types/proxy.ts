/**
 * Forward-proxy types — mirror of `backend/app/schemas/proxy.py`.
 *
 * Where a browser or app points its HTTP(S) proxy, whether the CA it must
 * trust can be downloaded yet, and which hosts went through it untouched.
 */

/** A host the proxy let through because no project intercepts it. */
export interface PassedHost {
  host: string
  /** Connections seen since the server started. */
  count: number
  last_seen: string
}

export interface ProxyStatus {
  enabled: boolean
  /** `false` when the proxy is turned off or could not bind its port. */
  listening: boolean
  host: string
  port: number
  /** The CA certificate exists and `GET /proxy/ca` serves it. */
  ca_ready: boolean
  /** Newest first, at most 100, held in memory: empty again after a restart. */
  passed_hosts: PassedHost[]
}
