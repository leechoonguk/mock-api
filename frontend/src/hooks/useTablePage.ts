/**
 * Client-side paging for a table whose rows are already in hand.
 *
 * The provider dialog fetches the whole provider — `operations` and `secrets` are
 * nested in that one response — so paging these tables is presentation, not
 * fetching. `usePagedRows` is the other case: it reads a server page and decides
 * whether another exists.
 *
 * The page is clamped, not trusted: deleting the last row of the last page leaves
 * a page number that no longer has rows, and a table that renders nothing while
 * reporting "51–60 of 50" looks like a failed load.
 *
 * The state belongs to the **dialog**, not the table: opening a record replaces
 * the tab body, so a hook called inside the tab is unmounted with it and the
 * reader returns from the record they just edited to page 1. Measured: deleting
 * the last credential on page 2 of 12 landed back on `1–10`. So the dialog calls
 * this hook — where `tab` and `mode` already live — and the tab is handed the
 * result, staying the pure presenter its rule requires.
 *
 * The footer's wording is not this hook's business: `usePaginationLabels` is the
 * one source the list grid reads too, so the two surfaces cannot drift apart.
 */

import { useMemo, useState } from 'react'
import { PAGE_SIZE_OPTIONS } from '@/config'
import { PHONE_PAGER_SX, usePaginationLabels } from '@/hooks/usePaginationLabels'
import type { DisplayedRowsInfo } from '@/hooks/usePaginationLabels'

export interface TablePaging<T> {
  /** The rows of the current page, already sliced. */
  visible: T[]
  /** Everything `TablePagination` needs, so a caller never re-derives it. */
  pagination: {
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
  /** The whole row count, so an empty table does not need the array too. */
  count: number
  /** Back to the first page: the dialog closing for the next record's provider. */
  reset: () => void
}

export function useTablePage<T>(rows: T[], options = PAGE_SIZE_OPTIONS): TablePaging<T> {
  const labels = usePaginationLabels()
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(options[0])

  const lastPage = Math.max(0, Math.ceil(rows.length / rowsPerPage) - 1)
  const current = Math.min(page, lastPage)

  const visible = useMemo(
    () => rows.slice(current * rowsPerPage, current * rowsPerPage + rowsPerPage),
    [rows, current, rowsPerPage],
  )

  return {
    visible,
    pagination: {
      count: rows.length,
      page: current,
      rowsPerPage,
      rowsPerPageOptions: options,
      labelRowsPerPage: labels.labelRowsPerPage,
      labelDisplayedRows: labels.phone ? labels.labelDisplayedRowsCompact : labels.labelDisplayedRows,
      getItemAriaLabel: labels.getItemAriaLabel,
      sx: labels.phone ? PHONE_PAGER_SX : undefined,
      onPageChange: (_event, next) => setPage(next),
      onRowsPerPageChange: (event) => {
        setRowsPerPage(Number(event.target.value))
        setPage(0)
      },
    },
    count: rows.length,
    reset: () => setPage(0),
  }
}
