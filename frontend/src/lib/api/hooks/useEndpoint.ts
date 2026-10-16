/**
 * Endpoint query/mutation hooks.
 *
 * Every write also invalidates the project keys: a project row and its detail
 * header carry `endpoint_count`, which a create or delete changes.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { QUERY_STALE_TIME } from '@/lib/api/queryDefaults'
import { endpointKeys, projectKeys } from '@/lib/api/queryKeys'
import { endpointService } from '@/lib/api/services/endpoint.service'
import type { EndpointCreateRequest, EndpointListParams, EndpointUpdateRequest } from '@/types/endpoint'

export function useEndpointList(params: EndpointListParams | null) {
  return useQuery({
    queryKey: endpointKeys.list(params ?? {}),
    queryFn: ({ signal }) =>
      // `enabled` holds the query until there is a project to ask under.
      endpointService.list(params as EndpointListParams, signal),
    staleTime: QUERY_STALE_TIME.STANDARD,
    placeholderData: (previous) => previous,
    enabled: params !== null,
  })
}

export function useEndpoint(projectId: string | null, id: string | null) {
  return useQuery({
    queryKey: endpointKeys.detail(id ?? ''),
    queryFn: () => endpointService.detail(projectId ?? '', id ?? ''),
    staleTime: QUERY_STALE_TIME.STANDARD,
    enabled: projectId !== null && id !== null,
  })
}

export function useCreateEndpoint(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: EndpointCreateRequest) => endpointService.create(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: endpointKeys.lists() })
      invalidateProject(queryClient, projectId)
    },
  })
}

export function useUpdateEndpoint(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: EndpointUpdateRequest }) =>
      endpointService.update(projectId, id, data),
    onSuccess: (endpoint) => {
      queryClient.invalidateQueries({ queryKey: endpointKeys.lists() })
      queryClient.invalidateQueries({ queryKey: endpointKeys.detail(endpoint.id) })
    },
  })
}

export function useDeleteEndpoint(projectId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => endpointService.remove(projectId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: endpointKeys.lists() })
      invalidateProject(queryClient, projectId)
    },
  })
}

/** The count a project row and its dialog header show moved with the write. */
function invalidateProject(queryClient: QueryClient, projectId: string) {
  queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
  queryClient.invalidateQueries({ queryKey: projectKeys.detail(projectId) })
}
