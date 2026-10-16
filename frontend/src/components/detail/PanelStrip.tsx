/**
 * A panel's header: a leave line, then one identity row, both staying put while
 * the body scrolls.
 *
 * Pinned, because a panel's body grows past the dialog: a 204-field record is
 * 933px against a 686px viewport, and an action at the bottom of that is an
 * action nobody scrolled to. Measured on the run panel before this component —
 * its `실행` button sat under inputs *and* under the result payload the run
 * appends, so the button moved further away every time it was used.
 *
 * The identity row is where a reader identifies the record: the verbs on the
 * right, what is being acted on in the middle. Four panels had written this
 * strip separately and had already drifted — one was not pinned at all, one
 * repeated its cancel at the bottom.
 *
 * Leaving sits *above* that row rather than first inside it. It is navigation,
 * not a verb on the record, and inline it was the first of five things in one
 * 900px row (`뒤로 GET search-product-classification /api/{…} 실행`) — the row a
 * reader scans for what the record is. Raised, the row holds only the record and
 * the verbs acting on it.
 */

import type { ReactNode } from 'react'
import { Button, Stack } from '@mui/material'
import { useTranslation } from 'react-i18next'
import Iconify from '@/components/iconify/Iconify'

interface PanelStripProps {
  /** Leaving is navigation, so it sits on the line above the identity row. */
  onBack: () => void
  /**
   * `back` returns to the list, `cancel` abandons what the panel proposes — a
   * delete confirmation is the second case, so the caller names it.
   */
  backLabel?: 'back' | 'cancel'
  /** The record being acted on: a status badge, its name, its long value. */
  children: ReactNode
  /** The verbs, pushed to the right edge of the row. */
  actions?: ReactNode
}

export default function PanelStrip({
  onBack,
  backLabel = 'back',
  children,
  actions,
}: PanelStripProps) {
  const { t: tCommon } = useTranslation('common')

  return (
    <Stack
      spacing={0.5}
      sx={{ position: 'sticky', top: 0, zIndex: 1, py: 1, bgcolor: 'background.neutral' }}
    >
      <Stack direction="row">
        <Button
          size="small"
          color="inherit"
          startIcon={<Iconify name="back" />}
          onClick={onBack}
          // Pulled back by the button's own text padding so the arrow starts on
          // the same left edge as the record's badge below it, not indented from
          // it by a gutter only this control has.
          sx={{ ml: -0.75 }}
        >
          {tCommon(`actions.${backLabel}`)}
        </Button>
      </Stack>

      <Stack
        direction="row"
        alignItems="center"
        spacing={1.5}
        // `gap`, not the child margins Stack writes by default: those land as
        // `margin-left: 12px` on every child after the first and outrank the
        // actions group's own `ml: 'auto'`. Measured on the operation panel -
        // `저장 취소` sat against the method badge with 457px of empty row to
        // its right, while the doc comment claimed the verbs were at the edge.
        useFlexGap
        sx={{
          // The identity row is one line, and every part of it keeps the width
          // it asked for. Without this each child could shrink to its own
          // min-content: measured, `search-product-classification` broke at its
          // hyphens into two lines, which doubled the row's height and squeezed
          // the 실행 button until its two glyphs stacked into a column.
          '& > *': { flexShrink: 0 },
          // Nothing in a one-line row wraps - a Label, a code, a summary.
          '& > .MuiTypography-root': { whiteSpace: 'nowrap' },
          // Exactly one child absorbs what is left, and it is the child that
          // already declared it truncates (`noWrap`): the long value, never the
          // identity beside it and never a button.
          '& > .MuiTypography-noWrap': { flexGrow: 1, flexShrink: 1, minWidth: 0 },
        }}
      >
        {children}

        {actions !== undefined && (
          <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
            {actions}
          </Stack>
        )}
      </Stack>
    </Stack>
  )
}
