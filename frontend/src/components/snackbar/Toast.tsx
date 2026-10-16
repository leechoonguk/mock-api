/**
 * The one shape every toast takes — notistack's content, drawn in this design.
 *
 * notistack's own variants are Material's 2014 snackbar: a dark slab with the
 * sentence in white and, for an error, a red slab loud enough to read as a page
 * failure. Nothing else in this app looks like that, so a "저장했습니다" landed on
 * a light, rounded, shadowed surface and shouted next to it.
 *
 * This is the surface the rest of the app already uses — `background.paper`, the
 * card radius — with the outcome carried by a tinted glyph box rather than by the
 * whole background, the same way `StatCard` and `Label` carry one. The sentence is
 * `subtitle2` on `text.primary`: the toast says one thing, and colour is the
 * second reading, not the first.
 *
 * **What separates it from the page is drawn, not assumed.** The toast is white
 * and so is everything it lands on: `background.default` is white and the header
 * it floats over is white at 80% with a blur — measured ΔL = 0, so the only edge
 * is whatever the shadow draws. `customShadows.z16` spreads **-4px**, which pulls
 * the halo inward and leaves the top and side edges with almost nothing; the
 * reference's own toast uses a spread of 0. So: `z8` (spread 0) plus a 1px
 * hairline, because a shadow alone still vanishes against a white header.
 *
 * One component for both variants, because there is one shape: success and error
 * differ by a palette key and a glyph, and two components would be two shapes
 * one edit apart from disagreeing.
 */

import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { SnackbarContent, useSnackbar } from 'notistack'
import type { CustomContentProps } from 'notistack'
import { alpha, IconButton, Paper, Stack, Typography } from '@mui/material'
import Iconify from '@/components/iconify/Iconify'
import type { ActionIcon } from '@/components/iconify/icons'
import { BORDER_RADIUS } from '@/theme/overrides'

/** The glyph box, matching `StatCard`'s tinted badge at the smaller toast scale. */
const GLYPH_BOX_SIZE = 40

const GLYPH_SIZE = 24

const DISMISS_GLYPH_SIZE = 18

/** Wide enough for a two-line server sentence, narrow enough to stay a toast. */
const TOAST_MAX_WIDTH = 360

const TONES: Record<string, { palette: 'success' | 'error'; icon: ActionIcon }> = {
  success: { palette: 'success', icon: 'success' },
  error: { palette: 'error', icon: 'alert' },
}

const Toast = forwardRef<HTMLDivElement, CustomContentProps>(({ id, message, variant }, ref) => {
  const { t } = useTranslation('common')
  const { closeSnackbar } = useSnackbar()
  const tone = TONES[variant] ?? TONES.success

  return (
    <SnackbarContent ref={ref} role="alert">
      <Paper
        sx={{
          px: 2,
          py: 1.5,
          width: '100%',
          maxWidth: TOAST_MAX_WIDTH,
          borderRadius: `${BORDER_RADIUS * 1.5}px`,
          boxShadow: (theme) => theme.customShadows.z8,
          border: (theme) => `1px solid ${alpha(theme.palette.grey[500], 0.16)}`,
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5} useFlexGap>
          <Stack
            alignItems="center"
            justifyContent="center"
            sx={{
              width: GLYPH_BOX_SIZE,
              height: GLYPH_BOX_SIZE,
              flexShrink: 0,
              borderRadius: `${BORDER_RADIUS}px`,
              color: `${tone.palette}.dark`,
              bgcolor: (theme) => alpha(theme.palette[tone.palette].main, 0.16),
            }}
          >
            <Iconify name={tone.icon} width={GLYPH_SIZE} />
          </Stack>

          <Typography variant="subtitle2" sx={{ flexGrow: 1, minWidth: 0 }}>
            {message}
          </Typography>

          <IconButton
            size="small"
            aria-label={t('actions.close')}
            onClick={() => closeSnackbar(id)}
            sx={{ flexShrink: 0, color: 'text.disabled', '&:hover': { color: 'text.primary' } }}
          >
            <Iconify name="close" width={DISMISS_GLYPH_SIZE} />
          </IconButton>
        </Stack>
      </Paper>
    </SnackbarContent>
  )
})

Toast.displayName = 'Toast'

export default Toast
