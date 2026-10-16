/**
 * One writer for a list screen's query string - the page, its size, the sort
 * and the filters all live in the URL, so a reload, a pasted link and the back
 * button land on the list the reader was looking at.
 *
 * **History policy.** A discrete choice is a step back can retrace: a page, a
 * page size, a sort, a tick or untick in a select, the reset - each *pushes*.
 * Typing is not a choice per keystroke: a typed box, once it settles, *replaces*
 * the entry it was typed on, so back never walks through `고`, `고추`, `고추장`.
 *
 * **One entry per gesture.** A filter applied and the page reset it causes are
 * two writes from two hooks in one event. react-router's `setSearchParams`
 * reads the params of the render it was created in, so the second write
 * dropped the first; and two pushes would be two entries for one click. So
 * writes are queued and flushed once, in a microtask, against the URL as it is
 * *now* (`window.location`), and the gesture pushes if any of its writes did.
 *
 * **An overlay's entry is replaced, not stacked on.** The phone's filter sheet
 * pushes an entry so back closes it (`useBackCloses`). A write made from under
 * it - a pick, a typed box - replaces that entry and keeps its marker, so a
 * visit to the sheet is one step back however many values it ticked.
 *
 * Keys are the router's own: `page`, `size`, `sort`, `order` and each filter by
 * its query parameter name. A dialog's parameter (`detail`, `runs`, `calls`,
 * `uses`) is named by its screen and passes through untouched.
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { NavigateFunction } from 'react-router-dom'
import { OVERLAY_STATE_KEY } from '@/hooks/useBackCloses'

export type HistoryMode = 'push' | 'replace'

type Mutation = (params: URLSearchParams) => void

interface Pending {
  mutations: Mutation[]
  push: boolean
  navigate: NavigateFunction
}

/** The writes of the current gesture, flushed together. */
let pending: Pending | null = null

/** The state react-router keeps on the current entry (`history.state.usr`). */
function currentEntryState(): Record<string, unknown> | null {
  const state: unknown = window.history.state
  if (typeof state !== 'object' || state === null || !('usr' in state)) return null
  const usr: unknown = state.usr
  return typeof usr === 'object' && usr !== null ? (usr as Record<string, unknown>) : null
}

function flush() {
  const batch = pending
  pending = null
  if (batch === null) return
  const next = new URLSearchParams(window.location.search)
  for (const mutation of batch.mutations) mutation(next)
  const search = next.toString()
  if (search === window.location.search.replace(/^\?/, '')) return
  const entry = currentEntryState()
  // A write from under an overlay (the phone's filter sheet) replaces the
  // overlay's entry, marker and all: one visit to the sheet is one step back.
  const overlay = entry !== null && OVERLAY_STATE_KEY in entry
  const replace = !batch.push || overlay
  // A replace keeps what the entry carried (a dialog's marker, the sheet's); a push starts clean.
  const state = replace ? entry : null
  void batch.navigate(
    { pathname: window.location.pathname, search: search === '' ? '' : `?${search}` },
    { replace, state },
  )
}

export function useSearchParamWriter() {
  const navigate = useNavigate()
  return useCallback(
    (mutation: Mutation, mode: HistoryMode) => {
      if (pending === null) {
        pending = { mutations: [], push: false, navigate }
        queueMicrotask(flush)
      }
      pending.mutations.push(mutation)
      if (mode === 'push') pending.push = true
    },
    [navigate],
  )
}
