/**
 * The project's request log — every request the proxy intercepted for it.
 *
 * The third leg of the operations pattern: endpoints are configured, a real
 * client calls through the proxy, and this says what was actually called and
 * how it was answered. An execution log owns its query (the one exception
 * to a tab being a presenter): the rows are written outside this screen, so the
 * tab polls them while shown (`useLogList`).
 *
 * Headers and bodies are not columns — a row opens its detail panel for those.
 *
 * Above the table, one box per filterable column (method, status class, who
 * answered, host, path), named as the router's query parameters. They are held
 * by the dialog, not the URL: the dialog's history entries are `useUrlDialog`'s
 * to walk back over, and a filter push among them would make close land on a
 * filtered log instead of the list. The host and path boxes are debounced like
 * a list's.
 *
 * The first column ticks rows to save as mocks in one request; only a row the
 * server judged recordable can be ticked. The tick is its own control, so a
 * click on it never opens the row. The selection, too, is the dialog's: a
 * look at one row's detail and back keeps what was ticked.
 */

import { useEffect, useState } from 'react'
import { Box, Button, Checkbox, FormControlLabel, Stack, TableCell } from '@mui/material'
import { useTranslation } from 'react-i18next'
import ClippedText from '@/components/clipped-text/ClippedText'
import ListFilters from '@/components/data-grid/ListFilters'
import type { ListFilterField } from '@/components/data-grid/ListFilters'
import DetailSection from '@/components/detail/DetailSection'
import type { TableColumn } from '@/components/detail/PagedTableSection'
import ServerPagedTable from '@/components/detail/ServerPagedTable'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import { FILTER_DEBOUNCE_MS } from '@/config'
import { useQueryErrorToast } from '@/hooks/useQueryErrorToast'
import type { ServerTablePage } from '@/hooks/useServerTablePage'
import type { ListFilterValue } from '@/hooks/useListFilters'
import { useToast } from '@/hooks/useToast'
import { serverErrorMessage } from '@/lib/api/formErrors'
import { toApiError } from '@/lib/api/errors'
import { useRecordEndpoints } from '@/lib/api/hooks/useEndpoint'
import { useLogList } from '@/lib/api/hooks/useLog'
import { OUTCOME_COLORS, OUTCOME_LABEL_KEYS, logOutcome } from '@/sections/project/logOutcome'
import { formatCount } from '@/utils/formatNumber'
import { formatDateTime } from '@/utils/formatTime'
import { endsWithJamo } from '@/utils/hangul'
import { RECORD_MANY_MAX } from '@/types/endpoint'
import type { EndpointRecordManyResponse, RecordSkipReason } from '@/types/endpoint'
import { LOG_METHODS, LOG_OUTCOMES, STATUS_CLASSES } from '@/types/log'
import type { LogFilterParams, LogOutcome, RequestLog } from '@/types/log'

/** Percentages, so this table reads at the endpoint table's rhythm. */
const WIDTHS = ['6%', '16%', '10%', '20%', '22%', '9%', '9%', '8%'] as const

/** `TextFilterQuery`'s `max_length`: a longer host or path box would be a 422. */
const TEXT_FILTER_MAX_LENGTH = 120

/** The skip reasons in the order the summary names them. */
const SKIP_REASONS: readonly RecordSkipReason[] = ['duplicate', 'conflict', 'not_recordable', 'not_found']

/** No filter at all - one object, so `filterParams` answering it says "unfiltered" by identity. */
const NO_FILTER_PARAMS: LogFilterParams = {}

/** The boxes' values: a list per multi-select, the typed text for the host and the path. */
export interface LogFilterValues {
  method: readonly string[]
  status_class: readonly string[]
  outcome: readonly string[]
  host: string
  path: string
}

/** The text boxes as asked for: what was typed, once it rests. */
interface TextFilters {
  host: string
  path: string
}

export const NO_LOG_FILTERS: LogFilterValues = { method: [], status_class: [], outcome: [], host: '', path: '' }

/** Nothing ticked - one set, so the dialog's reset hands the same one back. */
export const NO_LOG_SELECTION: ReadonlySet<string> = new Set()

interface ProjectLogsTabProps {
  projectId: string
  /** The dialog's paging: opening a row unmounts this tab. */
  page: ServerTablePage<RequestLog>
  filters: LogFilterValues
  onFiltersChange: (filters: LogFilterValues) => void
  /** The ticked log ids, across pages. */
  selection: ReadonlySet<string>
  onSelectionChange: (selection: ReadonlySet<string>) => void
  onSelect: (log: RequestLog) => void
  onClear: () => void
}

