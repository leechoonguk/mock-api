/**
 * The top bar, ported from the reference application's dashboard header.
 *
 * It carries no page title — the page owns that. What sits here is what is true
 * on every screen, and it sits as icon buttons: the language flag and the
 * display settings, each opening a popover. Two properties are
 * load-bearing and both are the reference's:
 *
 *  - it ends where the sidebar ends, in either nav layout;
 *  - the bar is transparent with a blur, so content scrolling under it stays
 *    legible instead of sliding under an opaque strip.
 *
 * It is 72px and never changes: the window does not scroll (the screen's card
 * fills it and scrolls inside), so the reference's shrink-on-scroll never fired
 * and the bar held 92px for nothing.
 *
 * The width subtracts the nav plus its 1px border, or the bar overhangs the
 * sidebar's divider by exactly that pixel.
 *
 * There is deliberately no search field: the screens are the sidebar's list,
 * and a second list of the same entries behind a shortcut is a control that
 * repeats the nav instead of adding a way to reach anything.
 */

import { AppBar, IconButton, Stack, Toolbar } from '@mui/material'
import { useTranslation } from 'react-i18next'
import { alpha } from '@mui/material/styles'
import Iconify from '@/components/iconify/Iconify'
import LanguagePopover from '@/layouts/dashboard/LanguagePopover'
import SettingsDrawer from '@/layouts/dashboard/SettingsDrawer'
import { useSettings } from '@/theme/settings'
import { HEADER, NAV } from '@/config'

const BLUR = 6

const BAR_OPACITY = 0.8

const NAV_BORDER = 1

export default function Header({ onOpenNav }: { onOpenNav: () => void }) {
  const { t } = useTranslation('nav')
  // The bar ends where the sidebar ends, in either of its two layouts — and the
  // two animate over the same duration, or a gap opens between them mid-fold.
  const { navLayout } = useSettings()
  const navWidth = navLayout === 'mini' ? NAV.W_MINI : NAV.W_DASHBOARD

  return (
    <AppBar
      position="fixed"
      sx={{
        boxShadow: 'none',
        zIndex: (theme) => theme.zIndex.appBar + 1,
        backdropFilter: `blur(${BLUR}px)`,
        WebkitBackdropFilter: `blur(${BLUR}px)`,
        backgroundColor: (theme) => alpha(theme.palette.background.default, BAR_OPACITY),
        transition: (theme) =>
          theme.transitions.create('width', {
            duration: theme.transitions.duration.shorter,
          }),
        width: { lg: `calc(100% - ${navWidth + NAV_BORDER}px)` },
        height: { xs: HEADER.H_MOBILE, lg: HEADER.H_DESKTOP },
      }}
    >
      <Toolbar sx={{ height: 1, px: { lg: 5 } }}>
        {/* Below lg the nav is a drawer, and this is its handle. */}
        <IconButton
          onClick={onOpenNav}
          aria-label={t('open_menu')}
          sx={{ mr: 1, color: 'text.primary', display: { lg: 'none' } }}
        >
          <Iconify name="menu" />
        </IconButton>

        <Stack
          direction="row"
          alignItems="center"
          // 8px between 36px icons: each answers a 44px tap under a finger
          // (theme), and at 4px the targets overlapped their neighbours.
          spacing={{ xs: 1, sm: 1.5 }}
          sx={{ flexGrow: 1, justifyContent: 'flex-end' }}
        >
          <LanguagePopover />
          <SettingsDrawer />
        </Stack>
      </Toolbar>
    </AppBar>
  )
}
