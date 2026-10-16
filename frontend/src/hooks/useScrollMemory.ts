/**
 * Back lands where the reader had scrolled to.
 *
 * The shell's `main` is the page's one scroll (the window never scrolls), and
 * the browser's own restoration only knows the window: a screen left for
 * another and come back to by back remounts at the top. Measured on a phone: a
 * 50-card page scrolled to 4,140, a record opened from it, a material reached
 * from that record - and three backs later the list stood at 19.
 *
 * So every history entry keeps the scroll `main` had while it was current
 * (keyed by `location.key`, which back and forward return), and a back or
 * forward onto an entry puts it back once the page is tall enough to hold it -
 * a remounted list draws its cards when its page arrives. A reader who touches
 * or wheels the page meanwhile has taken over, and the restore stops.
 */

import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

/** How long a restore waits for the page to grow tall enough. */
const RESTORE_WAIT_MS = 4000

/** Each entry's scroll, for this tab's session. */
const positions = new Map<string, number>()

export function useScrollMemory(main: HTMLElement | null) {
  const { key } = useLocation()
  const navigationType = useNavigationType()
  const current = useRef(key)

  // The scroll is remembered for whichever entry is current when it moves.
  useEffect(() => {
    if (main === null) return
    const remember = () => positions.set(current.current, main.scrollTop)
    main.addEventListener('scroll', remember, { passive: true })
    return () => main.removeEventListener('scroll', remember)
  }, [main])

  useEffect(() => {
    current.current = key
    if (main === null) return
    const saved = positions.get(key)
    if (navigationType !== 'POP' || saved === undefined) {
      positions.set(key, main.scrollTop)
      return
    }
    const started = Date.now()
    let frame = 0
    let takenOver = false
    const takeOver = () => {
      takenOver = true
    }
    const restore = () => {
      if (takenOver) return
      if (main.scrollHeight - main.clientHeight >= saved) {
        main.scrollTop = saved
        return
      }
      if (Date.now() - started < RESTORE_WAIT_MS) frame = requestAnimationFrame(restore)
    }
    main.addEventListener('touchstart', takeOver, { passive: true })
    main.addEventListener('wheel', takeOver, { passive: true })
    restore()
    return () => {
      cancelAnimationFrame(frame)
      main.removeEventListener('touchstart', takeOver)
      main.removeEventListener('wheel', takeOver)
    }
  }, [key, navigationType, main])
}
