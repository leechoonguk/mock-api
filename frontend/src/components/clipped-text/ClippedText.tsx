/**
 * A value that clips, and shows the rest under it on hover.
 *
 * The native `title` attribute was the first attempt and it is not verifiable:
 * the browser draws that tooltip in its own chrome, so nothing in the DOM proves
 * it ever appeared — and reported from the screen, it did not. This renders MUI's
 * `Tooltip`, which mounts a real `[role=tooltip]` node: hovering can be measured,
 * the delay is ours to set, and a touch device gets a long-press instead of
 * nothing.
 *
 * The bubble appears **above the cursor** and then stays where it appeared. Three
 * attempts, all measured: anchored to the element it landed on top of the table
 * header and read as a label for something else (41px from the pointer);
 * `followCursor` closed the distance and cost the stillness, which is worse — text
 * that slides while the eye reads it cannot be read; under the value it was still
 * and calm but nowhere near the hand on a wide column. So the anchor is the point
 * where the pointer entered, captured once: over the cursor, and then motionless.
 *
 * It attaches **only while the text overflows**. A tooltip that repeats a value
 * already fully readable is noise on every cell of every row, and it trains the
 * reader to ignore the one that matters. Overflow is read from the node
 * (`scrollWidth > clientWidth`) and re-read when the element resizes, because a
 * column narrows when the window does.
 *
 * Given `lines`, it wraps to that many lines before it clips (the chat's
 * table, which never scrolls sideways), and the overflow read is the height.
 * Given a `title`, the bubble holds that instead and opens whether or not the
 * value clips: a tier's name stands for its whole path.
 *
 * A snake_case code has no break of its own, so it may break after each
 * underscore (`<wbr>`, nothing copied) before it breaks inside a word.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { Box, Tooltip } from '@mui/material'

/** Long enough not to fire while the pointer crosses a row on its way elsewhere. */
const HOVER_DELAY_MS = 300

/**
 * How far above the cursor the bubble sits: clear of the pointer glyph, close
 * enough to read as the thing under it. MUI's own default is 14px.
 */
const CURSOR_GAP: [number, number] = [0, 12]

/**
 * Named so a frame can let the value wrap where clipping is not the contract: a
 * phone's card row (`phoneCardRows`) prints a value whole rather than cut.
 */
export const CLIPPED_TEXT_CLASS = 'clipped-text'

/** The same value given `lines`: a frame whose line height is its row's (a grid cell) sets a text one. */
export const CLIPPED_LINES_CLASS = 'clipped-text--lines'

const CLIP_SX = {
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const

/** The value wrapped to `lines` lines, the last one ending in an ellipsis. */
const clampSx = (lines: number) =>
  ({
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: lines,
    overflow: 'hidden',
    whiteSpace: 'normal',
    // Hangul breaks between words, as Latin does; a word longer than the line still breaks.
    wordBreak: 'keep-all',
    overflowWrap: 'anywhere',
  }) as const

export default function ClippedText({ text, lines, title }: { text: string; lines?: number; title?: string }) {
  const node = useRef<HTMLElement | null>(null)
  const [overflows, setOverflows] = useState(false)
  /** Where the pointer entered. Captured once, so the bubble does not chase it. */
  const [entry, setEntry] = useState<{ x: number; y: number } | null>(null)

  const measure = useCallback(() => {
    const element = node.current
    if (element === null) return
    setOverflows(
      lines === undefined
        ? element.scrollWidth > element.clientWidth + 1
        : element.scrollHeight > element.clientHeight + 1,
    )
  }, [lines])

  useEffect(() => {
    measure()
    const element = node.current
    if (element === null || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure, text])

  /** A zero-size rect at the entry point: Popper's anchor can be a shape, not a node. */
  const anchor = useMemo(
    () =>
      entry === null
        ? undefined
        : { getBoundingClientRect: () => new DOMRect(entry.x, entry.y, 0, 0) },
    [entry],
  )

  const body = (
    <Box
      component="span"
      ref={node}
      className={lines === undefined ? CLIPPED_TEXT_CLASS : `${CLIPPED_TEXT_CLASS} ${CLIPPED_LINES_CLASS}`}
      sx={lines === undefined ? CLIP_SX : clampSx(lines)}
      onMouseEnter={(event: MouseEvent<HTMLElement>) =>
        setEntry({ x: event.clientX, y: event.clientY })
      }
    >
      {lines === undefined ? text : breakable(text)}
    </Box>
  )

  if (!overflows && (title === undefined || title === text)) return body

  return (
    <Tooltip
      title={title ?? text}
      enterDelay={HOVER_DELAY_MS}
      placement="top"
      slotProps={{
        popper: {
          anchorEl: anchor,
          modifiers: [{ name: 'offset', options: { offset: CURSOR_GAP } }],
        },
      }}
    >
      {body}
    </Tooltip>
  )
}

/** The text with a break opportunity after every underscore. */
function breakable(text: string): ReactNode {
  if (!text.includes('_')) return text
  return text.split('_').map((part, index, parts) =>
    index === parts.length - 1 ? (
      part
    ) : (
      <Fragment key={index}>
        {part}_<wbr />
      </Fragment>
    ),
  )
}
