/**
 * The one grid every list screen renders.
 *
 * It fixes what server pagination against this backend means: `paginationMode`
 * is always `server` and `rowCount` is the total the endpoint returned
 * (`Page<T>`), so the footer reads "1–20 of 240" on the first page. A screen
 * that renders `<DataGrid>` directly re-decides both, so
 * `check-frontend-screens` forbids it outside this file.
 *
 * Appearance and locale live here too — a neutral header strip, dividers under
 * cells, and MUI's own strings in the active language, so the footer never
 * leaves one English row inside a Korean screen. A row being edited carries the
 * amber `warning.lighter` wash: the row is the unit that saves, so the state
 * shown is "this row has unsaved changes", not "this cell has focus". MUI's own
 * editing style is a white cell with a shadow, which is invisible on a white
 * table, so the cell background is cleared for the row wash to show through.
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { alpha } from '@mui/material/styles'
import type { Theme } from '@mui/material/styles'
import { DataGrid, GridEditInputCell, GridRowEditStopReasons, GridRowModes } from '@mui/x-data-grid'
import type { GridApiCommunity } from '@mui/x-data-grid/internals'
import type {
  GridCellParams,
  GridColDef,
  GridRowParams,
  GridDensity,
  GridRenderCellParams,
  GridRenderEditCellParams,
  GridPaginationModel,
  GridSortModel,
  GridRowModesModel,
  GridValidRowModel,
} from '@mui/x-data-grid'
import { useMediaQuery } from '@mui/material'
import { MAIN_SPACING, PAGE_SIZE_OPTIONS, SCREEN } from '@/config'
import ClippedText, { CLIPPED_LINES_CLASS } from '@/components/clipped-text/ClippedText'
import DataGridEmptyOverlay from '@/components/data-grid/DataGridEmptyOverlay'
import RowEditDialog from '@/components/dialog/RowEditDialog'
import GridCardList from '@/components/data-grid/GridCardList'
import type { GridCardLayout } from '@/components/data-grid/GridCardList'
import { usePagerFocus } from '@/hooks/usePagerFocus'
import type { HistoryMode } from '@/hooks/useSearchParamWriter'

/**
 * The horizontal gutter every cell and header carries, in theme spacing units.
 * A column whose width is computed from its content — the action column — has to
 * add this twice, so it is exported in pixels rather than retyped there: a
 * gutter that disagrees with the grid is how content ends up outside the table.
 */
const CELL_GUTTER = 2.5

export const CELL_GUTTER_PX = CELL_GUTTER * 8

/** The edge bar's width: the state has to survive a screenshot in greyscale. */
const EDIT_MARKER_PX = 3

/**
 * "This row is being edited", for the grid and for a plain `<TableRow>` that
 * edits in place the same way.
 *
 * Not `warning`: amber is this palette's caution — a delete panel's alert, a
 * field whose mapping the server would reject — and a row someone chose to edit
 * is not a caution. Spending the caution colour on an ordinary action leaves
 * nothing louder for a real one. The bar carries the state without hue, so the
 * row survives greyscale and colour-blind vision (WCAG 1.4.1).
 */
export const EDITING_ROW_SX = {
  bgcolor: (theme: Theme) => alpha(theme.palette.primary.main, 0.08),
  boxShadow: (theme: Theme) => `inset ${EDIT_MARKER_PX}px 0 0 0 ${theme.palette.primary.main}`,
} as const

