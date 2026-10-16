/**
 * Component defaults, ported from the reference application's `theme/overrides`.
 *
 * This is where the design lives. Every value here was previously repeated in
 * component `sx` props — a card's radius, a dialog's shadow, a table header's
 * background — and repetition is how twelve cards end up with eleven radii. A
 * screen sets layout; the theme sets appearance.
 */

import '@mui/x-data-grid/themeAugmentation'
import { alpha } from '@mui/material/styles'
import type { Theme, Components } from '@mui/material/styles'
import { SELECT_MENU_MAX_HEIGHT } from '@/config'
import { GREY } from '@/theme/palette'

/** The base radius; a card doubles it, matching the reference application. */
export const BORDER_RADIUS = 8

/**
 * The smallest target a finger hits reliably (WCAG 2.5.5, Apple's 44pt).
 *
 * Under a coarse pointer a button's hit area grows to it with an `::after` that
 * reaches past the box by half the shortfall on each side, and by nothing once
 * the box is already that big. The drawn button keeps its desktop size - only
 * the area that answers a tap grows - so a phone gets the reach without the
 * density changing anywhere. A fixed `inset: -7px` was the first version: it
 * took a 30px button to 44 but a 36px header icon to 50, overlapping its
 * neighbour 4px away, and a 28px select toggle only to 42.
 */
export const TOUCH_TARGET = 44

/** A select's text line: MUI's `1.4375em` at the 14px body size. */
const SELECT_LINE = 20

export const TOUCH_REACH = `min(0px, calc((100% - ${TOUCH_TARGET}px) / 2))`

/**
 * The same reach for a link that is a line of text - a crumb, a record's
 * licence. Not on `MuiLink` itself: a link inside running prose would grow over
 * the lines above and below it and take their taps.
 */
export const TOUCH_REACH_SX = {
  position: 'relative',
  '@media (pointer: coarse)': {
    '&::after': { content: '""', position: 'absolute', inset: TOUCH_REACH },
  },
} as const

/**
 * An Autocomplete's clear and popup buttons under a finger. MUI shows the clear
 * only on focus or a fine pointer's hover, so a phone's box that held a value
 * had no visible way to empty it; and beside the popup arrow its 44px target
 * overlapped the arrow's, which - drawn later, on top - took the overlap
 * (measured: the × answered across 26px). Under a finger the clear is always
 * shown, and the two stand their reaches apart (MUI's own -2px margin on the
 * clear makes the 28px boxes meet exactly), the input's text stopping that much
 * earlier.
 */
const AUTOCOMPLETE_ICON = 26
const AUTOCOMPLETE_ICON_GAP = TOUCH_TARGET - AUTOCOMPLETE_ICON
/** MUI's own reserve for both icons in an outlined box: two icons, 4px between, 9px to the edge. */
const AUTOCOMPLETE_BOTH_ICONS = AUTOCOMPLETE_ICON * 2 + 4 + 9

