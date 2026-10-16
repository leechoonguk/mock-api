/**
 * A dialog addressed by one query parameter (`/batch?runs=<id>`), with the
 * history the browser's back button expects - and, for a record, the chain of
 * records reached from it (`&record=<ref>`).
 *
 * Opening pushes an entry, so back closes the dialog instead of leaving the
 * screen. Closing from the dialog itself goes **back over** the entries it
 * pushed: replacing them with the bare list (the old `setSearchParams({})`)
 * left the entry underneath still naming the dialog, and back after Esc
 * reopened what the reader had just closed (measured on four screens). An
 * entry this screen did not push - a link from the header's bell, a pasted
 * URL - is replaced instead, because going back from it would leave the app.
 *
 * **A record leads over the screen.** A record linked from a record is
 * `&record=<ref>` beside the host's own parameter, pushed (`push`, `linkTo`):
 * the screen under the dialog, its list and its requests stay (rule://frontend-screens,
 * A Record Leads Over The Screen It Was Reached From). Each pushed entry
 * counts the entries pushed under it (`pushed`) and the records in the chain
 * (`depth`), so `back` goes one record back and `close` goes back over the
 * whole chain - down to an entry this screen did not push, which is then
 * cleared in place. What `<ref>` means is the host's to read; this hook only
 * carries it.
 *
 * Every other parameter of the URL is kept: the dialog's parameter and the
 * record on top are the only ones this owns, with the record's open tab
 * (`useUrlTab`), which means nothing once the record is closed.
 *
 * **Focus goes back to the row.** MUI hands focus back to the control that
 * opened the dialog - which no longer exists when the reader went to another
 * screen and came back: focus fell to `BODY`. So a close that leaves focus
 * nowhere puts it on the row or card the record was opened from (`data-id`).
 */

import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { To } from 'react-router-dom'
import { TAB_PARAM } from '@/hooks/useUrlTab'

/** The parameter a record dialog is addressed by, on every screen that opens records. */
export const DETAIL_PARAM = 'detail'

/** The record open over the host's own, reached from another record. */
export const RECORD_PARAM = 'record'

/** The history state key an entry this hook pushed carries. */
const OPENED_BY = 'urlDialog'

/** What a pushed entry knows about the entries under it. */
interface DialogState {
  [OPENED_BY]: string
  /** Consecutive entries this dialog pushed, this one included. */
  pushed: number
  /** Records in the chain this entry shows. */
  depth: number
}

/** A record another record leads to: its `&record=` value, and its own screen for a new tab. */
export interface RecordTarget {
  record: string
  href: string
}

/** A link to a record: the stacked entry a plain click pushes, and the record's own screen. */
export interface RecordLink {
  href: string
  to: To
  state: DialogState
}

/** How long a closed record waits for its row to be drawn (a remounted list loading). */
const FOCUS_WAIT_MS = 3000

/** The grid's row (its first cell) or the phone's card a record was opened from. */
const originOf = (id: string) => {
  const key = CSS.escape(id)
  // The cell first: the grid's row carries the same `data-id` and is no focus target.
  return (
    document.querySelector<HTMLElement>(`main .MuiDataGrid-row[data-id="${key}"] .MuiDataGrid-cell`) ??
    document.querySelector<HTMLElement>(`main button[data-id="${key}"]`)
  )
}

export function useUrlDialog(param: string) {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const value = searchParams.get(param)
  const top = searchParams.get(RECORD_PARAM)
  const state: unknown = location.state
  const marked =
    typeof state === 'object' && state !== null && OPENED_BY in state && state[OPENED_BY] === param
      ? (state as Partial<DialogState>)
      : null
  const pushed = marked === null ? 0 : (marked.pushed ?? 1)
  // An entry nobody pushed (pasted, reloaded) shows what its address names.
  const depth = marked?.depth ?? (value === null ? 0 : 1) + (top === null ? 0 : 1)

  const open = useCallback(
    (id: string) =>
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          next.set(param, id)
          next.delete(RECORD_PARAM)
          next.delete(TAB_PARAM)
          return next
        },
        { state: { [OPENED_BY]: param, pushed: pushed + 1, depth: 1 } satisfies DialogState },
      ),
    [param, pushed, setSearchParams],
  )

  /** The entry a record on top of this one is: the search it shows and its marker. */
  const stacked = useCallback(
    (record: string) => {
      const next = new URLSearchParams(searchParams)
      next.set(RECORD_PARAM, record)
      next.delete(TAB_PARAM)
      return {
        to: { pathname: location.pathname, search: `?${next.toString()}` },
        state: { [OPENED_BY]: param, pushed: pushed + 1, depth: depth + 1 } satisfies DialogState,
      }
    },
    [searchParams, location.pathname, param, pushed, depth],
  )

  /** A link to a record over this one, for `RecordLink` and a table's `rowLink`. */
  const linkTo = useCallback(
    (target: RecordTarget): RecordLink => ({ href: target.href, ...stacked(target.record) }),
    [stacked],
  )

  const push = useCallback(
    (target: RecordTarget) => {
      if (target.record === top) return
      const { to, state: marker } = stacked(target.record)
      void navigate(to, { state: marker })
    },
    [stacked, top, navigate],
  )

  /** Drop what this dialog owns from the entry in place: the record on top, or all of it. */
  const clear = useCallback(
    (all: boolean) =>
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          if (all || next.get(RECORD_PARAM) === null) next.delete(param)
          next.delete(RECORD_PARAM)
          next.delete(TAB_PARAM)
          return next
        },
        { replace: true, state: location.state },
      ),
    [param, setSearchParams, location.state],
  )

  // The entry a close already left: a second close before the location moves
  // (Esc and a click in one frame) would go back past the screen itself.
  const left = useRef<string | null>(null)
  // Set while `close` walks back over its entries: the entry it lands on, if
  // nobody pushed it, still names a record and is cleared in place.
  const closing = useRef(false)

  const back = useCallback(() => {
    if (left.current === location.key) return
    left.current = location.key
    if (pushed > 0) void navigate(-1)
    else clear(false)
  }, [location.key, pushed, navigate, clear])

  const close = useCallback(() => {
    if (left.current === location.key) return
    left.current = location.key
    if (pushed === 0) {
      clear(true)
      return
    }
    closing.current = true
    void navigate(-pushed)
  }, [location.key, pushed, navigate, clear])

  useEffect(() => {
    if (!closing.current || location.key === left.current) return
    closing.current = false
    if (value !== null || top !== null) clear(true)
  }, [location.key, value, top, clear])

  // Closed with focus nowhere: back to the row it was opened from, once drawn.
  const previous = useRef(value)
  useEffect(() => {
    const closed = previous.current
    previous.current = value
    if (closed === null || value !== null) return
    const started = Date.now()
    let frame = 0
    const settle = () => {
      const active = document.activeElement
      const inDialog = active !== null && active.closest('.MuiDialog-root') !== null
      // Held somewhere real - MUI gave it back to the opener, or the reader moved on.
      if (active !== null && active !== document.body && active.isConnected && !inDialog) return
      const origin = inDialog ? null : originOf(closed)
      if (origin !== null) origin.focus({ preventScroll: true })
      else if (Date.now() - started < FOCUS_WAIT_MS) frame = requestAnimationFrame(settle)
    }
    frame = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(frame)
  }, [value])

  return { value, top, depth, open, push, linkTo, back, close }
}
