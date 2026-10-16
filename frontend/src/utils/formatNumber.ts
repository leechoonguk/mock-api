/**
 * Counts as a reader reads them: `1,850,588`, not `1850588`.
 *
 * One formatter, built once - `Intl.NumberFormat` is costly to construct, and a
 * count is drawn on every list head and every pager.
 */

const COUNT = new Intl.NumberFormat('ko-KR')

export function formatCount(value: number): string {
  return COUNT.format(value)
}
