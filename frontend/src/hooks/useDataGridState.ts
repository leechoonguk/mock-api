/**
 * Grid state for a server-paginated list screen.
 *
 * The backend paginates with `offset`/`limit` and answers `Page<T>` — items and
 * the collection's total (`app/core/page.py`). So the grid runs with an exact
 * `rowCount` and this hook asks for exactly the page: the older shape had no
 * total anywhere in the API, so the grid peeked one row past the page and could
 * only ever say "there is more", never how much.
 *
 * Sorting is the server's too: the header's one sorted column goes out as
 * `sort` and `order` (`<Domain>SortQuery` / `OrderQuery` on the router), and a
 * sort change lands on page one - page 4 of a list sorted one way is not page
 * 4 of it sorted the other. Before the model was wired through, the grid
 * sorted the ten loaded rows and called it the collection.
 *
 * **The page, its size and the sort live in the URL** (`?page=3&size=50&sort=
 * product_name&order=asc`, defaults omitted), written through
 * `useSearchParamWriter` - which also states the history policy: each of these
 * is a choice, so each pushes and back retraces it. Measured before: a reload
 * dropped the reader on `1–20`, and back after paging left the screen. A size
 * change lands on page one: page 3 at 20 rows (`41–60`) kept as page 3 at 50
 * jumped to `101–150`, rows the reader had never seen.
 *
 * The grid's own strings come from MUI's locale bundle, keyed off the active
 * i18n language: the footer says "페이지 당 행" in Korean, as the reference
 * application does, instead of leaving one English row inside a Korean screen.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useSearchParams } from 'react-router-dom'
import { enUS, koKR } from '@mui/x-data-grid/locales'
import type { GridDensity, GridPaginationModel, GridSortModel } from '@mui/x-data-grid'
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from '@/config'
import { usePaginationLabels } from '@/hooks/usePaginationLabels'
import { useSearchParamWriter } from '@/hooks/useSearchParamWriter'
import type { HistoryMode } from '@/hooks/useSearchParamWriter'
import type { PageParams } from '@/types/api'

/** The query-string keys this hook owns; a filter or a dialog parameter never takes one. */
export const GRID_URL_KEYS = { page: 'page', size: 'size', sort: 'sort', order: 'order' } as const

/**
 * How long after the URL moved a page change from the grid is its own echo, not
 * the reader's. MUI answers a new sort prop - a back over a sort - by sending
 * page 0 (`navigateToStart`, a 0ms timer), which pushed over the page back had
 * just restored. No hand clicks a pager this soon after a navigation.
 */
const ECHO_WINDOW_MS = 150

/** The two directions `OrderQuery` closes. */
const ORDERS: readonly string[] = ['asc', 'desc']

interface UseDataGridStateOptions {
  defaultPageSize?: number
  defaultDensity?: GridDensity
  defaultColumnVisibilityModel?: Record<string, boolean>
  /**
   * The columns the screen's router sorts (`<Domain>SortQuery`). A `sort` the
   * URL names outside them reads as unsorted before the first request: a pasted
   * `?sort=nope` cost a 422, a console error and a toast, and only then did
   * MUI drop the unknown field - with a push, so back returned to the 422.
   */
  sortable?: readonly string[]
}

