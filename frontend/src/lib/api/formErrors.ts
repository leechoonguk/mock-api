/**
 * Server refusals, translated and shown where the user can act on them.
 *
 * The backend answers every failure with `{ detail, code, request_id }`. `detail`
 * is English written for a log line; the sentence a user reads comes from
 * `locales/*.ts` keyed by `code`, because the server does not know which
 * language this session speaks.
 *
 * Two behaviours, both measured as missing: a dialog used to swallow every
 * failure into one generic "저장 실패", so adding a provider whose code was taken
 * said nothing about the code — the only way to learn the cause was the network
 * tab. And a naive fix (`toast.error(apiError.message)`) ships English into a
 * Korean screen.
 */

import type { TFunction } from 'i18next'
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { toApiError } from '@/lib/api/errors'

/** The message for a failure that never reached a handler, so it has no code. */
const FALLBACK_KEY = 'errors.unknown'

type Translator = TFunction<'common'>

/**
 * Translate one failure. `fieldByCode` lets a dialog put the message on the
 * input that owns it — a taken provider code is a fact about the `code` field —
 * and anything unclaimed becomes a toast.
 */
export function applyServerError<T extends FieldValues>(
  error: unknown,
  options: {
    t: Translator
    setError: UseFormSetError<T>
    toastError: (message: string) => void
    fieldByCode?: Partial<Record<string, Path<T>>>
  },
): void {
  const { t, setError, toastError, fieldByCode = {} } = options
  const apiError = toApiError(error)
  const message = serverErrorMessage(apiError.code, t)
  const field = fieldByCode[apiError.code]

  if (field !== undefined) {
    setError(field, { type: 'server', message })
    return
  }
  toastError(message)
}

/**
 * The translated sentence for one server code.
 *
 * An unknown code falls back rather than rendering the raw code: a new backend
 * failure mode is caught by `check-frontend-i18n` at build time, so the fallback
 * is for a version skew between a deployed client and a newer server.
 *
 * **The one runtime key in the application.** Every other `t()` call is checked
 * against the resource types (`locales/i18next.d.ts`), which is what turns a
 * missing key into a build failure instead of a key rendered on screen. This
 * key cannot be: it is built from a code the *server* chose, and the whole
 * point of the branch below is that the key may not exist. So the widening is
 * declared here, once, and the existence test stays where it belongs — at
 * runtime, comparing the answer with the key i18next echoes back when it misses.
 */
export function serverErrorMessage(code: string, t: Translator): string {
  return translatedErrorMessage(code, t) ?? t(FALLBACK_KEY)
}

/**
 * The sentence for one server code, or `null` when no locale answers it.
 *
 * A read reports through this rather than through `serverErrorMessage`: a list
 * that failed because the browser is offline carries `network_error`, which no
 * locale answers, and the generic `errors.unknown` sentence says less than the
 * screen's own "could not load the data". A 503 or a 404, on the other hand,
 * names the cause — and the toast said the same thing for all three before.
 */
export function translatedErrorMessage(code: string, t: Translator): string | null {
  const key = `errors.${code}`
  // The one widening in the app, and the reason is above: this key is built
  // from a value the server chose, so it is not in the resource types by
  // construction. Everything else goes through the typed `t`.
  const message = (t as (runtimeKey: string) => string)(key)

  return message === key ? null : message
}
