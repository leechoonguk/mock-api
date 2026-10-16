/**
 * Delete confirmation for one record, as a panel inside the record's own dialog.
 *
 * A confirm dialog stacked on a detail dialog is the layer these screens are not
 * allowed to add, and it would cover the thing being deleted. So the panel names
 * the record, states what deleting costs, and carries the verbs in the same
 * pinned strip every other panel uses.
 *
 * It exists because the two callers had drifted: one pinned its strip and put
 * `delete` in it, the other left the strip static and repeated `cancel` at the
 * bottom beside `delete` — two cancels and no pinned action on the same dialog,
 * one screen apart. The shape is shared; only the record summary and the cost
 * sentence are per-domain, and they arrive as nodes, never as a mode flag.
 */

import type { ReactNode } from 'react'
import { Button, Divider, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import Iconify from '@/components/iconify/Iconify'
import PanelStrip from '@/components/detail/PanelStrip'

interface RecordDeletePanelProps {
  title: string
  /** The record, readable before the click: status, name, and its long value. */
  summary: ReactNode
  /** What the deletion costs, or why the server will refuse it. */
  warning: ReactNode
  /**
   * The server would refuse: the button is dead and `warning` is the reason.
   * Disabling without a stated reason is the pattern this panel exists to avoid.
   */
  blocked?: boolean
  pending: boolean
  onBack: () => void
  onConfirm: () => void
}

export default function RecordDeletePanel({
  title,
  summary,
  warning,
  blocked = false,
  pending,
  onBack,
  onConfirm,
}: RecordDeletePanelProps) {
  const { t: tCommon } = useTranslation('common')

  return (
    <Stack spacing={2}>
      <PanelStrip
        onBack={onBack}
        backLabel="cancel"
        actions={
          <Button
            size="small"
            variant="contained"
            color="error"
            startIcon={<Iconify name="delete" />}
            onClick={onConfirm}
            disabled={pending || blocked}
          >
            {tCommon('actions.delete')}
          </Button>
        }
      >
        <Typography variant="subtitle2">{title}</Typography>
      </PanelStrip>

      <Divider sx={{ borderStyle: 'dashed' }} />

      <Stack direction="row" spacing={1.5} alignItems="center">
        {summary}
      </Stack>

      {warning}

    </Stack>
  )
}
