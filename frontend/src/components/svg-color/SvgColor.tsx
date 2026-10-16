/**
 * A local SVG rendered as a colour, ported from the reference application.
 *
 * The file is used as a CSS mask over `currentColor`, not as an `<img>`, which
 * is the whole point: a navigation icon has to turn primary-green the moment its
 * item becomes active, and an image cannot inherit colour. Every navbar glyph in
 * `public/assets/icons/navbar/` goes through here.
 */

import { Box } from '@mui/material'
import type { SxProps, Theme } from '@mui/material'

const DEFAULT_SIZE = 24

interface SvgColorProps {
  src: string
  sx?: SxProps<Theme>
}

export default function SvgColor({ src, sx }: SvgColorProps) {
  return (
    <Box
      component="span"
      sx={{
        width: DEFAULT_SIZE,
        height: DEFAULT_SIZE,
        display: 'inline-block',
        bgcolor: 'currentColor',
        mask: `url(${src}) no-repeat center / contain`,
        WebkitMask: `url(${src}) no-repeat center / contain`,
        ...sx,
      }}
    />
  )
}
