/**
 * The question a form dialog asks before an accidental close throws away what
 * was typed.
 *
 * Escape and a backdrop click are the closes nobody aims for: on a create form
 * either one dropped every field without a word (measured on all five create
 * dialogs). With nothing typed they still close at once - a question about an
 * empty form is a second click for nothing. The explicit closes, `취소` and the
 * head's ×, are the reader saying so and never ask.
 *
 * **Back is the third accidental close.** On a phone it is the one a thumb
 * makes most: measured before, 추가 → type → back left the screen for
 * the dashboard on six lists and the typed values were gone. So an open dialog
 * holds a history entry (`useBackCloses`): back with nothing typed closes it,
 * and back with something typed asks the same question and keeps the dialog
 * (and its entry) - the question's own 버리고 닫기 is what discards.
 */

import { useCallback, useMemo, useState } from 'react'
import { useBackCloses } from '@/hooks/useBackCloses'

export interface DiscardGuard {
  /** Whether the dialog's actions are asking right now. */
  asking: boolean
  /** The dialog's own `onClose` (Esc, backdrop): asks first when the form is dirty. */
  request: () => void
  /** Back to the form, nothing lost. */
  keep: () => void
  /** Close and lose what was typed. */
  discard: () => void
}

export function useDiscardGuard(dirty: boolean, onClose: () => void, open: boolean): DiscardGuard {
  const [asking, setAsking] = useState(false)

  useBackCloses(
    open,
    () => {
      if (dirty) {
        setAsking(true)
        return false
      }
      onClose()
      return true
    },
    'form',
  )

  const request = useCallback(() => {
    if (dirty) setAsking(true)
    else onClose()
  }, [dirty, onClose])

  const keep = useCallback(() => setAsking(false), [])

  const discard = useCallback(() => {
    setAsking(false)
    onClose()
  }, [onClose])

  return useMemo(() => ({ asking, request, keep, discard }), [asking, request, keep, discard])
}
