/**
 * Project list — each project and the hosts it intercepts.
 *
 * The operations pattern: a project row is configuration, its detail dialog
 * holds the endpoints (what it answers) and the request log that says what was
 * called. The name is edited in the row; the hosts are a list a cell cannot
 * hold, so creating needs the form dialog. A row click opens the detail dialog
 * at `?detail=<id>`.
 */

import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGridApiRef } from '@mui/x-data-grid'
import type { GridColDef } from '@mui/x-data-grid'
import ProjectDetailDialog from '@/sections/project/ProjectDetailDialog'
import ProjectFormDialog, { NAME_MAX_LENGTH } from '@/sections/project/ProjectFormDialog'
import ConfirmDialog from '@/components/confirm-dialog/ConfirmDialog'
import ListCardHead from '@/components/data-grid/ListCardHead'
import ListFilters from '@/components/data-grid/ListFilters'
import { rowActionsColumn } from '@/components/data-grid/RowActions'
import ServerDataGrid from '@/components/data-grid/ServerDataGrid'
import ScreenCard from '@/components/screen-card/ScreenCard'
import { TIMESTAMP_COLUMN_FLOOR } from '@/config'
import { useCrudDialog } from '@/hooks/useCrudDialog'
import { useDataGridState } from '@/hooks/useDataGridState'
import { useListFilters } from '@/hooks/useListFilters'
import { useQueryErrorToast } from '@/hooks/useQueryErrorToast'
import { useRowEditor } from '@/hooks/useRowEditor'
import type { RowRefusal } from '@/hooks/useRowEditor'
import { useToast } from '@/hooks/useToast'
import { DETAIL_PARAM, useUrlDialog } from '@/hooks/useUrlDialog'
import { toApiError } from '@/lib/api/errors'
import { serverErrorMessage } from '@/lib/api/formErrors'
import { useDeleteProject, useProjectList, useUpdateProject } from '@/lib/api/hooks/useProject'
import { formatCount } from '@/utils/formatNumber'
import { formatDateTime } from '@/utils/formatTime'
import type { Project, ProjectListParams } from '@/types/project'

/**
 * Every column has a **floor** and a **share**. The name is the row's identity
 * and takes the largest share; the hosts are a short list, the count a number.
 */
const COLUMN: Record<string, { floor: number; share: number; priority: number }> = {
  name: { floor: 200, share: 1.2, priority: 0 },
  hosts: { floor: 200, share: 1, priority: 1 },
  endpoint_count: { floor: 140, share: 0.4, priority: 2 },
  created_at: { floor: TIMESTAMP_COLUMN_FLOOR, share: 0.6, priority: 3 },
}

/** What the header may sort - the router's `ProjectSortQuery`; the URL's `sort` is held to it. */
const SORTABLE = ['name', 'created_at']

/** The grid props a column's floor and share become. */
const sized = (field: keyof typeof COLUMN) => ({
  field,
  flex: COLUMN[field].share,
  minWidth: COLUMN[field].floor,
})

/** The columns this screen filters — the query parameters' own names. */
const FILTER_FIELDS = ['name'] as const

const FILTER_LABEL_KEYS = {
  name: 'filter.name',
} as const

type FilterField = (typeof FILTER_FIELDS)[number]

/** The free-text column a row edits. */
type EditableField = 'name'

/** The phone's card: the project's name, then its hosts and how many endpoints it holds. */
const CARD = { title: 'name', fields: ['hosts', 'endpoint_count'] }

/** No page yet - one array, so the memoised grid is not handed a new one per render. */
const EMPTY_ROWS: Project[] = []

