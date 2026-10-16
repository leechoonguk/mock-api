/**
 * Inline icon, ported from the reference application's `Iconify`.
 *
 * The prop is a registry key, not an icon string: `<Iconify name="edit" />`. That
 * is what keeps one family and one weight across the app — the mapping lives in
 * `icons.ts`, so changing what "edit" looks like is one edit rather than a grep.
 *
 * The glyph is never the event target. `@iconify/react` re-creates the `<path>`
 * nodes when it re-renders, and inside a grid cell that happens between `mouseup`
 * and the browser's `click` dispatch — the cell re-renders when it takes focus, so
 * the node the press landed on no longer exists and no `click` is ever fired. That
 * was the dead first click on every list screen: `mousedown` and `mouseup` arrived
 * at the button, `click` did not, and the mutation log showed the paths swapping
 * 3ms after `mouseup`. `pointerEvents: 'none'` makes the button itself the target,
 * and a button element survives its own icon's re-render.
 */

import { Icon } from '@iconify/react'
import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import { ACTION_ICONS } from '@/components/iconify/icons'
import type { ActionIcon } from '@/components/iconify/icons'

const DEFAULT_SIZE = 20

interface IconifyProps {
  name: ActionIcon
  width?: number
  sx?: SxProps<Theme>
  /**
   * The class a parent clones onto its icon (`MuiTab-icon`): dropped, the
   * parent's own placement never reached the glyph - a tab's icon sat flush
   * against its label.
   */
  className?: string
}

export default function Iconify({ name, width = DEFAULT_SIZE, sx, className }: IconifyProps) {
  const boxSx = { width, height: width, flexShrink: 0, pointerEvents: 'none', ...sx } as const
  return (
    <Box
      component={Icon}
      icon={ACTION_ICONS[name]}
      className={className}
      sx={boxSx}
      // Until the set's data arrives `Icon` draws a bare `<span>` with none of
      // these props - 0px wide - and the glyph then pushed its row 20px aside:
      // measured on a phone, the list head's buttons moved twice and the header's
      // icons once on every load (CLS 0.03-0.04). The stand-in holds the box.
      fallback={<Box component="span" className={className} sx={{ display: 'inline-block', ...boxSx }} />}
    />
  )
}
