/**
 * A record dialog addressed by an id that names nothing closes itself.
 *
 * A pasted or stale link (`?detail=<id>` of a row since rebuilt away) answered
 * 404, toasted 요청한 대상을 찾을 수 없습니다 - and left the dialog open with its
 * title and tabs over nothing (measured on the 품목 보고 list). The toast
 * already says why; the empty dialog said nothing more, so on a 404 the
 * dialog's own close runs, which drops the parameter (`useUrlDialog`).
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { toApiError } from '@/lib/api/errors'

const NOT_FOUND = 404

interface RecordRead {
  isError: boolean
  error: unknown
}

export function useMissingRecordCloses(query: RecordRead, onClose: () => void) {
  const close = useRef(onClose)
  useLayoutEffect(() => {
    close.current = onClose
  })
  const missing = query.isError && toApiError(query.error).status === NOT_FOUND
  useEffect(() => {
    if (missing) close.current()
  }, [missing])
}
