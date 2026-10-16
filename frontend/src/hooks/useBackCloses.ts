/**
 * Back closes the overlay that is open, instead of leaving the screen under it.
 *
 * A phone reader presses back to dismiss what covers the page - the nav drawer,
 * the filter sheet. Measured before: back with the drawer open went from the
 * list to the dashboard. So opening pushes an entry at the same URL carrying a
 * marker (`overlay: <name>`); back pops it and the overlay closes.
 *
 * **One visit is one entry.** A filter applied inside the sheet replaces the
 * sheet's entry and keeps its marker (`useSearchParamWriter`), so a visit that
 * ticked three values is still one step:
 *
 * | The overlay closes by | Nothing changed under it | The URL changed under it |
 * |---|---|---|
 * | its own control (X, a tap outside, 결과 보기) | back over its entry | its entry stays, unmarked: back undoes the visit |
 * | back | the entry is popped | the visit's URL is pushed again, unmarked: back closed the sheet, it did not drop the filters |
 * | a navigation from inside (a nav link) | the link replaced the entry | - |
 *
 * Closing from the overlay never leaves a marked entry behind for a later back
 * to land on and close nothing. The close is deferred and reads
 * `window.history` at that time, because a replace in the same gesture (a nav
 * link) has already moved the entry. An overlay that unmounts while open (a
 * phone's row editor, drawn only while its row edits) closes the same way.
 *
 * **An overlay may refuse back.** A form dialog with typed input does not lose
 * it to a stray back: `onClose` returns `false`, the dialog asks its discard
 * question instead (`useDiscardGuard`), and the entry is pushed again so the
 * next back asks again rather than leaving the screen. Measured before: 추가 →
 * type → back left six screens for the dashboard and dropped what was typed.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import type { NavigateFunction } from 'react-router-dom'

/** The key an overlay's entry carries in its history state, valued by the overlay's name. */
export const OVERLAY_STATE_KEY = 'overlay'

/**
 * Where back is how an overlay that is not tied to a breakpoint is dismissed: a
 * finger. A header menu or drawer opens over a desktop page too, and there back
 * keeps its desktop meaning.
 */
export const TOUCH_QUERY = '(pointer: coarse)'

const asRecord = (state: unknown): Record<string, unknown> =>
  typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {}

const isMarked = (state: unknown, name: string) => asRecord(state)[OVERLAY_STATE_KEY] === name

/** react-router keeps an entry's state under `usr` in `history.state`. */
const currentEntryState = () => asRecord(asRecord(window.history.state).usr)

const withoutMarker = (state: Record<string, unknown>) => {
  const kept = { ...state }
  delete kept[OVERLAY_STATE_KEY]
  return kept
}

const currentUrl = () => window.location.pathname + window.location.search

/**
 * Whether the entry in view is an open overlay's. A link chosen inside the
 * overlay replaces that entry rather than stacking on it, so back from where
 * the link went returns to the page, not to an entry that closes nothing.
 */
export const onOverlayEntry = () => OVERLAY_STATE_KEY in currentEntryState()

/**
 * `enabled` false makes the hook inert - a desktop, where a drawer is docked
 * and back is not how a popover is dismissed.
 */
export function useBackCloses(
  open: boolean,
  onClose: () => boolean | void,
  name: string,
  enabled = true,
) {
  const location = useLocation()
  const navigationType = useNavigationType()
  const navigate = useNavigate()
  const here = location.pathname + location.search
  const marked = isMarked(location.state, name)
  /** This overlay pushed the entry it is open on. */
  const pushed = useRef(false)
  /** The URL it was opened at, and the last one its entry held. */
  const openedAt = useRef('')
  const lastMarked = useRef('')
  const wasMarked = useRef(false)
  const close = useRef(onClose)
  const navigateRef = useRef(navigate)
  useLayoutEffect(() => {
    close.current = onClose
    navigateRef.current = navigate
  })

  // Opened: push the entry back will pop.
  useEffect(() => {
    if (!enabled || !open || pushed.current) return
    pushed.current = true
    openedAt.current = here
    void navigate(here, { state: { ...asRecord(location.state), [OVERLAY_STATE_KEY]: name } })
  }, [enabled, open, name, navigate, here, location.state])

  // The marker left while open - back, or a navigation that replaced it: close.
  useEffect(() => {
    if (marked) {
      wasMarked.current = true
      lastMarked.current = here
      return
    }
    if (!wasMarked.current) return
    wasMarked.current = false
    if (!pushed.current) return
    if (close.current() === false) {
      // Refused: still open, so the entry back just popped is pushed again.
      void navigate(here, { state: { ...asRecord(location.state), [OVERLAY_STATE_KEY]: name } })
      return
    }
    pushed.current = false
    // Back closed a visit that changed the list: the list keeps what it changed,
    // on an entry of its own above the one the sheet was opened on - the history
    // 결과 보기 leaves. Replacing the entry below instead dropped it: ?page=2 →
    // 필터 → a pick → back, back went to /dashboard rather than to page 2.
    if (navigationType === 'POP' && lastMarked.current !== openedAt.current) {
      void navigate(lastMarked.current, { state: withoutMarker(asRecord(location.state)) })
    }
  }, [marked, here, navigationType, navigate, location.state, name])

  // Closed from the overlay: leave no marked entry behind.
  useEffect(() => {
    if (open || !pushed.current) return
    pushed.current = false
    const timer = setTimeout(() => leaveEntry(name, openedAt.current, navigate), 0)
    return () => clearTimeout(timer)
  }, [open, name, navigate])

  // Unmounted while open: the same, once the unmounting render has settled -
  // and only if it stayed unmounted (StrictMode remounts at once, still open).
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      setTimeout(() => {
        if (mounted.current || !pushed.current) return
        pushed.current = false
        leaveEntry(name, openedAt.current, navigateRef.current)
      }, 0)
    }
  }, [name])
}

/** Back over the overlay's entry, or unmark it when the URL has moved on under it. */
function leaveEntry(name: string, openedAt: string, navigate: NavigateFunction) {
  const entry = currentEntryState()
  if (!isMarked(entry, name)) return
  if (currentUrl() === openedAt) void navigate(-1)
  else void navigate(currentUrl(), { replace: true, state: withoutMarker(entry) })
}
