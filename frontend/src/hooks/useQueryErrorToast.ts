/**
 * The app's only way to report a failed read.
 *
 * A failed page used to draw an inline `<Alert>` above the table, which put two
 * failure vocabularies on one screen: a banner for reads, a toast for writes.
 * Both now speak as a toast, and the retry a screen offers is the toolbar's
 * refresh — the only refresh control a list already had.
 *
 * The sentence comes from the server's `code` whenever a locale answers it, and
 * falls back to the screen's own `message` otherwise. Measured before: a list
 * read that failed 503 said "데이터를 불러오지 못했습니다", the same sentence a dead
 * network produced — the one fact the server did send was dropped on the floor.
 *
 * The episode is keyed by `errorUpdatedAt`, not by `isError`. Keyed on the flag,
 * a failed retry said nothing at all: `isError` was already true, so the refresh
 * the user pressed against a dead API produced a request, a spinner and silence
 * (measured on the user list with the backend stopped — the second click drew no
 * toast). Every failed fetch stamps a new time, so every attempt is answered
 * once, and a re-render alone is answered not at all.
 */

import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toApiError } from '@/lib/api/errors'
import { translatedErrorMessage } from '@/lib/api/formErrors'
import { useToast } from '@/hooks/useToast'

interface FailedRead {
  isError: boolean
  errorUpdatedAt: number
  error: unknown
}

export function useQueryErrorToast(query: FailedRead, message: string) {
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()
  const reported = useRef(0)

  useEffect(() => {
    if (!query.isError) return
    if (reported.current === query.errorUpdatedAt) return
    reported.current = query.errorUpdatedAt
    const code = toApiError(query.error).code
    toast.error(translatedErrorMessage(code, tCommon) ?? message)
  }, [query.isError, query.errorUpdatedAt, query.error, message, toast, tCommon])
}
