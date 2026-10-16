/**
 * The app's one notification surface — every outcome a screen reports.
 *
 * A mutation reports through it directly; a failed read reports through
 * `useQueryErrorToast`, which wraps this. Wording and placement are decided
 * once, and screens never call `enqueueSnackbar` directly — that is how three
 * different variants for "saved" appear.
 */

import { useMemo } from 'react'
import { useSnackbar } from 'notistack'

/**
 * A failure stays longer than a confirmation. A success repeats what the user
 * just did and is gone before it is in the way; a failure carries a sentence to
 * read and sometimes a next step (“새로 불러온 뒤 다시 시도하세요”), and four seconds
 * is not enough to read one in a second language.
 */
const ERROR_AUTO_HIDE_MS = 7000

export function useToast() {
  const { enqueueSnackbar } = useSnackbar()

  return useMemo(
    () => ({
      success: (message: string) => enqueueSnackbar(message, { variant: 'success' }),
      error: (message: string) =>
        enqueueSnackbar(message, { variant: 'error', autoHideDuration: ERROR_AUTO_HIDE_MS }),
    }),
    [enqueueSnackbar],
  )
}