const BASE_SX = {
  border: 'none',
  // The grid fills what its `ScreenCard` leaves under the card head: the column
  // header and the pager stay on screen and the rows scroll between them. Sized
  // to its rows (`autoHeight`, deprecated by MUI X) the pager left the window
  // on any page larger than the screen. A `0px` basis, not `flex: 1`'s `0%`:
  // inside a card sized by its content a percentage basis becomes the content
  // (measured: a ten-row grid held 629px and the card ran past the window).
  flex: '1 1 0px',
  minHeight: SCREEN.GRID_MIN_HEIGHT,
  '& .MuiDataGrid-columnHeader': { px: CELL_GUTTER, bgcolor: 'background.neutral' },
  '& .MuiDataGrid-columnHeaderTitle': { typography: 'subtitle2', color: 'text.secondary' },
  '& .MuiDataGrid-cell': { px: CELL_GUTTER, borderBottom: '1px solid', borderColor: 'divider' },
  // MUI centres a cell's one line with a line height of the whole row (51px),
  // so a value given two lines stood 102px tall in a 52px row. Its own text
  // line height puts both lines inside the row.
  [`& .MuiDataGrid-cell .${CLIPPED_LINES_CLASS}`]: { typography: 'body2' },
  // MUI closes each row with an empty filler cell that holds no value and is
  // meant to take whatever width is left - zero when the columns already fill
  // the row. It is a `.MuiDataGrid-cell` too, so the gutter above gave it a
  // 40px floor it could not shrink below, and every grid in the app reported
  // 40px of content past its own width: a horizontal scrollbar offering empty
  // space. Measured on /batch: virtualScroller 1,120 wide inside 1,080.
  '& .MuiDataGrid-cellEmpty': { px: 0 },
  // MUI X rings the focused cell on `:focus-within`, so clicking a row's pencil
  // drew a second rectangle around the action buttons while the row already said
  // it was editing. The ring is kept for keyboards, where it is the only cue that
  // says which cell arrow keys will act on, and dropped for the pointer that aimed.
  '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': { outline: 'none' },
  '& .MuiDataGrid-cell:focus-visible': {
    outline: 'solid 1px',
    outlineColor: 'primary.main',
    outlineOffset: '-1px',
  },
  '& .MuiDataGrid-cell button:focus-visible': {
    outline: 'solid 2px',
    outlineColor: 'primary.main',
    outlineOffset: 2,
  },
  '& .MuiDataGrid-row--editing, & .MuiDataGrid-row--editing:hover': EDITING_ROW_SX,
  // MUI's editing style is a white cell with a shadow, invisible on a white table.
  '& .MuiDataGrid-row--editing .MuiDataGrid-cell': { bgcolor: 'transparent', boxShadow: 'none' },
  /**
   * Every editable cell carries the same underline, drawn here rather than by
   * each column's editor.
   *
   * A cell has no border of its own to say "type here", and MUI's default input
   * has none either: the row wash said the *row* was open while nothing said
   * which cells took a value. Per-column editors would each redraw it and drift
   * — the user list's password cell already had an underline the columns beside
   * it did not.
   *
   * Three states, all from the palette: resting is the table's own divider,
   * focus is the primary that marks the row, invalid is the error colour the
   * blocked save names in words.
   */
  '& .MuiDataGrid-cell--editing .MuiInputBase-input': {
    borderBottom: '1px solid',
    borderColor: 'divider',
    transition: (theme: Theme) => theme.transitions.create('border-color'),
  },
  '& .MuiDataGrid-cell--editing .MuiInputBase-root.Mui-focused .MuiInputBase-input': {
    borderColor: 'primary.main',
  },
  '& .MuiDataGrid-cell--editing .MuiInputBase-root.Mui-error .MuiInputBase-input': {
    borderColor: 'error.main',
  },
  '& .MuiDataGrid-columnSeparator': { display: 'none' },
  // A header's column menu button waits at zero width until hovered, and the
  // 28px button inside overflowed it: on the last column it hung 13px past the
  // grid, and every list scrolled sideways by that much (measured: 1093 in
  // 1080 on the report and business lists at 1440, 1161 in 1148 at 1180).
  '& .MuiDataGrid-menuIcon': { overflow: 'hidden' },
  '& .MuiDataGrid-footerContainer': { borderTop: '1px solid', borderColor: 'divider' },
} as const

/**
 * The grid on a window too short for its floor: sized to its rows, so `main`
 * is the only vertical scroll, with the pager held at the window's bottom.
 */
