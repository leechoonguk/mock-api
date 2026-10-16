/**
 * Mock hooks: the send verb, and the base URL a project answers at.
 *
 * Sending is a mutation, not a query: every send is a call the mock server
 * logs, so it is triggered by the reader and never refetched on focus. Its
 * success marks the request log stale — the call just wrote a row there.
 */

import { useMemo } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { logKeys } from '@/lib/api/queryKeys'
import { mockService } from '@/lib/api/services/mock.service'
import type { MockSendInput } from '@/lib/api/services/mock.service'

export function useSendMock() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: MockSendInput) => mockService.send(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: logKeys.lists() }),
  })
}

/** A project's base URL, for the header to show and copy. */
export function useMockBaseUrl(slug: string) {
  return useMemo(() => mockService.baseUrl(slug), [slug])
}
