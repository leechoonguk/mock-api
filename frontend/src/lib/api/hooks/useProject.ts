/**
 * Project query/mutation hooks.
 *
 * A project row carries its endpoint count, so the endpoint hooks invalidate
 * the project keys too; here only the project's own writes are handled - and
 * the log's suggested ignored fields, which leave out the ones it ignores.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { QUERY_STALE_TIME } from '@/lib/api/queryDefaults'
import { projectKeys, volatileFieldKeys } from '@/lib/api/queryKeys'
import { projectService } from '@/lib/api/services/project.service'
import type { ProjectCreateRequest, ProjectListParams, ProjectUpdateRequest } from '@/types/project'

export function useProjectList(params: ProjectListParams) {
  return useQuery({
    queryKey: projectKeys.list(params),
    queryFn: ({ signal }) => projectService.list(params, signal),
    staleTime: QUERY_STALE_TIME.STANDARD,
    placeholderData: (previous) => previous,
  })
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: projectKeys.detail(id ?? ''),
    queryFn: () => projectService.detail(id ?? ''),
    staleTime: QUERY_STALE_TIME.STANDARD,
    enabled: id !== null,
  })
}

export function useCreateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ProjectCreateRequest) => projectService.create(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
  })
}

export function useUpdateProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ProjectUpdateRequest }) =>
      projectService.update(id, data),
    onSuccess: (project) => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() })
      queryClient.invalidateQueries({ queryKey: projectKeys.detail(project.id) })
      queryClient.invalidateQueries({ queryKey: volatileFieldKeys.detail(project.id) })
    },
  })
}

export function useDeleteProject() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => projectService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
  })
}
