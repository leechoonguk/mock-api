/**
 * The application shell, ported from the reference application.
 *
 * The header is fixed, so the main column's top padding is derived from the
 * header height plus one gap — never a literal, or content sits under the bar on
 * whichever screen was not adjusted.
 *
 * The nav is docked from `lg` up and a drawer below it, opened from the header's
 * menu button: the shell is one code path on a phone, a tablet and a desktop,
 * and the breakpoint is the header's own. Measured before this: a permanent
 * 280px nav at 390px left the content 78px wide, and at 820px a third of the
 * screen.
 *
 * Below `lg` the drawer is an overlay, and back closes it (`useBackCloses`):
 * measured before, back with the drawer open left the list for the dashboard.
 * A nav link inside it *replaces* the drawer's entry with the screen it names,
 * so back from that screen returns to the one the drawer was opened over, not
 * to a drawer.
 *
 * `main` is the page's one scroll, and back returns to where it stood
 * (`useScrollMemory`): the browser's own restoration knows only the window.
 */

import { useCallback, useState } from 'react'
import type { MouseEvent } from 'react'
import { Box, useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material'
import { Outlet, useNavigate } from 'react-router-dom'
import { useBackCloses } from '@/hooks/useBackCloses'
import { useScrollMemory } from '@/hooks/useScrollMemory'
import Header from '@/layouts/dashboard/Header'
import SkipLink from '@/layouts/dashboard/SkipLink'
import NavVertical from '@/layouts/dashboard/NavVertical'
import { HEADER, MAIN_SPACING, SHORT_WINDOW_MEDIA } from '@/config'

/** What the skip link moves focus to. */
const MAIN_ID = 'main-content'

export default function DashboardLayout() {
  const [navOpen, setNavOpen] = useState(false)
  const closeNav = useCallback(() => setNavOpen(false), [])
  // The nav's own breakpoint: docked from `lg` up, where there is nothing for back to close.
  const drawer = useMediaQuery((theme: Theme) => theme.breakpoints.down('lg'))
  useBackCloses(navOpen, closeNav, 'nav', drawer)
  // State, not a ref: `useScrollMemory` must see the element once it mounts.
  const [main, setMain] = useState<HTMLElement | null>(null)
  useScrollMemory(main)
  const navigate = useNavigate()
  /**
   * A link chosen in the open drawer takes the drawer's place in history. React
   * events reach this wrapper through the drawer's portal; the link's own
   * handler sees `defaultPrevented` and does not push a second entry.
   */
  const replaceDrawerEntry = (event: MouseEvent<HTMLElement>) => {
    if (!navOpen || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
    const anchor = (event.target as Element).closest('a[href]')
    const href = anchor?.getAttribute('href')
    if (href === null || href === undefined || !href.startsWith('/')) return
    event.preventDefault()
    void navigate(href, { replace: true })
  }

  return (
    <>
      <SkipLink target={MAIN_ID} />
      <Header onOpenNav={() => setNavOpen(true)} />

      {/* The shell is the window: the document never scrolls, main does. */}
      <Box sx={{ display: 'flex', height: '100dvh' }}>
        <Box sx={{ display: 'contents' }} onClickCapture={replaceDrawerEntry}>
          <NavVertical open={navOpen} onClose={closeNav} />
        </Box>

        <Box
          component="main"
          ref={setMain}
          id={MAIN_ID}
          // Focusable by script only: the skip link's target, not a Tab stop.
          tabIndex={-1}
          sx={{
            // The permanent drawer already occupies its width in this flex row,
            // so main only grows into what is left. Subtracting the nav width
            // here as well squeezed the content into a narrow strip.
            flexGrow: 1,
            minWidth: 0,
            // A column a screen's surface grows into (`ScreenCard`, `flex: 1`);
            // past the surface's floor on a short window, main scrolls itself.
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            bgcolor: 'background.neutral',
            px: { xs: 2, lg: 5 },
            pt: { xs: `${HEADER.H_MOBILE + MAIN_SPACING}px`, lg: `${HEADER.H_DESKTOP + MAIN_SPACING}px` },
            pb: { xs: 2, lg: 5 },
            // A laptop's foot is a phone's: 24px more of the surface above it.
            [SHORT_WINDOW_MEDIA]: { pb: 2 },
          }}
        >
          <Outlet />
        </Box>
      </Box>
    </>
  )
}
