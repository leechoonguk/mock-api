/**
 * Status chip, ported from the reference application's `Label`.
 *
 * Not MUI's `Chip`: the design is a 24px-high, 6px-radius, bold-12px badge whose
 * `soft` variant is a 16%-alpha tint of the colour with the dark shade as text.
 * That combination is what makes a table of statuses readable at a glance, and
 * it is the same badge in a grid cell, a dialog header and a tab count.
 */

import { alpha, styled } from '@mui/material'
import type { ReactNode } from 'react'

type ColorKey = 'primary' | 'secondary' | 'info' | 'success' | 'warning' | 'error'

type LabelColor = 'default' | ColorKey

type LabelVariant = 'filled' | 'outlined' | 'soft'

interface LabelProps {
  color?: LabelColor
  variant?: LabelVariant
  children: ReactNode
}

const StyledLabel = styled('span', {
  shouldForwardProp: (prop) => prop !== 'ownerState',
})<{ ownerState: { color: LabelColor; variant: LabelVariant } }>(({ theme, ownerState }) => {
  const isDefault = ownerState.color === 'default'
  const tone = theme.palette[isDefault ? 'primary' : (ownerState.color as ColorKey)]

  return {
    height: 24,
    minWidth: 22,
    lineHeight: 0,
    borderRadius: 6,
    cursor: 'default',
    alignItems: 'center',
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    justifyContent: 'center',
    padding: theme.spacing(0, 1),
    fontSize: theme.typography.pxToRem(12),
    fontFamily: theme.typography.fontFamily,
    fontWeight: theme.typography.fontWeightBold,
    ...(ownerState.variant === 'filled' && {
      color: isDefault ? theme.palette.common.white : tone.contrastText,
      backgroundColor: isDefault ? theme.palette.grey[800] : tone.main,
    }),
    ...(ownerState.variant === 'outlined' && {
      backgroundColor: 'transparent',
      color: isDefault ? theme.palette.text.primary : tone.main,
      border: `1px solid ${isDefault ? alpha(theme.palette.grey[500], 0.32) : tone.main}`,
    }),
    ...(ownerState.variant === 'soft' && {
      // The text takes the shade that reads against the surface: `dark` on a
      // light page, `light` on a dark one. `dark` in both modes is a badge that
      // disappears into its own 16% tint on a dark page.
      color: isDefault
        ? theme.palette.text.primary
        : theme.palette.mode === 'dark'
          ? tone.light
          : tone.dark,
      backgroundColor: alpha(isDefault ? theme.palette.grey[500] : tone.main, 0.16),
    }),
  }
})

export default function Label({ color = 'default', variant = 'soft', children }: LabelProps) {
  return <StyledLabel ownerState={{ color, variant }}>{children}</StyledLabel>
}
