/**
 * The pager keeps the keyboard when the arrow pressed runs out.
 *
 * The pager is never disabled while a page loads, so an arrow pressed keeps its
 * focus - but the arrow that reaches the last page (or the first) turns
 * disabled once that page lands, and a disabled button drops its focus to
 * `<body>`: a keyboard reader paging the batch list to its last page was sent back to
 * the top of the document. So an arrow that loses focus *because* it went
 * disabled hands it to the pager's first live arrow. A focus that leaves for
 * anything else - a click elsewhere, Tab - is the reader's and is left alone.
 *
 * Listened for on the document, not per pager: the DataGrid draws its own
 * footer, and the same listener serves the phone's card pager and a dialog's
 * table opened over the list.
 */

import { useEffect } from 'react'

const PAGER_ACTIONS = '.MuiTablePagination-actions'

export function usePagerFocus(): void {
  useEffect(() => {
    const onFocusOut = (event: FocusEvent) => {
      const target = event.target
      if (!(target instanceof HTMLButtonElement) || event.relatedTarget !== null) return
      const actions = target.closest(PAGER_ACTIONS)
      if (actions === null) return
      // The blur comes mid-render; the arrow is disabled once the render is done.
      queueMicrotask(() => {
        if (!target.disabled || !(document.activeElement === null || document.activeElement === document.body)) return
        actions.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
      })
    }
    document.addEventListener('focusout', onFocusOut)
    return () => document.removeEventListener('focusout', onFocusOut)
  }, [])
}
