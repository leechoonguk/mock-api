/**
 * Follow a record link the way a link is followed: a plain click or Enter
 * stacks the record over the screen (`useUrlDialog`'s `linkTo`), and a
 * modifier or middle click opens the record's own screen in a new tab - the
 * same split a browser makes for an `<a href>`, for the places a record is
 * reached through a table row rather than an anchor (`rowLink`).
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { KeyboardEvent, MouseEvent } from 'react'
import type { RecordLink } from '@/hooks/useUrlDialog'

/** The middle button's `MouseEvent.button`: a new tab, as on an anchor. */
export const MIDDLE_BUTTON = 1

/** Whether a click asks for a new tab, as the browser reads it on an anchor. */
export const opensTab = (event: MouseEvent | KeyboardEvent): boolean =>
  event.metaKey || event.ctrlKey || event.shiftKey || ('button' in event && event.button === MIDDLE_BUTTON)

export function useFollowRecord() {
  const navigate = useNavigate()
  return useCallback(
    (link: RecordLink, event?: MouseEvent | KeyboardEvent) => {
      if (event !== undefined && opensTab(event)) {
        window.open(link.href, '_blank', 'noopener')
        return
      }
      void navigate(link.to, { state: link.state })
    },
    [navigate],
  )
}
