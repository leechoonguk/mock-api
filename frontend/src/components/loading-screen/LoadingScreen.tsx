/**
 * The fallback shown while a route chunk loads.
 *
 * Routes are code-split, so there is a real gap between the click and the
 * screen. A blank page during that gap is indistinguishable from a crash.
 */

import { CircularProgress, Stack } from '@mui/material'

const MIN_HEIGHT = 320

export default function LoadingScreen() {
  return (
    <Stack alignItems="center" justifyContent="center" sx={{ minHeight: MIN_HEIGHT }}>
      <CircularProgress />
    </Stack>
  )
}
