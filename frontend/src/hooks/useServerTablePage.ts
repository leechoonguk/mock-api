/**
 * Paging for a table whose rows are **fetched a page at a time**.
 *
 * `useTablePage` is the other case: rows already in hand, sliced for display.
 * This one drives the request. A batch schedule's run log grows by one row per
 * night forever, so slicing "everything" is not available — the page is what is
 * asked for, and the page number has to reach the query.
 *
 * The total comes from the response: every list endpoint answers `Page<T>`, so
 * the footer says "1–20 of 240" on the first page. It used to peek one row past
 * the page instead, which can say *more* but never *how many* — the reader saw
 * `1–10` until the last page finally told them the number.
 *
 * The wording comes from `usePaginationLabels`, the one source the list grid
 * reads too: a reader moving from a list into a dialog must not have to notice
 * that the footer changed vocabulary.
 */

import { useCallback, useMemo, useState } from 'react'
import { PAGE_SIZE_OPTIONS } from '@/config'
import { PHONE_PAGER_SX, usePaginationLabels } from '@/hooks/usePaginationLabels'
import type { DisplayedRowsInfo } from '@/hooks/usePaginationLabels'
import type { OffsetLimitParams, Page } from '@/types/api'

export interface ServerTablePagination {
  count: number
  page: number
  rowsPerPage: number
  rowsPerPageOptions: number[]
  labelRowsPerPage: string
  labelDisplayedRows: (info: DisplayedRowsInfo) => string
  /** The arrows' names in the reader's language - MUI core's are English. */
  getItemAriaLabel: (type: 'first' | 'last' | 'next' | 'previous') => string
  /** A phone's compact footer (`PHONE_PAGER_SX`): a dialog's table is 302px at 390. */
  sx?: typeof PHONE_PAGER_SX
  onPageChange: (event: unknown, next: number) => void
  onRowsPerPageChange: (event: { target: { value: string } }) => void
}

export interface ServerTablePage<T> {
  /** The window the query must ask for. */
  params: OffsetLimitParams
  /** The page's rows and its footer, read from the response. */
  resolve: (data: Page<T> | undefined) => { rows: T[]; pagination: ServerTablePagination }
  /** Back to the first page: the dialog closing, or another record selected. */
  reset: () => void
}

export function useServerTablePage<T>(options = PAGE_SIZE_OPTIONS): ServerTablePage<T> {
  const labels = usePaginationLabels()
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(options[0])

  const params = useMemo(
    () => ({ offset: page * rowsPerPage, limit: rowsPerPage }),
    [page, rowsPerPage],
  )

  const reset = useCallback(() => setPage(0), [])

  const resolve = (data: Page<T> | undefined) => ({
      rows: data?.items ?? [],
      pagination: {
        count: data?.total ?? 0,
        page,
        rowsPerPage,
        rowsPerPageOptions: [...options],
        labelRowsPerPage: labels.labelRowsPerPage,
        labelDisplayedRows: labels.phone ? labels.labelDisplayedRowsCompact : labels.labelDisplayedRows,
        getItemAriaLabel: labels.getItemAriaLabel,
        sx: labels.phone ? PHONE_PAGER_SX : undefined,
        onPageChange: (_event: unknown, next: number) => setPage(next),
        onRowsPerPageChange: (event: { target: { value: string } }) => {
          setRowsPerPage(Number(event.target.value))
          setPage(0)
        },
      },
    })

  return { params, resolve, reset }
}