const PAGE_SCROLLS_SX = {
  flex: '0 0 auto',
  minHeight: 0,
  // MUI's root is `height: 100%`, of a card whose height is the head plus this
  // grid: the grid came out the card's height and ran the head's 234px past it,
  // pager and all, behind the card's clip.
  height: 'auto',
  // `clip`, not MUI's `hidden`: a box that hides its overflow is a scroll box,
  // and the pager would stick to it - which never scrolls - instead of `main`.
  '&, & .MuiDataGrid-mainContent': { overflow: 'clip' },
  // The column header is MUI's sticky row, pinned inside the grid's own
  // scroller - which in this mode never scrolls, so the header went up with the
  // page (measured at 1280x720 on 품목 보고: 388 -> -445 over the scroll). With
  // no scroll box left between it and `main`, it sticks under the app's fixed
  // header instead, as the pager sticks to the window's bottom. Neither box
  // scrolls sideways here: the folding keeps every column inside the width.
  // `!important` against the scroller's inline `overflow-x: hidden`, which MUI
  // writes and which turns a `clip` beside it back into `hidden`.
  '& .MuiDataGrid-main': { overflow: 'clip' },
  '& .MuiDataGrid-virtualScroller': { overflow: 'clip !important' },
  // A sticky offset counts from `main`'s content edge, which sits the fixed
  // header and `MAIN_SPACING` down: back by the spacing is flush under the
  // header at every width (measured with the header's height instead: 80px low).
  '& .MuiDataGrid-topContainer': { top: -MAIN_SPACING, zIndex: 3 },
  '& .MuiDataGrid-footerContainer': {
    position: 'sticky',
    bottom: 0,
    zIndex: 2,
    bgcolor: 'background.paper',
  },
} as const

/**
 * A text cell's editor that hands each keystroke to the grid as it is typed.
 *
 * MUI's own waits 200ms, and in that window the cell shows a value of its own;
 * when any *other* cell of the row commits, the grid re-runs every column's
 * `preProcessEditCellProps` and the waiting cell is reset to what the grid
 * holds - nothing, on a cell typed into for the first time. Measured on the user
 * list: `zzprobe3@example.com` typed straight after leaving 사용자명 was saved
 * as `3@example.com`, the keys of the first ~150ms gone. With no wait, the
 * grid always holds what the cell shows, so the reset changes nothing.
 */
const typedAtOnce = (params: GridRenderEditCellParams) => <GridEditInputCell {...params} debounceMs={0} />

/** The column types whose MUI editor is that input cell. */
const TYPED_COLUMN = new Set([undefined, 'string', 'number'])

/**
 * A column's place in the order the grid folds columns away when its width
 * cannot hold every floor - the `priority` of a screen's `COLUMN` table. `0` is
 * the record's identity and never folds; above it, the largest number folds
 * first. A column the table does not name (the actions column) never folds.
 *
 * `lines` lets a text column wrap to that many lines before it clips, for an
 * identity that can outgrow any share the row can give it (a batch's code).
 */
export type ColumnPriorities = Record<string, { priority: number; lines?: number }>

/**
 * The classic scrollbar's thickness here: 15px under a mouse, 0 where the
 * platform overlays it (a touch screen, macOS by default). Measured once, the
 * way MUI measures its own, and spent off the budget whether or not the rows
 * overflow - a budget that grew when the scrollbar left would show a column,
 * overflow, bring the scrollbar back and fold it again.
 */
let scrollbarPx: number | null = null

function scrollbarSize(): number {
  if (scrollbarPx !== null) return scrollbarPx
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;top:-9999px;width:100px;height:100px;overflow:scroll'
  document.body.appendChild(probe)
  scrollbarPx = probe.offsetWidth - probe.clientWidth
  probe.remove()
  return scrollbarPx
}

/** What a column asks of the row at its narrowest: its floor, or its fixed width. */
const columnFloor = (column: GridColDef) =>
  column.flex === undefined || column.flex === 0
    ? Math.max(column.width ?? 100, column.minWidth ?? 0)
    : (column.minWidth ?? 50)

/**
 * The columns that fold so the rest fit `width`, lowest priority first.
 *
 * A column the reader turned on in the column chooser (`model[field] === true`)
 * stays: they asked for it, and a sideways scroll is the price they chose. While
 * a row is being edited its editable columns stay too - a field that cannot be
 * seen cannot be filled, and a new user without a password cell cannot be made.
 */
