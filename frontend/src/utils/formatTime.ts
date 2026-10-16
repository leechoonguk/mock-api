/**
 * Timestamp formatting.
 *
 * The backend sends UTC ISO-8601 (`DateTime(timezone=True)` columns), and a
 * grid cell that prints the raw string shows a `T` and a `Z` to the user. One
 * formatter keeps every timestamp in the app identical, and an unparseable
 * value renders as a dash instead of `Invalid Date`.
 */

import i18next from 'i18next'

const EMPTY_VALUE = '-'

/**
 * The reader's language decides the spelling: a fixed `ko-KR` printed
 * `2026. 9. 15. 오전 10:36` in every grid, audit line and chat history of the
 * English UI. One formatter per language, built on first use - `Intl` is slow
 * to construct and a grid formats a column per row. A screen re-renders on a
 * language change (`useTranslation`), and the next format reads the new one.
 */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>()

function formatterOf(language: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(language)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' })
    FORMATTERS.set(language, formatter)
  }
  return formatter
}

export function formatDateTime(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return EMPTY_VALUE
  return formatterOf(i18next.language).format(parsed)
}

/**
 * A registry's own date (`20260915`) as a reader reads it (`2026-09-15`).
 *
 * The portals publish eight digits and this repository stores them verbatim -
 * the ledger is what the registry said. A screen is not a ledger: measured
 * 2026-09-16, the product dialog and the event table both printed the raw
 * digits, and a reader had to count characters to find the month.
 * Anything that is not eight digits is handed back as it came.
 */
export function formatPortalDate(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const digits = /^(\d{4})(\d{2})(\d{2})$/.exec(value)
  return digits === null ? value : `${digits[1]}-${digits[2]}-${digits[3]}`
}
