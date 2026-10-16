/**
 * The popover chrome every header menu wears, ported from the reference
 * application's `MenuPopover`.
 *
 * Two things make it read as a menu attached to its button rather than a floating
 * card: a small rotated square pointing at the button's bottom-right corner, and
 * items that are inset rounded rows instead of full-bleed strips. Both live here
 * so a second menu cannot quietly invent its own.
 *
 * The arrow hides below `sm`: on a phone the paper spans the viewport and a
 * pointer aimed at a button 200px away would point at nothing.
 *
 * Under a finger back closes the menu (`useBackCloses`). Measured before: back
 * with the bell, the language or the account menu open left the page under it.
 */

import { Popover, useMediaQuery } from '@mui/material'
import { alpha, styled } from '@mui/material/styles'
import type { PopoverProps } from '@mui/material'
import type { ReactNode } from 'react'
import { TOUCH_QUERY, useBackCloses } from '@/hooks/useBackCloses'

const ARROW_SIZE = 12

const ARROW_OFFSET = -(ARROW_SIZE / 2)

const ARROW_INSET = 20

const ITEM_RADIUS = 0.75

const ITEM_ICON_SIZE = 20

const StyledArrow = styled('span')(({ theme }) => {
  const border = `solid 1px ${alpha(theme.palette.grey[500], 0.12)}`

  return {
    display: 'none',
    [theme.breakpoints.up('sm')]: {
      zIndex: 1,
      width: ARROW_SIZE,
      height: ARROW_SIZE,
      content: "''",
      display: 'block',
      position: 'absolute',
      transform: 'rotate(-135deg)',
      background: theme.palette.background.paper,
      borderRadius: '0 0 3px 0',
      top: ARROW_OFFSET,
      right: ARROW_INSET,
      borderBottom: border,
      borderRight: border,
    },
  }
})

type MenuPopoverProps = Omit<PopoverProps, 'open' | 'anchorEl'> & {
  /** The element the menu hangs from; `null` closes it. */
  open: HTMLElement | null
  children: ReactNode
}

export default function MenuPopover({ open, children, sx, ...other }: MenuPopoverProps) {
  const touch = useMediaQuery(TOUCH_QUERY)
  // One name for every menu: two cannot be open at once.
  useBackCloses(open !== null, () => other.onClose?.({}, 'backdropClick'), 'menu', touch)

  return (
    <Popover
      open={open !== null}
      anchorEl={open}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      slotProps={{
        paper: {
          sx: {
            p: 1,
            ml: 0.75,
            width: 'auto',
            overflow: 'inherit',
            '& .MuiMenuItem-root': {
              px: 1,
              typography: 'body2',
              borderRadius: ITEM_RADIUS,
              '& svg': { mr: 2, width: ITEM_ICON_SIZE, height: ITEM_ICON_SIZE, flexShrink: 0 },
            },
            ...sx,
          },
        },
      }}
      {...other}
    >
      <StyledArrow />

      {children}
    </Popover>
  )
}
