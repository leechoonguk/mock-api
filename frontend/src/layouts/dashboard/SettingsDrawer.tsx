/**
 * The surface settings, ported from the reference application's drawer.
 *
 * Two rows, and only two: the **mode** and the **contrast**. The reference also
 * offers right-to-left, a font family and size, six colour presets and three nav
 * layouts — none of which this app can honour. RTL has no language here; the
 * type scale is what `check-frontend-design` sizes every grid column against, so
 * a reader-chosen font would invalidate the column floors the moment it applied;
 * and an internal tool has one brand, so a preset row would be six ways to be
 * off-brand.
 *
 * Contrast is a light-mode distinction and the drawer says so instead of
 * offering a dead switch: in dark the page (`background.default`) already sits
 * below the card (`background.paper`), which is what contrast buys in light.
 *
 * Each row is a card the whole of which is the control — the reference's shape,
 * and the reason is the hit area: a 20px switch on a 360px drawer is a target
 * the pointer has to find. The card is the switch's `<label>`, so a tap anywhere
 * on it toggles; measured before, only the 58×38 switch answered.
 *
 * Under a finger back closes the drawer (`useBackCloses`); measured before, it
 * left the page under it.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Box, Drawer, IconButton, Stack, Switch, Tooltip, Typography, useMediaQuery } from '@mui/material'
import { alpha } from '@mui/material/styles'
import Iconify from '@/components/iconify/Iconify'
import { TOUCH_QUERY, useBackCloses } from '@/hooks/useBackCloses'
import { useSettings } from '@/theme/settings'

const DRAWER_WIDTH = 360

/** The tinted square each row's glyph sits in — `StatCard`'s badge, smaller. */
const GLYPH_BOX = 40

const GLYPH_SIZE = 24

export default function SettingsDrawer() {
  const { t } = useTranslation('nav')
  const { mode, contrast, setMode, setContrast } = useSettings()
  const [open, setOpen] = useState(false)
  const touch = useMediaQuery(TOUCH_QUERY)
  useBackCloses(open, () => setOpen(false), 'settings', touch)

  const dark = mode === 'dark'

  return (
    <>
      <IconButton
        onClick={() => setOpen(true)}
        aria-label={t('settings.open')}
        sx={{ color: 'text.primary', ...(open && { bgcolor: 'action.selected' }) }}
      >
        <Iconify name="settings" />
      </IconButton>

      <Drawer
        open={open}
        anchor="right"
        onClose={() => setOpen(false)}
        slotProps={{ paper: { sx: { width: DRAWER_WIDTH } } }}
      >
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          sx={{ py: 2, pr: 1, pl: 2.5 }}
        >
          <Typography variant="h6">{t('settings.title')}</Typography>
          <IconButton onClick={() => setOpen(false)} aria-label={t('settings.close')}>
            <Iconify name="close" />
          </IconButton>
        </Stack>

        <Stack spacing={2} sx={{ p: 2.5 }}>
          <SettingRow
            label={t('settings.mode')}
            caption={t(dark ? 'settings.mode_dark' : 'settings.mode_light')}
            icon={dark ? 'moon' : 'sun'}
            checked={dark}
            onChange={(next) => setMode(next ? 'dark' : 'light')}
          />

          <SettingRow
            label={t('settings.contrast')}
            caption={t(dark ? 'settings.contrast_dark_only' : 'settings.contrast_hint')}
            icon="contrast"
            checked={contrast === 'high'}
            disabled={dark}
            onChange={(next) => setContrast(next ? 'high' : 'default')}
          />
        </Stack>
      </Drawer>
    </>
  )
}

interface SettingRowProps {
  label: string
  caption: string
  icon: 'moon' | 'sun' | 'contrast'
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}

/**
 * One setting: a glyph, its name, what it does, and the switch that does it.
 *
 * The card carries the state as a tint rather than only through the switch —
 * on a 360px column the switch alone is 20px of answer to "which of these is on".
 */
function SettingRow({ label, caption, icon, checked, disabled, onChange }: SettingRowProps) {
  return (
    <Tooltip title={disabled === true ? caption : ''} placement="left">
      <Stack
        component="label"
        direction="row"
        alignItems="center"
        spacing={2}
        useFlexGap
        sx={{
          p: 2,
          borderRadius: 2,
          bgcolor: 'background.neutral',
          opacity: disabled === true ? 0.48 : 1,
          cursor: disabled === true ? 'default' : 'pointer',
        }}
      >
        <Stack
          alignItems="center"
          justifyContent="center"
          sx={{
            width: GLYPH_BOX,
            height: GLYPH_BOX,
            flexShrink: 0,
            borderRadius: 1,
            color: checked ? 'primary.dark' : 'text.secondary',
            bgcolor: (theme) =>
              checked
                ? alpha(theme.palette.primary.main, 0.16)
                : alpha(theme.palette.grey[500], 0.12),
          }}
        >
          <Iconify name={icon} width={GLYPH_SIZE} />
        </Stack>

        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="subtitle2">{label}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {caption}
          </Typography>
        </Box>

        <Switch
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          slotProps={{ input: { 'aria-label': label } }}
        />
      </Stack>
    </Tooltip>
  )
}
