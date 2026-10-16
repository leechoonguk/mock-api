/**
 * A titled white card inside a neutral detail body, ported from the reference
 * application's detail tabs.
 *
 * The icon plus the title is how a reader scans a record made of six sections
 * without reading any of them, so the pair is the component's whole contract.
 */

import { Card, Divider, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import Iconify from '@/components/iconify/Iconify'
import type { ActionIcon } from '@/components/iconify/icons'
import { RECORD_SURFACE } from '@/config'

interface DetailSectionProps {
  name: ActionIcon
  title: string
  /**
   * What the section's rows add up to, beside the title.
   *
   * A table of twelve rows does not say "one of them was 부적합", and on a
   * paged table the reader can only see the window in front of them. The line
   * belongs in the header because that is where a reader looks before deciding
   * to read the rows at all.
   */
  subtitle?: string
  /** One action for the whole section — the header is where a reader looks for it. */
  action?: ReactNode
  children: ReactNode
}

/**
 * One height for every section header. Measured without it: a header carrying an
 * action button was 70px and a text-only header was 62px, so the title row moved
 * as the reader switched tabs. The taller of the two is the floor, because the
 * button is what needs the room.
 */
const HEADER_HEIGHT = RECORD_SURFACE.SECTION_HEADER_HEIGHT

export default function DetailSection({
  name,
  title,
  subtitle,
  action,
  children,
}: DetailSectionProps) {
  // No bottom margin: a gap below the last card would not match the body's own
  // padding above the first one. Stacking two sections is the parent's job -
  // `<Stack spacing={3}>` - because the gap belongs between them, not on one.
  // A column: beside another card in a grid row it is stretched to the row's
  // height, and its body grows so a pager at the foot sits on the same line.
  return (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        sx={{ px: 2.5, minHeight: HEADER_HEIGHT }}
      >
        <Iconify name={name} sx={{ color: 'text.secondary' }} />
        <Stack sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle2">{title}</Typography>
          {subtitle !== undefined && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {subtitle}
            </Typography>
          )}
        </Stack>
        {action}
      </Stack>

      <Divider />

      {/*
       * Spaced, because a section takes whatever blocks a caller hands it. Measured
       * without it: `rowGap: normal`, so a table and the block under it touched at
       * 0px — a footer survived on its own padding, an `Alert` read as glued to the
       * last row. The gap lives here rather than in each caller, for the same reason
       * the gap between two cards lives in their parent.
       */}
      <Stack spacing={2} useFlexGap sx={{ p: 2.5, flexGrow: 1 }}>
        {children}
      </Stack>
    </Card>
  )
}