export default function ProjectLogsTab({
  projectId,
  page,
  filters,
  onFiltersChange,
  selection,
  onSelectionChange,
  onSelect,
  onClear,
}: ProjectLogsTabProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()
  const recordMany = useRecordEndpoints(projectId)

  // The host and path as asked for: the typed ones once they rest, never mid-syllable.
  const typedHost = filters.host.trim().slice(0, TEXT_FILTER_MAX_LENGTH)
  const typedPath = filters.path.trim().slice(0, TEXT_FILTER_MAX_LENGTH)
  const [settled, setSettled] = useState<TextFilters>({ host: typedHost, path: typedPath })
  const [composing, setComposing] = useState(false)
  useEffect(() => {
    if (composing || endsWithJamo(typedHost) || endsWithJamo(typedPath)) return
    const timer = setTimeout(() => setSettled({ host: typedHost, path: typedPath }), FILTER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [typedHost, typedPath, composing])

  const query = useLogList({ projectId, ...page.params, ...filterParams(filters, settled) })
  const logs = page.resolve(query.data)
  const isFiltered = filterParams(filters, { host: typedHost, path: typedPath }) !== NO_FILTER_PARAMS

  useQueryErrorToast(query, tCommon('messages.load_failed'))

  const pageRecordable = logs.rows.filter((log) => log.recordable)
  const pageTicked = pageRecordable.filter((log) => selection.has(log.id)).length

  /** A changed filter is a new list: back to its first page, nothing ticked that it may hide. */
  const changeFilter = (name: string, value: ListFilterValue) => {
    onFiltersChange({ ...filters, [name]: value })
    onSelectionChange(NO_LOG_SELECTION)
    page.reset()
  }

  const tick = (ids: string[], on: boolean) => {
    const next = new Set(selection)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onSelectionChange(next)
  }

  /** Created, then each skip reason with how many it took - the one sentence the save ends in. */
  const summarize = ({ created, skipped }: EndpointRecordManyResponse) => {
    if (skipped.length === 0) return t('log.bulk_saved', { created: formatCount(created.length) })
    const reasons = SKIP_REASONS.flatMap((reason) => {
      const total = skipped.filter((skip) => skip.reason === reason).length
      return total === 0
        ? []
        : [t('log.skip_count', { reason: t(`log.skip_reason.${reason}`), total: formatCount(total) })]
    })
    return t('log.bulk_partial', {
      created: formatCount(created.length),
      skipped: formatCount(skipped.length),
      reasons: reasons.join(', '),
    })
  }

  const saveSelected = async () => {
    try {
      const result = await recordMany.mutateAsync({ request_log_ids: [...selection] })
      onSelectionChange(NO_LOG_SELECTION)
      const summary = summarize(result)
      if (result.created.length > 0) toast.success(summary)
      else toast.error(summary)
    } catch (error) {
      toast.error(serverErrorMessage(toApiError(error).code, tCommon))
    }
  }

  const fields: ListFilterField[] = [
    { name: 'method', label: t('log.method'), options: LOG_METHODS, optionLabel: (value) => value },
    {
      name: 'status_class',
      label: t('log.status'),
      options: STATUS_CLASSES,
      optionLabel: (value) => `${value}xx`,
    },
    {
      name: 'outcome',
      label: t('log.matched'),
      options: LOG_OUTCOMES,
      optionLabel: (value) => t(OUTCOME_LABEL_KEYS[value as LogOutcome]),
    },
    { name: 'host', label: t('log.host') },
    { name: 'path', label: t('log.path') },
  ]

  const columns: TableColumn[] = [
    { key: 'select', width: WIDTHS[0], label: t('log.select_row'), align: 'center' },
    { key: 'created_at', width: WIDTHS[1], label: t('log.created_at') },
    { key: 'method', width: WIDTHS[2], label: t('log.method') },
    { key: 'host', width: WIDTHS[3], label: t('log.host') },
    { key: 'path', width: WIDTHS[4], label: t('log.path') },
    { key: 'status', width: WIDTHS[5], label: t('log.status'), align: 'right' },
    { key: 'matched', width: WIDTHS[6], label: t('log.matched'), align: 'center' },
    { key: 'duration', width: WIDTHS[7], label: t('log.duration'), align: 'right' },
  ]

  const tooMany = selection.size > RECORD_MANY_MAX

  return (
    <DetailSection
      name="clock"
      title={t('tabs.logs')}
      subtitle={t('log.subtitle')}
      action={
        <Button
          size="small"
          color="error"
          startIcon={<Iconify name="delete" />}
          onClick={onClear}
          disabled={logs.pagination.count === 0 && !isFiltered}
        >
          {t('log.clear')}
        </Button>
      }
    >
      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          alignItems: 'center',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
          },
          mb: 2,
        }}
      >
        <ListFilters
          fields={fields}
          values={{ ...filters }}
          onChange={changeFilter}
          onComposing={setComposing}
          allLabel={tCommon('filters.all')}
          noOptionsLabel={tCommon('filters.no_options')}
          clearLabel={tCommon('filters.clear')}
          openLabel={tCommon('filters.open')}
          closeLabel={tCommon('filters.close')}
        />
        {/* The last item of the boxes' flow, as in a list head; `order` keeps it before the chip row. */}
        <Button
          color="inherit"
          disabled={!isFiltered}
          startIcon={<Iconify name="reset" />}
          onClick={() => {
            onFiltersChange(NO_LOG_FILTERS)
            onSelectionChange(NO_LOG_SELECTION)
            page.reset()
          }}
          sx={{ order: 1, justifySelf: 'start', minWidth: 0 }}
        >
          {tCommon('actions.reset')}
        </Button>
      </Box>

      {logs.rows.length > 0 && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
          <FormControlLabel
            sx={{ ml: 0, flexGrow: 1 }}
            control={
              <Checkbox
                size="small"
                checked={pageRecordable.length > 0 && pageTicked === pageRecordable.length}
                indeterminate={pageTicked > 0 && pageTicked < pageRecordable.length}
                disabled={pageRecordable.length === 0}
                onChange={(event) =>
                  tick(
                    pageRecordable.map((log) => log.id),
                    event.target.checked,
                  )
                }
              />
            }
            label={t('log.select_page')}
            slotProps={{ typography: { variant: 'body2', color: 'text.secondary' } }}
          />
          {tooMany && (
            <Label color="warning">{t('log.bulk_too_many', { max: formatCount(RECORD_MANY_MAX) })}</Label>
          )}
          <Button
            size="small"
            variant="contained"
            startIcon={<Iconify name="add" />}
            disabled={selection.size === 0 || tooMany || recordMany.isPending}
            onClick={() => void saveSelected()}
          >
            {t('log.bulk_record', { total: formatCount(selection.size) })}
          </Button>
        </Stack>
      )}

      <ServerPagedTable
        columns={columns}
        rows={logs.rows}
        rowKey={(log) => log.id}
        pagination={logs.pagination}
        empty={isFiltered ? tCommon('messages.no_match') : t('log.empty')}
        loading={query.isFetching}
        onRowClick={onSelect}
        renderCells={(log) => (
          <>
            {/* The tick is its own control: its click and keys never open the row. */}
            <TableCell
              align="center"
              padding="none"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <Checkbox
                size="small"
                checked={selection.has(log.id)}
                disabled={!log.recordable}
                onChange={(event) => tick([log.id], event.target.checked)}
                slotProps={{ input: { 'aria-label': t('log.select_row') } }}
              />
            </TableCell>
            <TableCell>
              <ClippedText text={formatDateTime(log.created_at)} />
            </TableCell>
            <TableCell>
              <ClippedText text={log.method} />
            </TableCell>
            <TableCell>
              <ClippedText text={log.host} />
            </TableCell>
            <TableCell>
              <ClippedText text={`${log.path}${log.query_string === '' ? '' : `?${log.query_string}`}`} />
            </TableCell>
            <TableCell align="right">
              <ClippedText text={String(log.response_status)} />
            </TableCell>
            <TableCell align="center">
              <Label color={OUTCOME_COLORS[logOutcome(log)]}>{t(OUTCOME_LABEL_KEYS[logOutcome(log)])}</Label>
            </TableCell>
            <TableCell align="right">
              <ClippedText text={t('endpoint.delay_value', { ms: log.duration_ms })} />
            </TableCell>
          </>
        )}
      />
    </DetailSection>
  )
}

/** The boxes as the router's parameters: an empty box is no parameter, never `path=`. */
function filterParams(filters: LogFilterValues, text: TextFilters): LogFilterParams {
  const params: LogFilterParams = {
    ...(filters.method.length > 0 && { method: filters.method }),
    ...(filters.status_class.length > 0 && { status_class: filters.status_class }),
    ...(filters.outcome.length > 0 && { outcome: filters.outcome }),
    ...(text.host !== '' && { host: text.host }),
    ...(text.path !== '' && { path: text.path }),
  }
  return Object.keys(params).length === 0 ? NO_FILTER_PARAMS : params
}
