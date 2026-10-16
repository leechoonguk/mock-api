/**
 * A detail dialog's child collection: one titled section, one add button, one
 * fixed-layout table, one footer.
 *
 * The two integration tabs were 83 of 118 lines identical — the same section
 * frame, the same empty sentence, the same `tableLayout: 'fixed'` head and body,
 * the same action cell, the same footer — differing only in which columns they
 * declare and which cells a row draws. That is duplication of the frame, not of
 * the data, so the frame lives here and the callers pass columns and cells.
 *
 * Not a grid: `ServerDataGrid` owns server paging, sorting, density and column
 * visibility for a whole page. This is a nested collection already in hand, drawn
 * as a plain table so a dialog does not carry a grid's chrome.
 *
 * A collection nobody writes from this side - a derived table's edges, rebuilt
 * nightly - passes no `onCreate` and no `actions`: the add button and the
 * actions column are then not drawn, rather than drawn disabled.
 */

import type { KeyboardEvent, MouseEvent, ReactNode } from 'react'
import ClippedText, { CLIPPED_TEXT_CLASS } from '@/components/clipped-text/ClippedText'
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import DetailSection from '@/components/detail/DetailSection'
import { RowActionButtons, rowActionsCellSx } from '@/components/data-grid/RowActions'
import type { RowAction } from '@/components/data-grid/RowActions'
import Iconify from '@/components/iconify/Iconify'
import type { ActionIcon } from '@/components/iconify/icons'
import { RECORD_SURFACE } from '@/config'
import { MIDDLE_BUTTON, useFollowRecord } from '@/hooks/useFollowRecord'
import type { TablePaging } from '@/hooks/useTablePage'
import type { RecordLink } from '@/hooks/useUrlDialog'
import type { Theme } from '@mui/material'
import { TOUCH_TARGET } from '@/theme/overrides'

/**
 * Declared shares, never `auto`: auto layout gave a code column 130px and wrapped
 * every value onto two lines, so one tab's row was 57px against the other's 37px.
 */
export interface TableColumn {
  key: string
  label: string
  /** A percentage, so the columns of two sibling tables read at the same rhythm. */
  width: string
  align?: 'left' | 'center' | 'right'
}

const ROW_HEIGHT = RECORD_SURFACE.TABLE_ROW_HEIGHT

/**
 * A row that opens something is a target, and under a finger it is as tall as
 * one: measured at 820 (a tablet), 원재료, 사용 제품 and the run log answered
 * a tap in 37px rows.
 */
export const OPENING_ROW_SX = { '@media (pointer: coarse)': { height: TOUCH_TARGET } } as const

/** A card row's line under a finger: the label beside its value, never shorter. */
const PHONE_LINE_HEIGHT = 32

/**
 * A detail table below `sm` reads as cards, one per row: each cell is a line
 * with its column's name on the left and the value whole on the right.
 *
 * Measured on a 390px phone before (232px at 320): six columns in 302px, so a
 * `GET` badge printed `(`, headers cut to `로.` and `ㄱ ㄱ :`, a date to `2..`,
 * and the operations tab's 상세 button was drawn at x=258–288 outside its 30px
 * cell, under the 필드 cell, so a tap on it did nothing. Seven tables had the
 * shape. Dropping columns per table hides the values a log has no other place
 * to show; a card keeps every value and lets each one wrap, and it is what the
 * list grid already becomes below `sm` (`GridCardList`).
 *
 * Pure CSS over the rows a caller already renders, so no tab changes: the head
 * is hidden and its labels are drawn by `::before` per cell position.
 * `leading` counts frame cells before the columns (the run log's chevron),
 * which keep no label and sit at the card's right edge. Every selector is
 * doubled (`&&`): the run log's clipping rule reads `& td:not(.expand-cell)`,
 * which outranks a single-class `& tbody td` and kept every value cut.
 */
export function phoneCardRows(columns: TableColumn[], leading = 0) {
  return (theme: Theme) => ({
    [theme.breakpoints.down('sm')]: {
      '&&, && tbody, && tbody tr, && tbody td': { display: 'block' },
      '&& thead': { display: 'none' },
      '&& tbody tr': {
        position: 'relative',
        height: 'auto',
        px: 1,
        py: 1,
        pr: leading > 0 ? 5 : 1,
        borderBottom: `1px solid ${theme.palette.divider}`,
      },
      '&& tbody td': {
        display: 'flex',
        // MUI's right-aligned cell sets `row-reverse`, which put the label after
        // its value and the actions at the left.
        flexDirection: 'row',
        alignItems: 'center',
        // The value keeps the right edge whether or not a label stands before
        // it: the actions cell has none, and `space-between` put its buttons left.
        justifyContent: 'flex-end',
        gap: 2,
        minHeight: PHONE_LINE_HEIGHT,
        px: 0,
        py: 0.25,
        border: 'none',
        whiteSpace: 'normal',
        overflow: 'visible',
        textAlign: 'right',
      },
      '&& tbody td::before': {
        flexShrink: 0,
        mr: 'auto',
        color: theme.palette.text.secondary,
        textAlign: 'left',
        ...theme.typography.body2,
      },
      '&& tbody td > *': { minWidth: 0 },
      [`&& tbody td .${CLIPPED_TEXT_CLASS}`]: { whiteSpace: 'normal', overflowWrap: 'anywhere' },
      ...Object.fromEntries(
        columns.map((column, index) => [
          `&& tbody td:nth-of-type(${index + leading + 1})::before`,
          { content: JSON.stringify(column.label) },
        ]),
      ),
      ...(leading > 0 && {
        [`&& tbody td:nth-of-type(-n+${leading})`]: {
          position: 'absolute',
          right: theme.spacing(1),
          top: '50%',
          transform: 'translateY(-50%)',
        },
      }),
    },
  })
}

