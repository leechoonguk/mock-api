/**
 * A list page as cards, for a phone.
 *
 * A grid on a 390px screen showed one and a half columns and scrolled sideways
 * under the reader's thumb: the 품목 보고 list's first row stood at y=753, under
 * the fold, and its name was clipped to four syllables. Below `sm` the same rows
 * read as one card each - the screen's chosen title, a few labelled fields, and
 * the row's own actions - and the pager is MUI's `TablePagination` in the same
 * words as the grid's.
 *
 * The cards read the grid's own columns: a field's caption is its `headerName`
 * and its value draws through the column's `renderCell` or `valueFormatter`,
 * so a badge or a formatted date reads the same in both layouts. There is no
 * sort control here; a reader who sorts does it on the grid, at `sm` and above.
 *
 * **One scroll, the window's.** On a desktop the rows scroll between a pinned
 * header and pager; on a phone that left the cards a 305px box inside a page
 * that itself scrolled 19-41px - two scrolls under one thumb, and the pager's
 * bottom 3-25px under the fold. So here the cards are the page: they add their
 * height to the card and the shell's `main` scrolls them, the page header
 * scrolls away, and the pager sticks to the bottom of the window (the card
 * clips with `overflow: clip`, which - unlike `hidden` - is no scroll box a
 * sticky child would stick inside). A page turn brings the first card back
 * under the header.
 *
 * **The pager fits the narrowest phone.** The full sentence (`1–20 / 전체
 * 1,856,644`), the 페이지당 행 label and MUI's 32px and 20px margins ran the next
 * arrow 31-49px past a 358px card, out of sight and out of reach. The label is
 * visually hidden (it still names the select), the numbers go without words,
 * and a total too long for one line wraps the arrows rather than scrolling them
 * away.
 */

import { useRef } from 'react'
import type { ReactNode } from 'react'
import {
  Box,
  Card,
  CardActionArea,
  LinearProgress,
  Stack,
  TablePagination,
  Typography,
} from '@mui/material'
import type { Theme } from '@mui/material'
import type {
  GridColDef,
  GridPaginationModel,
  GridRenderCellParams,
  GridRowParams,
  GridValidRowModel,
} from '@mui/x-data-grid'
import ClippedText from '@/components/clipped-text/ClippedText'
import DataGridEmptyOverlay from '@/components/data-grid/DataGridEmptyOverlay'
import { RowActionButtons } from '@/components/data-grid/RowActions'
import type { RowActionsColumn } from '@/components/data-grid/RowActions'
import { HEADER, MAIN_SPACING, PAGE_SIZE_OPTIONS } from '@/config'
import { PHONE_PAGER_SX, usePaginationLabels } from '@/hooks/usePaginationLabels'

/** A field caption's column: a five-syllable Korean caption stands on one line. */
const CAPTION_WIDTH = 80

/**
 * The phone pager: the compact footer every phone table shares
 * (`PHONE_PAGER_SX`), stuck to the window's bottom.
 */
const PAGER_SX = {
  ...PHONE_PAGER_SX,
  position: 'sticky',
  // `main` keeps a 16px bottom padding (`pb: 2` below lg), and a sticky box stops
  // that far short of the window: the cards showed through the strip under it.
  bottom: (theme: Theme) => `-${theme.spacing(2)}`,
  // Clear of an iPhone's home indicator, where the page reaches the screen's edge.
  pb: 'env(safe-area-inset-bottom)',
  zIndex: 1,
  bgcolor: 'background.paper',
  borderTop: 1,
  borderColor: 'divider',
  flexShrink: 0,
  overflow: 'visible',
} as const

/** Where a turned page leaves the list's top: under the fixed header, one gap below it. */
const TOP_UNDER_HEADER = HEADER.H_MOBILE + MAIN_SPACING

/** What a card shows: the field it is titled by, and the fields listed under it. */
export interface GridCardLayout {
  title: string
  fields: readonly string[]
}

interface GridCardListProps<R extends GridValidRowModel> {
  rows: R[]
  columns: GridColDef<R>[]
  card: GridCardLayout
  loading: boolean
  rowCount: number
  paginationModel: GridPaginationModel
  onPaginationModelChange: (model: GridPaginationModel) => void
  emptyTitle: string
  emptyAction?: { label: string; onClick: () => void }
  onRowClick?: (row: R) => void
}