function foldedColumns(
  columns: GridColDef[],
  priorities: ColumnPriorities,
  model: Record<string, boolean>,
  width: number | null,
  editing: boolean,
): string[] {
  if (width === null) return []
  const shown = columns.filter((column) => model[column.field] !== false)
  let need = shown.reduce((sum, column) => sum + columnFloor(column), 0)
  const foldable = shown
    .filter((column) => (priorities[column.field]?.priority ?? 0) > 0)
    .filter((column) => model[column.field] !== true)
    .filter((column) => !(editing && column.editable === true))
    .sort((a, b) => priorities[b.field].priority - priorities[a.field].priority)
  const folded: string[] = []
  for (const column of foldable) {
    if (need <= width) break
    folded.push(column.field)
    need -= columnFloor(column)
  }
  return folded
}

/**
 * How long a wheel gesture keeps the axis it started on. A trackpad swipe is a
 * stream of events ~16ms apart; a pause longer than this is a new gesture.
 */
const AXIS_HOLD_MS = 150

/** A wheel delta in pixels, whatever unit the device reported it in. */
const wheelPixels = (delta: number, mode: number, page: number) =>
  mode === WheelEvent.DOM_DELTA_LINE ? delta * 16 : mode === WheelEvent.DOM_DELTA_PAGE ? delta * page : delta

/**
 * Whatever scrolls the rows vertically: the grid itself, or - on a window too
 * short for its floor, where the grid takes its rows' height - `main`.
 */
function verticalScroller(scroller: HTMLElement): HTMLElement {
  if (scroller.scrollHeight > scroller.clientHeight + 1) return scroller
  return scroller.closest<HTMLElement>('main') ?? scroller
}

/**
 * One axis per wheel gesture, on a grid that still scrolls both ways.
 *
 * A trackpad swipe is never perfectly straight, and a scroller that overflows
 * on both axes follows the drift: the rows slid diagonally under the reader
 * (reported as queasy). The first event of a gesture picks the axis its larger
 * delta is on - a tie reads as vertical, the way a list is read - and the
 * gesture keeps it until it pauses. An event already on one axis is the
 * browser's to scroll, so it still chains to the page at the grid's end, and
 * shift+wheel stays the platform's horizontal scroll.
 *
 * A finger is not handled here: hijacking `touchmove` drops the platform's
 * momentum, so a touch grid is kept from overflowing sideways by the folding
 * above instead.
 */
function useWheelAxisLock(root: RefObject<HTMLDivElement | null>, mounted: boolean) {
  useEffect(() => {
    const element = root.current
    if (element === null) return undefined
    let axis: 'x' | 'y' | null = null
    let last = 0
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey) return
      const target = event.target instanceof Element ? event.target : null
      const scroller = target?.closest<HTMLElement>('.MuiDataGrid-virtualScroller') ?? null
      if (scroller === null || scroller.scrollWidth <= scroller.clientWidth + 1) return
      if (event.timeStamp - last > AXIS_HOLD_MS) axis = null
      last = event.timeStamp
      const dx = wheelPixels(event.deltaX, event.deltaMode, scroller.clientWidth)
      const dy = wheelPixels(event.deltaY, event.deltaMode, scroller.clientHeight)
      axis ??= Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
      if ((axis === 'x' ? dy : dx) === 0) return
      event.preventDefault()
      if (axis === 'x') scroller.scrollLeft += dx
      else verticalScroller(scroller).scrollTop += dy
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [root, mounted])
}

