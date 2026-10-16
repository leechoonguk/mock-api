/**
 * The project's endpoints, as a paged table inside the detail dialog.
 *
 * A pure presenter: it takes the page it was handed and queries nothing. The
 * dialog owns the list query and its paging — opening an endpoint replaces this
 * body, and a page held here would be lost on every visit to a record. Every
 * action opens a panel one level up; the enabled switch is the one write a row
 * makes in place, because turning an endpoint off is the commonest edit and a
 * panel for one boolean is a detour.
 */

import { Stack, Switch, TableCell } from '@mui/material'
import { useTranslation } from 'react-i18next'
import ClippedText from '@/components/clipped-text/ClippedText'
import Label from '@/components/label/Label'
import PagedTableSection from '@/components/detail/PagedTableSection'
import type { TableColumn } from '@/components/detail/PagedTableSection'
import type { TablePaging } from '@/hooks/useTablePage'
import { METHOD_COLORS } from '@/sections/project/methodColors'
import type { Endpoint } from '@/types/endpoint'

interface ProjectEndpointsTabProps {
  paging: TablePaging<Endpoint>
  /** An endpoint whose switch is mid-save: its switch waits for the answer. */
  pendingId: string | null
  onCreate: () => void
  onSelect: (endpoint: Endpoint) => void
  onDelete: (endpoint: Endpoint) => void
  onToggle: (endpoint: Endpoint, enabled: boolean) => void
}

export default function ProjectEndpointsTab({
  paging,
  pendingId,
  onCreate,
  onSelect,
  onDelete,
  onToggle,
}: ProjectEndpointsTabProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')

  const columns: TableColumn[] = [
    { key: 'method', label: t('endpoint.method'), width: '13%' },
    { key: 'path', label: t('endpoint.path'), width: '43%' },
    { key: 'status', label: t('endpoint.status_code'), width: '12%', align: 'right' },
    { key: 'delay', label: t('endpoint.delay_ms'), width: '14%', align: 'right' },
    { key: 'enabled', label: tCommon('status.enabled'), width: '12%', align: 'center' },
  ]

  return (
    <PagedTableSection
      icon="link"
      title={t('tabs.endpoints')}
      subtitle={t('endpoint.match_hint')}
      onCreate={onCreate}
      columns={columns}
      paging={paging}
      rowKey={(endpoint) => endpoint.id}
      onRowClick={onSelect}
      renderCells={(endpoint) => (
        <>
          <TableCell>
            <Label color={METHOD_COLORS[endpoint.method]}>{endpoint.method}</Label>
          </TableCell>
          {/* Two rows may share method and path under different hosts or conditions: a
              named host is printed before the path (none - "every host" - adds nothing to
              read), a query after it, and a body condition is a badge. */}
          <TableCell>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
              <ClippedText
                text={`${endpoint.host}${endpoint.path}${endpoint.match_query ? `?${endpoint.match_query}` : ''}`}
              />
              {endpoint.match_body !== null && <Label color="info">{t('endpoint.body_condition')}</Label>}
            </Stack>
          </TableCell>
          <TableCell align="right">
            <ClippedText text={String(endpoint.status_code)} />
          </TableCell>
          <TableCell align="right">
            <ClippedText text={t('endpoint.delay_value', { ms: endpoint.delay_ms })} />
          </TableCell>
          {/* The row opens on click; the switch is its own control, so its click stays its own. */}
          <TableCell
            align="center"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <Switch
              size="small"
              checked={endpoint.enabled}
              disabled={pendingId === endpoint.id}
              onChange={(event) => onToggle(endpoint, event.target.checked)}
              slotProps={{ input: { 'aria-label': tCommon('status.enabled') } }}
            />
          </TableCell>
        </>
      )}
      actions={(endpoint) => [
        { label: tCommon('actions.edit'), icon: 'edit', onClick: () => onSelect(endpoint) },
        {
          label: tCommon('actions.delete'),
          icon: 'delete',
          tone: 'error',
          onClick: () => onDelete(endpoint),
        },
      ]}
    />
  )
}
