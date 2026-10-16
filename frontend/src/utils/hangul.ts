/**
 * Hangul helpers for input that is still being composed.
 *
 * A phone's IME reports `ㄱ`, `고`, `곷` before `고추` settles, and a value that
 * ends in a bare jamo (U+3131–U+318E, the compatibility jamo block) is a word
 * mid-keystroke, not one the reader means to search for.
 */

const JAMO_FIRST = 0x3131
const JAMO_LAST = 0x318e

/** Whether the value's last code point is a bare Hangul jamo. */
export function endsWithJamo(value: string): boolean {
  const last = value.codePointAt(value.length - 1)
  return last !== undefined && last >= JAMO_FIRST && last <= JAMO_LAST
}
