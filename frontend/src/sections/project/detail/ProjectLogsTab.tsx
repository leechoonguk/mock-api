/**
 * The project's request log — every call the mock server answered for it.
 *
 * The third leg of the operations pattern: endpoints are configured, the test
 * panel exercises them, and this says what was actually called and how it was
 * answered, from any client. An execution log owns its query (the one exception
 * to a tab being a presenter): the rows are written outside this screen, so the
 * tab polls them while shown (`useLogList`).
 *
 * Headers and bodies are not columns — a row opens its detail panel for those.
 */

import { Button, TableCell } from '@mui/material'
import { useTranslation } from 'react-i18next'
import ClippedText from '@/components/clipped-text/ClippedText'
import DetailSection from '@/components/detail/DetailSection'
import type { TableColumn } from '@/components/detail/PagedTableSection'
import ServerPagedTable from '@/components/detail/ServerPagedTable'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import { useQueryErrorToast } from '@/hooks/useQueryErrorToast'
import { useServerTablePage } from '@/hooks/useServerTablePage'
import { useLogList } from '@/lib/api/hooks/useLog'
import { formatDateTime } from '@/utils/formatTime'
import type { RequestLog } from '@/types/log'

/** Percentages, so this table reads at the endpoint table's rhythm. */
const WIDTHS = ['22%', '11%', '37%', '10%', '10%', '10%'] as const

interface ProjectLogsTabProps {
  projectId: string
  onSelect: (log: RequestLog) => void
  onClear: () => void
}

export default function ProjectLogsTab({ projectId, onSelect, onClear }: ProjectLogsTabProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')

  const page = useServerTablePage<RequestLog>()
  const query = useLogList({ projectId, ...page.params })
  const logs = page.resolve(query.data)

  useQueryErrorToast(query, tCommon('messages.load_failed'))

  const columns: TableColumn[] = [
    { key: 'created_at', width: WIDTHS[0], label: t('log.created_at') },
    { key: 'method', width: WIDTHS[1], label: t('log.method') },
    { key: 'path', width: WIDTHS[2], label: t('log.path') },
    { key: 'status', width: WIDTHS[3], label: t('log.status'), align: 'right' },
    { key: 'matched', width: WIDTHS[4], label: t('log.matched'), align: 'center' },
    { key: 'duration', width: WIDTHS[5], label: t('log.duration'), align: 'right' },
  ]

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
          disabled={logs.pagination.count === 0}
        >
          {t('log.clear')}
        </Button>
      }
    >
      <ServerPagedTable
        columns={columns}
        rows={logs.rows}
        rowKey={(log) => log.id}
        pagination={logs.pagination}
        empty={t('log.empty')}
        loading={query.isFetching}
        onRowClick={onSelect}
        renderCells={(log) => (
          <>
            <TableCell>
              <ClippedText text={formatDateTime(log.created_at)} />
            </TableCell>
            <TableCell>
              <ClippedText text={log.method} />
            </TableCell>
            <TableCell>
              <ClippedText text={log.query_string === '' ? log.path : `${log.path}?${log.query_string}`} />
            </TableCell>
            <TableCell align="right">
              <ClippedText text={String(log.response_status)} />
            </TableCell>
            <TableCell align="center">
              <Label color={log.matched ? 'success' : 'error'}>
                {log.matched ? t('log.matched_yes') : t('log.matched_no')}
              </Label>
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