export function useDataGridState(options: UseDataGridStateOptions = {}) {
  const {
    defaultPageSize = DEFAULT_PAGE_SIZE,
    defaultDensity = 'standard',
    defaultColumnVisibilityModel = {},
    sortable,
  } = options

  const [searchParams] = useSearchParams()
  const write = useSearchParamWriter()
  const pageText = searchParams.get(GRID_URL_KEYS.page)
  const sizeText = searchParams.get(GRID_URL_KEYS.size)
  const sortText = searchParams.get(GRID_URL_KEYS.sort)
  const orderText = searchParams.get(GRID_URL_KEYS.order)

  // A page or size the URL cannot mean (typed, or a size no longer offered) reads as the default.
  const paginationModel = useMemo<GridPaginationModel>(() => {
    const size = Number(sizeText)
    const page = Number(pageText)
    return {
      page: Number.isInteger(page) && page >= 1 ? page - 1 : 0,
      pageSize: PAGE_SIZE_OPTIONS.includes(size) ? size : defaultPageSize,
    }
  }, [pageText, sizeText, defaultPageSize])

  const sortField =
    sortText === null || sortText === '' || (sortable !== undefined && !sortable.includes(sortText))
      ? null
      : sortText
  const sortModel = useMemo<GridSortModel>(
    () => (sortField === null ? [] : [{ field: sortField, sort: orderText === 'desc' ? 'desc' : 'asc' }]),
    [sortField, orderText],
  )

  /**
   * The URL says what the grid shows. A value read as its default above - a
   * page that is no page, `size=999`, an unsortable `sort`, `order=sideways`,
   * or a default spelled out - is taken out of the address in place (replaced:
   * the reader asked for no step), so a link copied from here is the list seen.
   */
  const pageNumber = Number(pageText)
  const sizeNumber = Number(sizeText)
  const stray = {
    page: pageText !== null && !(Number.isInteger(pageNumber) && pageNumber >= 2),
    size: sizeText !== null && (!PAGE_SIZE_OPTIONS.includes(sizeNumber) || sizeNumber === defaultPageSize),
    sort: sortText !== null && sortField === null,
    order: orderText !== null && (sortField === null || !ORDERS.includes(orderText)),
  }
  const straying = stray.page || stray.size || stray.sort || stray.order
  useEffect(() => {
    if (!straying) return
    write((params) => {
      if (stray.page) params.delete(GRID_URL_KEYS.page)
      if (stray.size) params.delete(GRID_URL_KEYS.size)
      if (stray.sort) params.delete(GRID_URL_KEYS.sort)
      if (stray.order) params.delete(GRID_URL_KEYS.order)
    }, 'replace')
  }, [straying, stray.page, stray.size, stray.sort, stray.order, write])

  const [density, setDensity] = useState<GridDensity>(defaultDensity)
  const [columnVisibilityModel, setColumnVisibilityModel] = useState<Record<string, boolean>>(
    defaultColumnVisibilityModel,
  )

  const location = useLocation()
  const movedAt = useRef(0)
  useEffect(() => {
    movedAt.current = Date.now()
  }, [location.key])

  /** Off the page key: `page` is 1-based in the URL and absent on the first. */
  const writePage = (params: URLSearchParams, page: number) => {
    if (page <= 0) params.delete(GRID_URL_KEYS.page)
    else params.set(GRID_URL_KEYS.page, String(page + 1))
  }

  const resetPage = useCallback(() => {
    // Part of whatever gesture asked for it (a filter, a draft row): it decides push or replace.
    write((params) => params.delete(GRID_URL_KEYS.page), 'replace')
  }, [write])

  /**
   * A reader's page or size pushes. `replace` is the grid correcting itself (a
   * page past the end, once the total is in): not an echo of a navigation, so
   * the echo window does not swallow it, and not a step back should retrace.
   */
  const setPaginationModel = useCallback(
    (model: GridPaginationModel, history: HistoryMode = 'push') => {
      if (history === 'push' && Date.now() - movedAt.current < ECHO_WINDOW_MS) return
      const sizeChanged = model.pageSize !== paginationModel.pageSize
      const page = sizeChanged ? 0 : model.page
      if (!sizeChanged && page === paginationModel.page) return
      write((params) => {
        writePage(params, page)
        if (model.pageSize === defaultPageSize) params.delete(GRID_URL_KEYS.size)
        else params.set(GRID_URL_KEYS.size, String(model.pageSize))
      }, history)
    },
    [write, paginationModel, defaultPageSize],
  )

  const setSortModel = useCallback(
    (model: GridSortModel) => {
      const [sorted] = model
      write((params) => {
        params.delete(GRID_URL_KEYS.page)
        if (sorted === undefined || sorted.sort === null || sorted.sort === undefined) {
          params.delete(GRID_URL_KEYS.sort)
          params.delete(GRID_URL_KEYS.order)
        } else {
          params.set(GRID_URL_KEYS.sort, sorted.field)
          params.set(GRID_URL_KEYS.order, sorted.sort)
        }
      }, 'push')
    },
    [write],
  )

  const params = useMemo<PageParams>(() => {
    const [sorted] = sortModel
    return {
      offset: paginationModel.page * paginationModel.pageSize,
      limit: paginationModel.pageSize,
      // An unsorted grid omits both, so the endpoint pages by its own order.
      ...(sorted === undefined || sorted.sort === null
        ? {}
        : { sort: sorted.field, order: sorted.sort }),
    }
  }, [paginationModel.page, paginationModel.pageSize, sortModel])

  const { i18n } = useTranslation()
  const labels = usePaginationLabels()
  /**
   * The bundle is the base, our two strings win. MUI X's koKR is half-translated:
   * `paginationRowsPerPage` is Korean while `paginationDisplayedRows` returns
   * `${from}–${to} of ${count}` — measured as `페이지 당 행: 10  1–2 of 2`. Detail
   * dialogs render a core `TablePagination` from the same two strings, so both
   * footers read alike instead of one page saying `of` and the next `전체`.
   */
  const localeText = useMemo(() => {
    const bundle = i18n.language === 'en' ? enUS : koKR
    return {
      ...bundle.components.MuiDataGrid.defaultProps.localeText,
      paginationRowsPerPage: labels.labelRowsPerPage,
      paginationDisplayedRows: labels.labelDisplayedRows,
    }
  }, [i18n.language, labels])

  return {
    paginationModel,
    setPaginationModel,
    resetPage,
    sortModel,
    setSortModel,
    params,
    density,
    setDensity,
    columnVisibilityModel,
    setColumnVisibilityModel,
    localeText,
  }
}
