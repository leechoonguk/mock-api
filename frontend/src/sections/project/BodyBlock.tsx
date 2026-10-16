/**
 * A request or response body, read in place: titled, bounded, scrolling.
 *
 * The test panel's response and the log panel's request are the same block —
 * one place decides how a body is drawn, so the two cannot drift.
 */

import { Box, Stack, Typography } from '@mui/material'
import { prettyJson } from '@/sections/project/prettyJson'

/**
 * A body is read, not skimmed: give it room and let it scroll. Its bound is a
 * share of the window, as the dialog holding it is.
 */
const BODY_MAX_HEIGHT = '35dvh'

interface BodyBlockProps {
  title: string
  body: string
  /** The sentence shown instead of an empty block. */
  empty: string
}

export default function BodyBlock({ title, body, empty }: BodyBlockProps) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        {title}
      </Typography>
      {body === '' ? (
        <Typography variant="body2" color="text.secondary">
          {empty}
        </Typography>
      ) : (
        <Box
          component="pre"
          sx={{
            m: 0,
            p: 1.5,
            typography: 'caption',
            fontFamily: 'monospace',
            bgcolor: 'background.paper',
            borderRadius: 1,
            maxHeight: BODY_MAX_HEIGHT,
            overflow: 'auto',
            // A body arrives as one long line as often as not, and a `pre` that
            // only scrolls sideways hides the end of every line.
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {prettyJson(body) ?? body}
        </Box>
      )}
    </Stack>
  )
}
