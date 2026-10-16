/**
 * The action column every list screen puts last.
 *
 * Actions are visible icon buttons, not a `⋮` menu: a menu costs one click and
 * one guess before the row can be acted on, and it hides which actions a row even
 * has. They are also the only clickable thing in a row — opening the record used
 * to be the row click, which made one click mean "open this" in one mode and
 * "type here" in the other.
 *
 * The column is MUI's own `type: 'actions'`, and that is not decoration. With a
 * hand-rolled `renderCell`, the first real click on a fresh screen was swallowed:
 * the first `mousedown` inside a cell moves the grid's cell focus, React flushes
 * that discrete update synchronously, the cell's children are re-created, and the
 * browser is left with no element to dispatch `click` to. Measured — `mousedown`
 * and `mouseup` arrived, `click` never did, and pre-focusing the cell made the
 * same click work. `GridActionsCell` owns focus and `tabIndex` for its buttons,
 * so the buttons survive that flush.
 *
 * Width is computed, never hand-set: a fixed 96px column sized for two buttons is
 * what put three buttons 1px outside the table. The gutter is counted to the ink,
 * so the glyphs line up with the first column's text rather than with the invisible
 * edge of a hit box.
 */

import { GridActionsCellItem } from '@mui/x-data-grid'
import type { GridColDef, GridRowParams, GridValidRowModel } from '@mui/x-data-grid'
import { Box, IconButton, Stack, Tooltip } from '@mui/material'
import Iconify from '@/components/iconify/Iconify'
import type { ActionIcon } from '@/components/iconify/icons'
import { CELL_GUTTER_PX } from '@/components/data-grid/ServerDataGrid'

/** `IconButton size="small"`: a 20px glyph drawn inside a 30px hit box. */
const BUTTON_BOX = 30

const BUTTON_INK = 20

/**
 * How far the buttons are pulled out of the cell's gutter.
 *
 * What a reader lines up is ink, not hit boxes. Measured against the card: the
 * first column's text starts 20px in, while the last glyph stopped 25px short,
 * because the button's own padding sits between the glyph and the gutter.
 */
const EDGE_SLACK = (BUTTON_BOX - BUTTON_INK) / 2

/**
 * `.MuiDataGrid-actionsCell` sets `gap: 8px`. Measured, not assumed: carrying over
 * the 4px of the hand-rolled `Stack` made the column 8px too narrow for three
 * buttons, and the glyphs sat 16px from the card edge against the text's 20px.
 */
const BUTTON_GAP = 8

/**
 * Between two small icon buttons under a finger: each 30px box answers a 44px
 * tap (theme), so 14px apart the targets meet instead of overlapping - a tap
 * between 수정 and 삭제 lands on the one it is nearer. A record dialog's `←`
 * and `✕` stand the same way (`RecordDialogNav`).
 */
export const TOUCH_GAP = 44 - BUTTON_BOX

const rowActionColumnWidth = (count: number) =>
  count * BUTTON_BOX + (count - 1) * BUTTON_GAP + 2 * (CELL_GUTTER_PX - EDGE_SLACK)

export interface RowAction {
  label: string
  icon: ActionIcon
  /**
   * A palette colour for the action, applied as `sx` rather than the button's
   * `color` prop: `GridActionsCellItem` narrows that prop to three values and
   * `error` is not among them, so the destructive action would lose its red.
   */
  tone?: 'primary' | 'error'
  /**
   * A verb this row cannot serve right now — run on a job already running, stop
   * on one that is not. Dead rather than hidden: a row whose buttons appear and
   * disappear moves the buttons beside them, so the pointer lands on the wrong
   * verb, and the reader cannot see that the action exists at all.
   */
  disabled?: boolean
  onClick: () => void
}

interface RowActionsColumnOptions<R extends GridValidRowModel> {
  /**
   * The largest number of buttons a row can show. An editing row shows its own
   * pair, so the column is sized for the maximum, not for the current mode.
   */
  count: number
  actions: (params: GridRowParams<R>) => RowAction[]
}

/** The action column, carrying its actions so a phone's card draws the same verbs. */
export type RowActionsColumn<R extends GridValidRowModel> = GridColDef<R> & {
  rowActions: RowActionsColumnOptions<R>['actions']
}

export function rowActionsColumn<R extends GridValidRowModel>({
  count,
  actions,
}: RowActionsColumnOptions<R>): RowActionsColumn<R> {
  return {
    field: 'actions',
    type: 'actions',
    headerName: '',
    width: rowActionColumnWidth(count),
    align: 'center',
    rowActions: actions,
    getActions: (params) =>
      actions(params).map((action) => (
        <GridActionsCellItem
          key={action.label}
          icon={
            // A glyph alone does not say which verb it is until hovered.
            <Tooltip title={action.label}>
              {/* A flex box: a block span put the inline glyph on a line box 5px taller than it, 2.5px above the button's centre. */}
              <Box component="span" sx={{ display: 'inline-flex' }}>
                <Iconify
                  name={action.icon}
                  sx={action.tone === undefined ? undefined : { color: `${action.tone}.main` }}
                />
              </Box>
            </Tooltip>
          }
          label={action.label}
          disabled={action.disabled ?? false}
          onClick={action.onClick}
        />
      )),
  }
}

/**
 * The same actions on a row of a plain `<Table>` — a nested collection inside a
 * detail dialog, where there is no grid to own the cell.
 *
 * `aria-label` carries the name and the glyph is decorative, so one row's actions
 * read the same to a screen reader whether they came from the grid or from here.
 */
export function RowActionButtons({ actions }: { actions: RowAction[] }) {
  return (
    <Stack
      direction="row"
      useFlexGap
      spacing={`${BUTTON_GAP}px`}
      justifyContent="flex-end"
      sx={{ '@media (pointer: coarse)': { gap: `${TOUCH_GAP}px` } }}
    >
      {actions.map((action) => (
        // The span holds the tooltip's events for a disabled button, which fires
        // none: MUI warned once per disabled action per render (40 on /batch).
        <Tooltip key={action.label} title={action.label}>
          <span>
            <IconButton
              size="small"
              aria-label={action.label}
              disabled={action.disabled ?? false}
              onClick={action.onClick}
              sx={action.tone === undefined ? undefined : { color: `${action.tone}.main` }}
            >
              <Iconify name={action.icon} />
            </IconButton>
          </span>
        </Tooltip>
      ))}
    </Stack>
  )
}

/** A plain `<TableCell size="small">`'s own side padding, which the buttons sit inside. */
const TABLE_CELL_GUTTER = 16

const buttonsWidth = (count: number, gap: number) =>
  count * BUTTON_BOX + (count - 1) * gap + 2 * TABLE_CELL_GUTTER

/**
 * The width of the cell `RowActionButtons` sits in: the pixels its buttons need
 * under the pointer in hand, never a share.
 *
 * A share is a guess about the table's width. Measured at 820 (a tablet, 668px
 * of table): the 10% share was 67px while two buttons 14px apart under a finger
 * need 106, so 상세 was drawn at x=654-684, outside its cell, under the 상태
 * cell beside it, and a tap on it did nothing. `max(10%, 106px)` is not an
 * answer either: a fixed table layout read it as the bare 10% (measured). In
 * pixels, the fixed layout takes them from the shares beside it, and on a wide
 * table the 10% the columns leave (`RECORD_ACTIONS_SHARE`, the record-dialog
 * check) is more than this.
 */
export function rowActionsCellSx(count: number) {
  return {
    width: buttonsWidth(count, BUTTON_GAP),
    '@media (pointer: coarse)': { width: buttonsWidth(count, TOUCH_GAP) },
  }
}
