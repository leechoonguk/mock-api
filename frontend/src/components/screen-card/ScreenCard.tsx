/**
 * The one surface a page's section draws: it fills the window under the page
 * header, as the card's width fills what the nav leaves.
 *
 * A flex column so what it holds can fill it in turn - a list's grid takes what
 * the card head leaves and scrolls its rows between a pinned column header and
 * pager. It grows from its content's floors (`1 0 auto`), never shrinks below
 * them, and never below `SCREEN.CARD_MIN_HEIGHT`: on a short window, or a phone
 * where the filter boxes stack, the shell's `main` scrolls rather than the grid
 * collapsing. That holds only while every region that scrolls inside it
 * contributes its floor, not its content: the grid sits on a `0px` basis and a
 * scrolling box on `height: 0` (a `0%` basis resolves against this card's
 * content-sized height and becomes the content again - measured, the chat card
 * grew to 3085px). A screen laid out in columns (the chat) turns the direction
 * with `sx`; the fill stays. On a phone a list's cards grow the card and `main`
 * scrolls them - one scroll under one thumb, not a box inside a scrolling page.
 */

import { Card } from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { ReactNode } from 'react'
import { SCREEN } from '@/config'

export default function ScreenCard({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  return (
    <Card
      sx={[
        {
          flex: '1 0 auto',
          minHeight: SCREEN.CARD_MIN_HEIGHT,
          display: 'flex',
          flexDirection: 'column',
          // `clip`, not `hidden`: `hidden` makes the card a scroll box, and a
          // pager sticks to the window's bottom only when no scroll box stands
          // between it and `main` - a phone list's (GridCardList), and a grid's
          // on a window too short for its floor (ServerDataGrid).
          overflow: 'clip',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Card>
  )
}
