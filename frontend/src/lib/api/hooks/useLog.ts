/**
 * Request log hooks.
 *
 * `REALTIME` and polled: every mock call writes a row, from any client, outside
 * any request of this one — a log that waited for a manual refresh would show
 * the test the reader just sent as missing. The key is `logKeys`, a scope of
 * its own, so a project's own edits do not refetch it.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QUERY_STALE_TIME } from '@/lib/api/queryDefaults'
import { logKeys } from '@/lib/api/queryKeys'
import { logService } from '@/lib/api/services/log.service'
import type { LogListParams } from '@/types/log'

/** How often a shown log asks for new rows. */
const LOG_REFETCH_INTERVAL_MS = 3000

export function useLogList(params: LogListParams | null) {
  return useQuery({
    queryKey: logKeys.list(params ?? {}),
    queryFn: ({ signal }) =>
      // `enabled` holds the query until there is a project to ask under.
      logService.list(params as LogListParams, signal),
    staleTime: QUERY_STALE_TIME.REALTIME,
    placeholderData: (previous) => previous,
    refetchInterval: LOG_REFETCH_INTERVAL_MS,
    enabled: params !== null,
  })
}

/** A row never changes once written, so its detail is read once per opening. */
export function useLog(projectId: string | null, id: string | null) {
  return useQuery({
    queryKey: logKeys.detail(id ?? ''),
    queryFn: () => logService.detail(projectId ?? '', id ?? ''),
    staleTime: QUERY_STALE_TIME.LONG,
    enabled: projectId !== null && id !== null,
  })
}

/** Clears the project's whole log. */
export function useDeleteLog(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => logService.remove(projectId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: logKeys.lists() }),
  })
}