export function componentOverrides(theme: Theme): Components<Theme> {
  return {
    MuiCssBaseline: {
      styleOverrides: {
        html: { WebkitFontSmoothing: 'antialiased', MozOsxFontSmoothing: 'grayscale' },
        '#root': { height: '100%' },
      },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          position: 'relative',
          boxShadow: theme.customShadows.card,
          borderRadius: BORDER_RADIUS * 2,
          zIndex: 0,
        },
      },
    },
    MuiCardHeader: {
      defaultProps: {
        titleTypographyProps: { variant: 'h6' },
        subheaderTypographyProps: { variant: 'body2', marginTop: theme.spacing(0.5) },
      },
      styleOverrides: { root: { padding: theme.spacing(3, 3, 0) } },
    },
    MuiCardContent: {
      styleOverrides: { root: { padding: theme.spacing(3) } },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        // A 36px button (a phone list's 필터, a sheet's reset) is a 44px target.
        root: {
          borderRadius: BORDER_RADIUS,
          '@media (pointer: coarse)': {
            '&::after': { content: '""', position: 'absolute', inset: TOUCH_REACH },
          },
        },
        sizeLarge: { height: 48 },
        // The neutral button inverts with the mode: near-black on white in light,
        // white on near-black in dark. `grey[800]` is the dark mode's card
        // surface, so a button that kept it would be the card's colour on the card.
        containedInherit:
          theme.palette.mode === 'dark'
            ? {
                color: theme.palette.grey[800],
                backgroundColor: theme.palette.common.white,
                '&:hover': { backgroundColor: theme.palette.grey[400] },
              }
            : {
                color: theme.palette.common.white,
                backgroundColor: theme.palette.grey[800],
                '&:hover': { backgroundColor: theme.palette.grey[700] },
              },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: alpha(GREY[500], 0.2),
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: theme.palette.text.primary,
          },
        },
      },
    },
    MuiTextField: {
      defaultProps: { size: 'small' },
    },
    // A keyboard reader sees where focus is: MUI draws no ring of its own, and
    // Tab moved focus across the shell with nothing on screen changing.
    MuiButtonBase: {
      styleOverrides: {
        root: {
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.palette.primary.main}`,
            outlineOffset: 2,
          },
        },
      },
    },
    // A 30px icon button is a 44px target under a finger: the hit area grows
    // past the glyph and the layout does not move.
    MuiIconButton: {
      styleOverrides: {
        root: {
          '@media (pointer: coarse)': {
            '&::after': { content: '""', position: 'absolute', inset: TOUCH_REACH },
          },
        },
      },
    },
    // A toggle is no MuiButton: measured 39x40 under a finger until it carried
    // the same reach by hand on each use (the inbox's 전체 / 안 읽음). Toggles abut
    // in a group, so a reach sideways would be taken by the neighbour drawn later:
    // the width is the box's own (`minWidth`), the height reaches out.
    MuiToggleButton: {
      styleOverrides: {
        root: {
          '@media (pointer: coarse)': {
            minWidth: TOUCH_TARGET,
            '&::after': { content: '""', position: 'absolute', inset: TOUCH_REACH },
          },
        },
      },
    },
    MuiDialog: {
      defaultProps: { fullWidth: true, maxWidth: 'sm' },
      styleOverrides: {
        paper: {
          boxShadow: theme.customShadows.dialog,
          borderRadius: BORDER_RADIUS * 2,
          '&.MuiDialog-paperFullScreen': { borderRadius: 0 },
          // A form dialog's `<form>` stands between the paper and its parts, so
          // the paper's own column (content scrolls, actions stay) passes through
          // it. Without it the whole form scrolled as one: on a phone the save,
          // and the discard question back raised, stood 9-154px under the window.
          '& > form': { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 },
          // A phone's dialog is the screen: a centred card 32px short of each
          // edge left a record's seven tabs 326px to scroll in, and its height
          // jumped with every tab. Only the confirm (`xs`) stays a card.
          [theme.breakpoints.down('sm')]: {
            '&:not(.MuiDialog-paperWidthXs)': {
              margin: 0,
              width: '100%',
              maxWidth: '100%',
              height: '100%',
              maxHeight: '100%',
              borderRadius: 0,
            },
          },
        },
      },
    },
    MuiDialogTitle: {
      styleOverrides: { root: { ...theme.typography.h6, padding: theme.spacing(3) } },
    },
    MuiDialogContent: {
      styleOverrides: { root: { borderTop: 0, borderBottom: 0 } },
    },
    MuiDialogActions: {
      styleOverrides: { root: { padding: theme.spacing(3) } },
    },
    // No scroll arrows: MUI shows them when the first or last tab is under 99%
    // inside the scroller, and a dialog re-centred on a fractional height put a
    // four-tab strip half a pixel off - both arrows lit over nothing to scroll.
    // A strip that does overflow (a phone) still scrolls by swipe.
    MuiTabs: {
      defaultProps: { textColor: 'inherit', variant: 'scrollable', scrollButtons: false },
    },
    MuiTab: {
      defaultProps: { disableRipple: true, iconPosition: 'start' },
      styleOverrides: {
        root: {
          padding: 0,
          opacity: 1,
          minWidth: 48,
          minHeight: 48,
          fontWeight: theme.typography.fontWeightMedium,
          // A phone's strip spaces tabs at 12px: at 24 the record dialog's tabs
          // ran past the screen, and at 16 four of them still overflowed 342px by 3.
          '&:not(:last-of-type)': {
            marginRight: theme.spacing(1.5),
            [theme.breakpoints.up('sm')]: { marginRight: theme.spacing(5) },
          },
          // MUI's own icon margin sat the glyph flush against the label.
          '& > .MuiTab-icon': { margin: 0, marginRight: theme.spacing(1) },
          '&:not(.Mui-selected)': { color: theme.palette.text.secondary },
        },
      },
    },
    // The rows-per-page select is 29px of text in a 52px toolbar: under a finger
    // it takes the toolbar's height instead, and nothing it sits beside moves.
    // The prev/next arrows are MUI's 40px icon buttons; measured 40×40 in the
    // 원재료 dialog at 390, four short of a finger - they take the target too.
    MuiTablePagination: {
      styleOverrides: {
        select: {
          '@media (pointer: coarse)': {
            paddingTop: (TOUCH_TARGET - SELECT_LINE) / 2,
            paddingBottom: (TOUCH_TARGET - SELECT_LINE) / 2,
          },
        },
        actions: {
          '@media (pointer: coarse)': {
            '& .MuiIconButton-root': { minWidth: TOUCH_TARGET, minHeight: TOUCH_TARGET },
          },
        },
      },
    },
    // MUI X's cell is a block whose one line is centred by a line height as tall
    // as the row, so anything else it holds (a chip, a stack of chips, a button
    // row) stood at the top: the notification rules' target chips measured 13px
    // above the row's centre. A flex cell centres whatever it holds, and the
    // column's own `justify-content` (numbers right, actions centre) still
    // places it across; a custom `renderCell` therefore sets no vertical
    // alignment of its own.
    MuiDataGrid: {
      styleOverrides: { cell: { display: 'flex', alignItems: 'center' } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          ...theme.typography.subtitle2,
          color: theme.palette.text.secondary,
          backgroundColor: theme.palette.background.neutral,
        },
      },
    },
    MuiAlert: {
      styleOverrides: {
        standardInfo: {
          backgroundColor: alpha(theme.palette.info.main, 0.16),
          color: theme.palette.info.dark,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: { paper: { borderRight: `1px dashed ${theme.palette.divider}` } },
    },
    MuiAutocomplete: {
      // The same bound as a select's menu: 40vh is a different height per screen.
      styleOverrides: {
        listbox: { maxHeight: SELECT_MENU_MAX_HEIGHT },
        root: {
          '@media (pointer: coarse)': {
            '& .MuiAutocomplete-clearIndicator': { visibility: 'visible' },
            '& .MuiAutocomplete-endAdornment': {
              display: 'flex',
              alignItems: 'center',
              columnGap: AUTOCOMPLETE_ICON_GAP,
            },
            '&.MuiAutocomplete-hasPopupIcon.MuiAutocomplete-hasClearIcon .MuiOutlinedInput-root': {
              paddingRight: AUTOCOMPLETE_BOTH_ICONS + AUTOCOMPLETE_ICON_GAP,
            },
          },
        },
      },
    },
    MuiSelect: {
      // Bounded, or a long vocabulary takes the viewport and leaves its box.
      defaultProps: { MenuProps: { PaperProps: { sx: { maxHeight: SELECT_MENU_MAX_HEIGHT } } } },
    },
    MuiPopover: {
      styleOverrides: {
        paper: {
          boxShadow: theme.customShadows.dropdown,
          borderRadius: Number(theme.shape.borderRadius) * 1.5,
        },
      },
    },
    MuiLink: {
      defaultProps: { underline: 'hover' },
    },
  }
}
