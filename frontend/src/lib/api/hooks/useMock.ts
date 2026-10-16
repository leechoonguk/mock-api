/**
 * Mock hooks: the forward proxy's status, and where its CA certificate downloads.
 *
 * No admin write changes the proxy, so its status is never invalidated: it is
 * read fresh on every mount and focus, and polled while shown — the proxy can
 * start listening, or generate its CA, while the screen is open.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { QUERY_STALE_TIME } from '@/lib/api/queryDefaults'
import { proxyKeys } from '@/lib/api/queryKeys'
import { mockService } from '@/lib/api/services/mock.service'
import type { ProxyStatus } from '@/types/proxy'

/** How often a shown proxy status asks again. */
const PROXY_STATUS_POLL_MS = 10_000

export function useProxyStatus() {
  return useQuery<ProxyStatus>({
    queryKey: proxyKeys.detail('status'),
    queryFn: () => mockService.status(),
    staleTime: QUERY_STALE_TIME.REALTIME,
    refetchInterval: PROXY_STATUS_POLL_MS,
  })
}

/** The CA certificate's download URL, for a plain link. */
export function useProxyCaUrl() {
  return useMemo(() => mockService.caUrl(), [])
}
