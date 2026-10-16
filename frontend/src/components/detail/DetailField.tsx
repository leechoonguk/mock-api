/**
 * One label/value pair inside a detail section, ported from the reference
 * application.
 *
 * The label is `caption` in secondary text above the value, never beside it: a
 * two-column label/value table breaks at narrow widths, while a stacked pair
 * reflows. An absent value renders a dash, so a blank cell always means "no
 * value" rather than "did not load".
 */

import { Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

const EMPTY_VALUE = '-'

interface DetailFieldProps {
  label: string
  children?: ReactNode
}

export default function DetailField({ label, children }: DetailFieldProps) {
  return (
    <Stack spacing={0.25}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      {/* A path or a key has no space to break at: `/1471000/FoodQrInfoService02/…`
          ran 143px past a phone's dialog and the whole body scrolled sideways. */}
      <Typography variant="body2" component="div" sx={{ overflowWrap: 'anywhere' }}>
        {children ?? EMPTY_VALUE}
      </Typography>
    </Stack>
  )
}