interface ServerDataGridProps<R extends GridValidRowModel> {
  rows: R[]
  columns: GridColDef<R>[]
  /**
   * The screen's `COLUMN` table, read for each column's `priority`: below the
   * width that holds every floor, the grid folds the lowest-priority columns
   * rather than scroll sideways (rule://frontend-screens, Column Width).
   */
  priorities: ColumnPriorities
  loading: boolean
  rowCount: number
  emptyTitle: string
  localeText: Record<string, unknown>
  paginationModel: GridPaginationModel
  /** `replace` only for the grid's own correction (a page past the end); a reader's page pushes. */
  onPaginationModelChange: (model: GridPaginationModel, history?: HistoryMode) => void
  /**
   * The header's sort is the server's: one column at a time, sent as `sort`
   * and `order`, and the page comes back already in that order. A grid that
   * sorted the loaded page itself showed ten rows in order and called it the
   * collection (measured on every list before the model was wired through).
   */
  sortModel: GridSortModel
  onSortModelChange: (model: GridSortModel) => void
  /**
   * True while the page in flight has not landed: the bar and the dimmed rows.
   * It locks nothing. A pager disabled for that window dropped the focus it
   * held to `<body>` 80ms after Enter, so a keyboard reader's second Enter
   * paged nothing (measured on five lists at 1440, 820 and 390). A second page
   * asked before the first lands is a second query key, and the rows and the
   * total shown are the newest key's - the older answer fills its own cache
   * entry and nothing on screen - so the race a lock closed is closed already.
   */
  density: GridDensity
  columnVisibilityModel: Record<string, boolean>
  onColumnVisibilityModelChange: (model: Record<string, boolean>) => void
  /**
   * Row editing, when a screen edits in place instead of in a dialog. The props
   * are pass-through on purpose: `editMode` is always `row` here, because a
   * half-edited row that saves one cell at a time would send one PUT per cell to
   * an endpoint that takes the whole resource.
   */
  rowModesModel?: GridRowModesModel
  onRowModesModelChange?: (model: GridRowModesModel) => void
  /**
   * The grid's own api, for a screen that has to read a row *while* it is being
   * edited — validating on save is the case: the pending values live in the
   * grid's edit state, not in `rows`, so a screen without this can only watch
   * the commit silently fail.
   */
  apiRef?: RefObject<GridApiCommunity | null>
  processRowUpdate?: (updated: R, original: R) => Promise<R> | R
  /**
   * Which cells the caller may type into, when that depends on the row - an
   * account is its owner's to edit and an admin's, never another user's.
   * A column's `editable` still says which cells *can* be edited at all.
   */
  isCellEditable?: (params: GridCellParams<R>) => boolean
  onProcessRowUpdateError?: (error: unknown) => void
  /**
   * The row as a door. A derived list opens its record dialog from the row
   * itself; a list that edits in place may carry one too, because the door is
   * guarded here rather than by each screen — see `handleRowClick`. The pointer
   * says so while the prop is set.
   */
  onRowClick?: (row: R) => void
  /**
   * How a row reads as a card below `sm`. A screen that names it gets cards on
   * a phone - a grid at 390px showed one and a half columns - and the grid back
   * the moment a row is edited, because editing happens in the grid's cells.
   */
  card?: GridCardLayout
  /** The empty state's one way out: clear the filters, or add the first row. */
  emptyAction?: { label: string; onClick: () => void }
}

