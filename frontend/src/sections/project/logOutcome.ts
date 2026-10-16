/**
 * How a logged request was answered — one reading for the log table and the
 * log panel, so a row and its detail never disagree.
 *
 * An endpoint answered it, the real server did (record mode), or nothing did. The
 * three are exclusive: a proxied request is by definition one no endpoint
 * matched. The names are the server's (`LogOutcome`), so the log filter sends
 * the same word a row is drawn with.
 */

import type { ComponentProps } from 'react'
import type Label from '@/components/label/Label'
import type { LogOutcome, RequestLog } from '@/types/log'

type LabelColor = NonNullable<ComponentProps<typeof Label>['color']>

export const OUTCOME_COLORS: Record<LogOutcome, LabelColor> = {
  matched: 'success',
  proxied: 'info',
  unmatched: 'error',
}

/** The locale key each outcome reads as, in the `project` namespace. */
export const OUTCOME_LABEL_KEYS = {
  matched: 'log.matched_yes',
  proxied: 'log.proxied',
  unmatched: 'log.matched_no',
} as const satisfies Record<LogOutcome, string>

export function logOutcome(log: Pick<RequestLog, 'matched' | 'proxied'>): LogOutcome {
  if (log.matched) return 'matched'
  return log.proxied ? 'proxied' : 'unmatched'
}
