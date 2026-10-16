/**
 * The theme, assembled from the ported design tokens and the reader's settings.
 *
 * `customShadows` is added to the theme object so a component can read
 * `theme.customShadows.card` instead of pasting a shadow string; the module
 * augmentation below is what makes that type-safe.
 *
 * **Everything the mode changes is rebuilt here, in one memo.** The palette, the
 * elevation array and the named shadows all take the mode, so a screen never
 * asks which one is on — it reads `background.paper` and gets the right surface.
 * The memo's dependencies are the settings themselves: rebuilding the theme on
 * every render would give every `styled` component a new class on every paint.
 */

import { createTheme, CssBaseline, ThemeProvider as MuiThemeProvider } from '@mui/material'
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import '@fontsource/public-sans/400.css'
import '@fontsource/public-sans/500.css'
import '@fontsource/public-sans/600.css'
import '@fontsource/public-sans/700.css'
import '@fontsource/public-sans/800.css'
// Hangul from Pretendard, split by unicode-range so a page loads only the
// glyphs it shows; Latin stays Public Sans, which the column floors were measured in.
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import { buildPalette } from '@/theme/palette'
import { typography } from '@/theme/typography'
import { buildCustomShadows, buildShadows } from '@/theme/shadows'
import type { CustomShadows } from '@/theme/shadows'
import { SettingsProvider, useSettings } from '@/theme/settings'
import { BORDER_RADIUS, componentOverrides } from '@/theme/overrides'

declare module '@mui/material/styles' {
  interface Theme {
    customShadows: CustomShadows
  }
  interface ThemeOptions {
    customShadows?: CustomShadows
  }
}

export default function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <SettingsProvider>
      <SettingsAwareTheme>{children}</SettingsAwareTheme>
    </SettingsProvider>
  )
}

/**
 * The provider proper, one level in — it reads the settings, so it has to sit
 * under the store that holds them.
 */
function SettingsAwareTheme({ children }: { children: ReactNode }) {
  const { mode, contrast } = useSettings()

  const theme = useMemo(() => {
    const base = createTheme({
      palette: buildPalette(mode, contrast),
      typography,
      shadows: buildShadows(mode) as never,
      customShadows: buildCustomShadows(mode),
      shape: { borderRadius: BORDER_RADIUS },
    })
    return createTheme(base, { components: componentOverrides(base) })
  }, [mode, contrast])

  return (
    <MuiThemeProvider theme={theme}>
      {/* `enableColorScheme` hands the mode to the browser, so form controls,
          scrollbars and the page behind a short screen follow it too. */}
      <CssBaseline enableColorScheme />
      {children}
    </MuiThemeProvider>
  )
}