function ServerDataGridImpl<R extends GridValidRowModel>({
  rows,
  columns,
  priorities,
  loading,
  rowCount,
  emptyTitle,
  localeText,
  paginationModel,
  onPaginationModelChange,
  sortModel,
  onSortModelChange,
  density,
  columnVisibilityModel,
  onColumnVisibilityModelChange,
  rowModesModel,
  onRowModesModelChange,
  apiRef,
  processRowUpdate,
  isCellEditable,
  onProcessRowUpdateError,
  onRowClick,
  card,
  emptyAction,
}: ServerDataGridProps<R>) {
  const EmptyOverlay = useCallback(
    () => <DataGridEmptyOverlay title={emptyTitle} action={emptyAction} />,
    [emptyTitle, emptyAction],
  )
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'))
  const editing = Object.values(rowModesModel ?? {}).some((model) => model.mode === GridRowModes.Edit)

  /**
   * A clipped value is unreadable until it is hovered, so every text column draws
   * through `ClippedText`, which attaches a real tooltip when the text overflows.
   *
   * The native `title` attribute was the first attempt: the browser draws that
   * tooltip in its own chrome, nothing in the DOM proves it appeared, and from the
   * screen it did not. The wrapper is injected here rather than written per column,
   * because a column that forgets it is a value a reader cannot reach and nothing
   * says so.
   *
   * Skipped where a tooltip would be wrong: a column that renders its own cell (it
   * owns what hovering means — a badge, a count, a switch) and MUI's own
   * `type: 'actions'` column, whose buttons carry their own labels.
   */
  const titled = useMemo(
    () =>
      columns
        .map((column) =>
          column.editable === true && column.renderEditCell === undefined && TYPED_COLUMN.has(column.type)
            ? { ...column, renderEditCell: typedAtOnce }
            : column,
        )
        .map((column) =>
          column.renderCell !== undefined || column.type === 'actions'
            ? column
            : {
                ...column,
                // MUI's text cell stands its value at the top of a block; two
                // lines are centred in the row as one is.
                ...(priorities[column.field]?.lines === undefined ? {} : { display: 'flex' as const }),
                renderCell: (params: GridRenderCellParams<R>) => {
                  const text = params.formattedValue ?? params.value
                  return (
                    <ClippedText
                      text={text === null || text === undefined ? '' : String(text)}
                      lines={priorities[column.field]?.lines}
                    />
                  )
                },
              },
        ),
    [columns, priorities],
  )

  /**
   * The grid's own width, read before paint so a narrow screen never draws the
   * columns it is about to fold.
   */
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = rootRef.current
    if (element === null) return undefined
    const measure = () => setWidth(element.clientWidth - scrollbarSize())
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [phone, card])
  useWheelAxisLock(rootRef, !(phone && card !== undefined))

  /**
   * One vertical scroll per screen. The grid fills what `main` leaves under the
   * page header and the card head, and scrolls its rows there; when what is
   * left is under the grid's floor, `main` would scroll the card *and* the grid
   * its rows inside it - two scrolls under one wheel (measured at 1280x720 on
   * seven lists: 808px of rows in a 288px window inside a scrolling page). So
   * below the floor the grid stops scrolling: it takes its rows' height, `main`
   * is the one scroll, and the pager sticks to the window's bottom, as a phone's
   * cards do. What is left is `main`'s height less what stands above the grid
   * and `main`'s foot - read off positions, not off `main`'s scroll height,
   * which is the grid's own height again in one mode and its floor in the
   * other: decided that way it flipped every few hundred ms (measured at
   * 1280x600 on the 품목 보고 list).
   */
  const [pageScrolls, setPageScrolls] = useState(false)
  useLayoutEffect(() => {
    const element = rootRef.current
    const main = element?.closest('main') ?? null
    if (element === null || main === null) return undefined
    const decide = () => {
      const above = element.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
      const below = parseFloat(getComputedStyle(main).paddingBottom)
      setPageScrolls(main.clientHeight - above - below < SCREEN.GRID_MIN_HEIGHT)
    }
    decide()
    const observer = new ResizeObserver(decide)
    observer.observe(main)
    observer.observe(element)
    if (element.parentElement !== null) observer.observe(element.parentElement)
    return () => observer.disconnect()
  }, [phone, card])

  const folded = useMemo(
    () => foldedColumns(columns as GridColDef[], priorities, columnVisibilityModel, width, editing),
    [columns, priorities, columnVisibilityModel, width, editing],
  )
  const shownModel = useMemo(
    () =>
      folded.length === 0
        ? columnVisibilityModel
        : { ...columnVisibilityModel, ...Object.fromEntries(folded.map((field) => [field, false])) },
    [columnVisibilityModel, folded],
  )
  /**
   * The chooser answers with the whole model, folded columns included as
   * `false`. Those are the width's, not the reader's, so they leave the model
   * the screen keeps unless the reader had said something about them already;
   * one the reader turns on arrives as `true` (or, from "show all", as no
   * entry) and stays on.
   */
  const handleColumnVisibilityModelChange = useCallback(
    (model: Record<string, boolean>) => {
      const chosen = { ...model }
      // Nothing hidden is every column asked for - "show all", or the last
      // hidden one ticked - so none of them folds until the reader hides one.
      if (folded.length > 0 && !Object.values(model).includes(false)) {
        onColumnVisibilityModelChange(Object.fromEntries(columns.map((column) => [column.field, true])))
        return
      }
      for (const field of folded) {
        if (chosen[field] === false && columnVisibilityModel[field] === undefined) delete chosen[field]
        // MUI's "show all" deletes a column's entry rather than writing `true`;
        // on a folded column the deletion is the reader's turning it on.
        else if (!(field in chosen)) chosen[field] = true
      }
      onColumnVisibilityModelChange(chosen)
    },
    [folded, columns, columnVisibilityModel, onColumnVisibilityModelChange],
  )

  const slots = useMemo(
    () => ({ noRowsOverlay: EmptyOverlay, noResultsOverlay: EmptyOverlay }),
    [EmptyOverlay],
  )

  /**
   * A click lands on exactly one meaning.
   *
   * Two collisions make that a guard rather than a prop the screen passes
   * through. A row being typed into must not answer a click with a dialog — the
   * pointer is there to reach a cell — so a row in edit mode has no door. And a
   * click inside the actions cell belongs to the button under it: MUI reports a
   * row click for it too, so opening a record on the way to `삭제` would put a
   * dialog over the confirm.
   */
  const handleRowClick = useCallback(
    (params: GridRowParams<R>, event: { target: EventTarget | null }) => {
      if (onRowClick === undefined) return
      if (rowModesModel?.[params.id]?.mode === GridRowModes.Edit) return
      const target = event.target instanceof Element ? event.target : null
      if (target !== null && target.closest('[data-field="actions"]') !== null) return
      onRowClick(params.row)
    },
    [onRowClick, rowModesModel],
  )

  /**
   * The door has a key. A keyboard reader reaches a row's cell with the arrows
   * and had no way through it (measured: Enter on a focused 품목 보고 cell did
   * nothing). Enter or Space on a cell that edits nothing opens the row, under
   * the same guards as the click; on a cell that edits, Enter is MUI's own and
   * starts the row's editor, as it always did.
   */
  const handleCellKeyDown = useCallback(
    (params: GridCellParams<R>, event: { key: string; defaultMuiPrevented?: boolean; preventDefault: () => void }) => {
      if (onRowClick === undefined) return
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (params.cellMode !== 'view' || params.isEditable === true || params.field === 'actions') return
      if (rowModesModel?.[params.id]?.mode === GridRowModes.Edit) return
      event.defaultMuiPrevented = true
      event.preventDefault()
      onRowClick(params.row)
    },
    [onRowClick, rowModesModel],
  )

  /**
   * A page in flight over rows already shown dims them: the rows stay where the
   * reader's eye is, and the dim says they are about to change.
   */
  const refreshing = loading && rows.length > 0

  // MUI hands its own details as a second argument, which is not a history mode.
  const handlePaginationModelChange = useCallback(
    (model: GridPaginationModel) => onPaginationModelChange(model),
    [onPaginationModelChange],
  )
  // The last page's arrow, disabled under the keyboard, hands its focus to a live one.
  usePagerFocus()

  /**
   * A page past the end lands on the last one. `?page=5` over 42 rows (a link
   * kept from before a filter narrowed, a page typed) printed the empty state
   * under a footer saying `41–42 / 전체 42`. Once the total is in, the URL is
   * corrected in place - replaced, because the reader asked for no step.
   */
  const lastPage = Math.max(0, Math.ceil(rowCount / paginationModel.pageSize) - 1)
  const pastTheEnd = !loading && rowCount > 0 && paginationModel.page > lastPage
  useEffect(() => {
    if (pastTheEnd) onPaginationModelChange({ ...paginationModel, page: lastPage }, 'replace')
  }, [pastTheEnd, lastPage, paginationModel, onPaginationModelChange])

  const sx = useMemo(
    () => ({
      ...BASE_SX,
      ...(onRowClick === undefined ? {} : { '& .MuiDataGrid-row': { cursor: 'pointer' } }),
      ...(pageScrolls ? PAGE_SCROLLS_SX : {}),
      ...(refreshing
        ? {
            '& .MuiDataGrid-virtualScrollerContent': {
              opacity: 0.48,
              transition: (theme: Theme) => theme.transitions.create('opacity'),
            },
          }
        : {}),
    }),
    [onRowClick, refreshing, pageScrolls],
  )

  if (phone && card !== undefined) {
    /**
     * A phone edits in a form over the cards, never in the desktop grid: the
     * grid was 783px in 358 with save and cancel a 425px scroll away. The form
     * saves through the screen's `processRowUpdate` and cancels the way the
     * grid's Escape does, so a draft leaves exactly as it does on a desktop.
     */
    const editedRow = editing
      ? rows.find((row) => rowModesModel?.[row.id as string]?.mode === GridRowModes.Edit)
      : undefined
    // The grid's two steps, said here because no grid is mounted to say them:
    // the stop, then the model without the row once nothing edits it.
    const endEdit = (id: string, ignoreModifications: boolean) => {
      const { [id]: ended, ...rest } = rowModesModel ?? {}
      onRowModesModelChange?.({
        ...rest,
        [id]: { ...ended, mode: GridRowModes.View, ...(ignoreModifications ? { ignoreModifications } : {}) },
      })
      onRowModesModelChange?.(rest)
    }
    return (
      <>
        <GridCardList
          rows={rows}
          columns={columns}
          card={card}
          loading={loading}
          rowCount={rowCount}
          paginationModel={paginationModel}
          onPaginationModelChange={handlePaginationModelChange}
          emptyTitle={emptyTitle}
          emptyAction={emptyAction}
          onRowClick={onRowClick}
        />
        {editedRow !== undefined && processRowUpdate !== undefined && (
          <RowEditDialog
            key={String(editedRow.id)}
            row={editedRow}
            columns={columns}
            onSave={async (updated, original) => {
              try {
                await processRowUpdate(updated, original)
                endEdit(String(editedRow.id), false)
              } catch (error) {
                onProcessRowUpdateError?.(error)
              }
            }}
            onCancel={() => endEdit(String(editedRow.id), true)}
          />
        )}
      </>
    )
  }

  return (
    <DataGrid
      ref={rootRef}
      rows={rows}
      columns={titled}
      loading={loading}
      paginationMode="server"
      sortingMode="server"
      sortModel={sortModel}
      onSortModelChange={onSortModelChange}
      rowCount={rowCount}
      paginationModel={paginationModel}
      onPaginationModelChange={handlePaginationModelChange}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      localeText={localeText}
      density={density}
      columnVisibilityModel={shownModel}
      onColumnVisibilityModelChange={handleColumnVisibilityModelChange}
      apiRef={apiRef}
      editMode="row"
      /**
       * A row saves when someone says save, never when focus leaves it.
       *
       * MUI's default stops row editing on `rowFocusOut` and **commits**, so
       * clicking the row's own cancel button first blurred the cell and sent the
       * write the click was there to abort: measured on the user list, where
       * cancelling a new row POSTed the empty draft and answered 422.
       */
      onRowEditStop={(params, event) => {
        if (params.reason === GridRowEditStopReasons.rowFocusOut) {
          event.defaultMuiPrevented = true
        }
      }}
      rowModesModel={rowModesModel}
      onRowModesModelChange={onRowModesModelChange}
      processRowUpdate={processRowUpdate}
      isCellEditable={isCellEditable}
      onProcessRowUpdateError={onProcessRowUpdateError}
      slots={slots}
      onRowClick={onRowClick === undefined ? undefined : handleRowClick}
      onCellKeyDown={onRowClick === undefined ? undefined : handleCellKeyDown}
      /**
       * Editing starts at the row's own button when the row is also a door.
       * MUI's default opens an editor on cell double-click, and the first of
       * those two clicks had already opened the dialog — so the second landed on
       * a grid behind it.
       */
      onCellDoubleClick={(_params, event) => {
        if (onRowClick !== undefined) event.defaultMuiPrevented = true
      }}
      disableColumnFilter
      disableRowSelectionOnClick
      sx={sx}
    />
  )
}

/** Memoised: a screen re-renders on every keystroke into its filters, and the grid need not. */
const ServerDataGrid = memo(ServerDataGridImpl) as typeof ServerDataGridImpl

export default ServerDataGrid