export default function ProjectList() {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()

  const grid = useDataGridState({ sortable: SORTABLE })
  const apiRef = useGridApiRef()
  const filters = useListFilters(FILTER_FIELDS, grid.resetPage)
  const params = useMemo<ProjectListParams>(
    () => ({ ...grid.params, ...filters.params }),
    [grid.params, filters.params],
  )
  const query = useProjectList(params)
  const rows = query.data?.items ?? EMPTY_ROWS
  const rowCount = query.data?.total ?? 0
  const dialog = useCrudDialog<Project>()
  const detail = useUrlDialog(DETAIL_PARAM)
  const openDetail = detail.open
  const deleteMutation = useDeleteProject()
  const updateMutation = useUpdateProject()

  useQueryErrorToast(query, tCommon('messages.load_failed'))

  const refusal = useCallback(
    (row: Project): RowRefusal<EditableField> | null => {
      const problem = nameProblem(String(row.name ?? ''))
      if (problem === null) return null
      return {
        field: 'name',
        sentence:
          problem === 'required'
            ? tCommon('validation.required')
            : tCommon('validation.max_length', { count: NAME_MAX_LENGTH }),
      }
    },
    [tCommon],
  )
  const editor = useRowEditor<Project, EditableField>({ apiRef, refusal })

  const columns = useMemo<GridColDef<Project>[]>(
    () => [
      {
        ...sized('name'),
        headerName: t('table.name'),
        editable: true,
        preProcessEditCellProps: (cell) => ({
          ...cell.props,
          error: nameProblem(String(cell.props.value ?? '')) !== null,
        }),
      },
      {
        ...sized('hosts'),
        headerName: t('table.hosts'),
        sortable: false,
        valueFormatter: (value: string[]) => value.join(', '),
      },
      {
        ...sized('endpoint_count'),
        headerName: t('table.endpoint_count'),
        type: 'number',
        sortable: false,
        valueFormatter: (value: number) => formatCount(value),
      },
      {
        ...sized('created_at'),
        headerName: tCommon('fields.created_at'),
        valueFormatter: (value: string) => formatDateTime(value),
      },
      rowActionsColumn<Project>({
        count: 3,
        actions: ({ id, row }) =>
          editor.isEditing(id)
            ? [
                {
                  label: tCommon('actions.save'),
                  icon: 'check',
                  tone: 'primary',
                  onClick: () => editor.commitEdit(id),
                },
                {
                  label: tCommon('actions.cancel'),
                  icon: 'close',
                  onClick: () => editor.cancelEdit(id),
                },
              ]
            : [
                {
                  label: tCommon('actions.view'),
                  icon: 'view',
                  onClick: () => openDetail(row.id),
                },
                {
                  label: tCommon('actions.edit'),
                  icon: 'edit',
                  onClick: () => editor.startEdit(id),
                },
                {
                  label: tCommon('actions.delete'),
                  icon: 'delete',
                  tone: 'error',
                  onClick: () => dialog.openDelete(row),
                },
              ],
      }),
    ],
    [t, tCommon, dialog, editor, openDetail],
  )

  /** One PATCH for the row; the returned row carries the new `version`. */
  const handleRowUpdate = editor.guardRowUpdate(async (updated: Project, original: Project) => {
    const name = updated.name.trim()
    if (name === original.name) return original

    const saved = await updateMutation.mutateAsync({ id: updated.id, data: { name } })
    toast.success(tCommon('messages.saved'))
    return saved
  })

  const handleDelete = async () => {
    if (dialog.selected === null) return
    try {
      await deleteMutation.mutateAsync(dialog.selected.id)
      toast.success(tCommon('messages.deleted'))
      dialog.close()
    } catch (error) {
      toast.error(serverErrorMessage(toApiError(error).code, tCommon))
    }
  }

  const handleRowClick = useCallback((row: Project) => openDetail(row.id), [openDetail])
  const { rowUpdateError } = editor
  const handleRowUpdateError = useCallback(
    (error: unknown) =>
      rowUpdateError(error, (failure) => serverErrorMessage(toApiError(failure).code, tCommon)),
    [rowUpdateError, tCommon],
  )

  return (
    <>
      <ScreenCard>
        <ListCardHead
          title={t('list_title')}
          count={rowCount}
          reset={{
            label: tCommon('actions.reset'),
            onReset: filters.reset,
            disabled: !filters.isFiltered,
          }}
          add={{ label: tCommon('actions.add'), onAdd: dialog.openCreate }}
          refreshLabel={tCommon('actions.refresh')}
          onRefresh={() => void query.refetch()}
          refreshing={query.isFetching}
          activeFilterCount={filters.activeCount}
          filtersLabel={tCommon('filters.toggle')}
          filters={
            <ListFilters
              fields={FILTER_FIELDS.map((field) => ({
                name: field,
                label: t(FILTER_LABEL_KEYS[field]),
              }))}
              values={filters.inputs}
              onChange={(name, value) => filters.setInput(name as FilterField, value)}
              onComposing={filters.setComposing}
            />
          }
        />

        <ServerDataGrid
          rows={rows}
          columns={columns}
          priorities={COLUMN}
          rowCount={rowCount}
          emptyTitle={filters.isFiltered ? tCommon('messages.no_match') : tCommon('messages.no_data')}
          emptyAction={
            filters.isFiltered
              ? { label: tCommon('actions.reset'), onClick: filters.reset }
              : { label: tCommon('actions.add'), onClick: dialog.openCreate }
          }
          loading={query.isFetching}
          paginationModel={grid.paginationModel}
          onPaginationModelChange={grid.setPaginationModel}
          sortModel={grid.sortModel}
          onSortModelChange={grid.setSortModel}
          density={grid.density}
          columnVisibilityModel={grid.columnVisibilityModel}
          onColumnVisibilityModelChange={grid.setColumnVisibilityModel}
          localeText={grid.localeText}
          onRowClick={handleRowClick}
          rowModesModel={editor.rowModes}
          onRowModesModelChange={editor.setRowModes}
          processRowUpdate={handleRowUpdate}
          apiRef={apiRef}
          onProcessRowUpdateError={handleRowUpdateError}
          card={CARD}
        />
      </ScreenCard>

      <ProjectDetailDialog open={detail.value !== null} projectId={detail.value} onClose={detail.close} />

      <ProjectFormDialog open={dialog.isCreateOpen} onClose={dialog.close} onCreated={openDetail} />

      <ConfirmDialog
        open={dialog.isDeleteOpen}
        title={t('delete_title')}
        content={t('messages.delete_confirm', { name: dialog.selected?.name ?? '' })}
        confirmLabel={tCommon('actions.delete')}
        cancelLabel={tCommon('actions.cancel')}
        pending={deleteMutation.isPending}
        onConfirm={() => void handleDelete()}
        onClose={dialog.close}
      />
    </>
  )
}

/** The one place a row's name is judged — the red cell and the blocked save agree. */
function nameProblem(value: string): 'required' | 'max' | null {
  const trimmed = value.trim()
  if (trimmed === '') return 'required'
  return trimmed.length > NAME_MAX_LENGTH ? 'max' : null
}