interface PagedTableSectionProps<T> {
  /** The section's icon, the same vocabulary the tab strip uses. */
  icon: ActionIcon
  title: string
  onCreate?: () => void
  columns: TableColumn[]
  paging: TablePaging<T>
  rowKey: (row: T) => string
  /** The cells before the action cell, in the columns' order. */
  renderCells: (row: T) => ReactNode
  actions?: (row: T) => RowAction[]
  /**
   * A row that leads to another record opens it - by pointer and by Enter or
   * Space. `opens` says which rows lead anywhere; the rest stay plain.
   */
  onRowClick?: (row: T) => void
  opens?: (row: T) => boolean
  /**
   * A row that is a link to a record (`useUrlDialog`'s `linkTo`), or `null` for
   * one that leads nowhere: a click stacks it, a modifier or middle click
   * opens the record's own screen in a new tab.
   */
  rowLink?: (row: T) => RecordLink | null
  /** The line under the title: what the rows are, how many, in what order. */
  subtitle?: string
  /** The row the reader has chosen, drawn selected; a click on it is the caller's to read. */
  selected?: (row: T) => boolean
}

export default function PagedTableSection<T>({
  icon,
  title,
  onCreate,
  columns,
  paging,
  rowKey,
  renderCells,
  actions,
  onRowClick,
  opens,
  rowLink,
  subtitle,
  selected,
}: PagedTableSectionProps<T>) {
  const { t: tCommon } = useTranslation('common')
  const follow = useFollowRecord()
  const { visible, pagination, count } = paging

  return (
    <DetailSection
      name={icon}
      title={title}
      subtitle={subtitle}
      action={
        onCreate === undefined ? undefined : (
          <Button size="small" startIcon={<Iconify name="add" />} onClick={onCreate}>
            {tCommon('actions.add')}
          </Button>
        )
      }
    >
      {count === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {tCommon('messages.no_data')}
        </Typography>
      ) : (
        <Table
          size="small"
          sx={[
            {
              tableLayout: 'fixed',
              // Fixed shares alone do not clip: the long value — a path template on
              // every row — drew over the next two columns, and a code wrapped onto
              // a second line, making the row 57px against the declared 37. Every
              // cell carries a `title`, so clipped text stays readable on hover.
              '& th, & td': { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
            },
            phoneCardRows(columns),
          ]}
        >
          <TableHead>
            <TableRow sx={{ height: ROW_HEIGHT }}>
              {columns.map((column) => (
                <TableCell
                  key={column.key}
                  align={column.align}
                  sx={{ width: column.width }}
                >
                  <ClippedText text={column.label} />
                </TableCell>
              ))}
              {actions !== undefined && (
                <TableCell
                  align="right"
                  sx={rowActionsCellSx(Math.max(0, ...visible.map((row) => actions(row).length)))}
                />
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((row) => {
              const link = rowLink?.(row) ?? null
              const opening = link !== null || (onRowClick !== undefined && (opens?.(row) ?? true))
              const activate = (event?: MouseEvent | KeyboardEvent) => {
                if (link !== null) follow(link, event)
                else onRowClick?.(row)
              }
              return (
                <TableRow
                  key={rowKey(row)}
                  hover={opening}
                  selected={selected?.(row) ?? false}
                  {...(opening
                    ? {
                        tabIndex: 0,
                        onClick: (event: MouseEvent) => activate(event),
                        onAuxClick: (event: MouseEvent) => {
                          if (link !== null && event.button === MIDDLE_BUTTON) follow(link, event)
                        },
                        onKeyDown: (event: KeyboardEvent) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return
                          event.preventDefault()
                          activate()
                        },
                      }
                    : {})}
                  sx={{
                    height: ROW_HEIGHT,
                    cursor: opening ? 'pointer' : 'default',
                    ...(opening && OPENING_ROW_SX),
                  }}
                >
                  {renderCells(row)}
                  {actions !== undefined && (
                    // A button's click and its Enter are the button's: bubbling to a
                    // row that opens something ran the row's open after the action.
                    <TableCell
                      align="right"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <RowActionButtons actions={actions(row)} />
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {/* A table one page holds has no pages: the bar there was a row of dead controls. */}
      {count > pagination.rowsPerPage && (
        <TablePagination component="div" {...pagination} sx={[{ mt: 'auto' }, pagination.sx ?? {}]} />
      )}
    </DetailSection>
  )
}
