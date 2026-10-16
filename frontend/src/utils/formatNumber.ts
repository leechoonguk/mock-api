/**
 * Counts and sizes as a reader reads them: `1,850,588`, not `1850588`; `1.2 MB`,
 * not `1258291`.
 *
 * One formatter each, built once - `Intl.NumberFormat` is costly to construct,
 * and a count is drawn on every list head and every pager.
 */

const COUNT = new Intl.NumberFormat('ko-KR')

const SIZE = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 })

/** Binary steps: a KB is 1024 bytes, as the server's log body limit (64 KiB) counts. */
const SIZE_STEP = 1024

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatCount(value: number): string {
  return COUNT.format(value)
}

/** A byte count in the largest unit it reaches, at most one decimal: `512 B`, `64 KB`, `1.2 MB`. */
export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= SIZE_STEP && unit < SIZE_UNITS.length - 1) {
    value /= SIZE_STEP
    unit += 1
  }
  return `${SIZE.format(value)} ${SIZE_UNITS[unit]}`
}