export default function GridCardList<R extends GridValidRowModel>({
  rows,
  columns,
  card,
  loading,
  rowCount,
  paginationModel,
  onPaginationModelChange,
  emptyTitle,
  emptyAction,
  onRowClick,
}: GridCardListProps<R>) {
  const { labelRowsPerPage, labelDisplayedRowsCompact, getItemAriaLabel } = usePaginationLabels()
  const top = useRef<HTMLDivElement>(null)
  const actionsColumn = columns.find(
    (column): column is RowActionsColumn<R> => column.field === 'actions' && 'rowActions' in column,
  )

  return (
    <Box
      ref={top}
      sx={{ display: 'flex', flexDirection: 'column', flex: '1 0 auto', scrollMarginTop: TOP_UNDER_HEADER }}
    >
      <Box sx={{ height: 4 }}>{loading && <LinearProgress />}</Box>

      {rows.length === 0 && !loading ? (
        <DataGridEmptyOverlay title={emptyTitle} action={emptyAction} />
      ) : (
        <Stack spacing={1.5} sx={{ px: 2, py: 2, flex: '1 0 auto' }}>
          {rows.map((row) => {
            const body = (
              <Stack spacing={1} sx={{ p: 2 }}>
                <Typography variant="subtitle1" component="div" sx={{ minWidth: 0 }}>
                  {cellOf(row, columns.find((column) => column.field === card.title), card.title)}
                </Typography>
                {card.fields.map((field) => {
                  const column = columns.find((candidate) => candidate.field === field)
                  return (
                    <Stack key={field} direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, minWidth: CAPTION_WIDTH }}>
                        {column?.headerName ?? field}
                      </Typography>
                      <Box sx={{ minWidth: 0, typography: 'body2' }}>{cellOf(row, column, field)}</Box>
                    </Stack>
                  )
                })}
              </Stack>
            )
            return (
              // `flexShrink: 0`: in a column a card shrank to its 10px border and
              // clipped everything it held, buttons included.
              <Card key={String(row.id)} variant="outlined" sx={{ flexShrink: 0 }}>
                {onRowClick === undefined ? body : (
                  // `data-id`: a record closed after a visit elsewhere gives focus back here.
                  <CardActionArea data-id={String(row.id)} onClick={() => onRowClick(row)}>{body}</CardActionArea>
                )}
                {actionsColumn !== undefined && (
                  <Box sx={{ px: 1.5, pb: 1.5 }}>
                    <RowActionButtons
                      actions={actionsColumn.rowActions({ id: row.id, row } as unknown as GridRowParams<R>)}
                    />
                  </Box>
                )}
              </Card>
            )
          })}
        </Stack>
      )}

      <TablePagination
        component="div"
        count={rowCount}
        page={paginationModel.page}
        rowsPerPage={paginationModel.pageSize}
        rowsPerPageOptions={PAGE_SIZE_OPTIONS}
        onPageChange={(_event, page) => {
          // The next page starts at its first card, not where the thumb left the last one.
          const list = top.current
          if (list !== null && list.getBoundingClientRect().top < TOP_UNDER_HEADER) {
            list.scrollIntoView({ block: 'start' })
          }
          onPaginationModelChange({ ...paginationModel, page })
        }}
        onRowsPerPageChange={(event) =>
          onPaginationModelChange({ page: 0, pageSize: Number(event.target.value) })
        }
        labelRowsPerPage={labelRowsPerPage}
        labelDisplayedRows={labelDisplayedRowsCompact}
        getItemAriaLabel={getItemAriaLabel}
        sx={PAGER_SX}
      />
    </Box>
  )
}

/** One field of one row as its column would draw it in the grid. */
function cellOf<R extends GridValidRowModel>(row: R, column: GridColDef<R> | undefined, field: string): ReactNode {
  const raw: unknown = row[field]
  const value: unknown =
    column?.valueGetter === undefined
      ? raw
      : (column.valueGetter as (...args: unknown[]) => unknown)(raw, row, column, undefined)
  if (column?.renderCell !== undefined) {
    return column.renderCell({ row, value, field, formattedValue: value } as unknown as GridRenderCellParams<R>)
  }
  const text: unknown =
    column?.valueFormatter === undefined
      ? value
      : (column.valueFormatter as (...args: unknown[]) => unknown)(value, row, column, undefined)
  return <ClippedText text={text === null || text === undefined ? '' : String(text)} />
}
