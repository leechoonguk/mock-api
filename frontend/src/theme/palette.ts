/**
 * The palette, ported from the reference application — Minimal v7's values.
 *
 * These are exact values, not approximations, and they are **measured off the
 * running reference** (`minimals.cc`, v7.7.0) rather than copied from the v4
 * source in `template/`: the two generations differ in every tone, and the app
 * was a generation behind (`primary.main` `#00AB55` against v7's `#00A76F`,
 * `grey.800` `#212B36` against `#1C252E`, a blue `secondary` against a purple
 * one). A screen beside the reference read as a different product.
 *
 * The greys carry the surface hierarchy (`background.neutral` is GREY[200],
 * which every table header and dialog body uses), and `lighter`/`darker` on each
 * colour is what the soft `Label` variant reads.
 *
 * **The palette is a function of the mode and the contrast**, because those are
 * the two settings a reader can change. A colour picked in a component instead
 * of here has no dark counterpart and no soft variant.
 */

import { alpha } from '@mui/material/styles'

declare module '@mui/material/styles' {
  interface TypeBackground {
    neutral: string
  }
  interface SimplePaletteColorOptions {
    lighter: string
    darker: string
  }
  interface PaletteColor {
    lighter: string
    darker: string
  }
}

/** Light or dark, the only two the theme builds. */
export type ThemeMode = 'light' | 'dark'

/**
 * Whether the page stands away from the cards on it.
 *
 * `default` is a white page holding white cards, separated by their shadow;
 * `high` drops the page to `background.neutral` so every card has an edge. The
 * reference offers exactly this pair, and the values are its own (measured:
 * `#FFFFFF` → `#F4F6F8`).
 */
export type ThemeContrast = 'default' | 'high'

export const GREY = {
  0: '#FFFFFF',
  50: '#FCFDFD',
  100: '#F9FAFB',
  200: '#F4F6F8',
  300: '#DFE3E8',
  400: '#C4CDD5',
  500: '#919EAB',
  600: '#637381',
  700: '#454F5B',
  800: '#1C252E',
  900: '#141A21',
}

/** The dark page's card surface — the one grey that is neither 800 nor 900. */
const DARK_NEUTRAL = '#28323D'

const PRIMARY = {
  lighter: '#C8FAD6',
  light: '#5BE49B',
  main: '#00A76F',
  dark: '#007867',
  darker: '#004B50',
  contrastText: '#FFFFFF',
}

const SECONDARY = {
  lighter: '#EFD6FF',
  light: '#C684FF',
  main: '#8E33FF',
  dark: '#5119B7',
  darker: '#27097A',
  contrastText: '#FFFFFF',
}

const INFO = {
  lighter: '#CAFDF5',
  light: '#61F3F3',
  main: '#00B8D9',
  dark: '#006C9C',
  darker: '#003768',
  contrastText: '#FFFFFF',
}

const SUCCESS = {
  lighter: '#D3FCD2',
  light: '#77ED8B',
  main: '#22C55E',
  dark: '#118D57',
  darker: '#065E49',
  contrastText: '#FFFFFF',
}

const WARNING = {
  lighter: '#FFF5CC',
  light: '#FFD666',
  main: '#FFAB00',
  dark: '#B76E00',
  darker: '#7A4100',
  contrastText: GREY[800],
}

const ERROR = {
  lighter: '#FFE9D5',
  light: '#FFAC82',
  main: '#FF5630',
  dark: '#B71D18',
  darker: '#7A0916',
  contrastText: '#FFFFFF',
}

/** What both modes share: the tones, the greys, and the action opacities. */
const COMMON = {
  common: { black: '#000000', white: '#FFFFFF' },
  primary: PRIMARY,
  secondary: SECONDARY,
  info: INFO,
  success: SUCCESS,
  warning: WARNING,
  error: ERROR,
  grey: GREY,
  divider: alpha(GREY[500], 0.2),
  action: {
    hover: alpha(GREY[500], 0.08),
    selected: alpha(GREY[500], 0.16),
    disabled: alpha(GREY[500], 0.8),
    disabledBackground: alpha(GREY[500], 0.24),
    focus: alpha(GREY[500], 0.24),
    hoverOpacity: 0.08,
    disabledOpacity: 0.48,
  },
}

/**
 * The palette for one mode and one contrast.
 *
 * Contrast moves the **page**, never the card: a card is `background.paper` in
 * both settings, so nothing a screen writes has to know which one is on. In
 * dark the page already sits below the card (`#141A21` under `#1C252E`), which
 * is what contrast buys in light — so the setting is a light-mode distinction
 * and `SettingsDrawer` says so rather than offering a switch that does nothing.
 */
export function buildPalette(mode: ThemeMode, contrast: ThemeContrast) {
  if (mode === 'dark') {
    return {
      ...COMMON,
      mode,
      text: { primary: '#FFFFFF', secondary: GREY[500], disabled: GREY[600] },
      background: { paper: GREY[800], default: GREY[900], neutral: DARK_NEUTRAL },
      action: { ...COMMON.action, active: GREY[500] },
    }
  }

  return {
    ...COMMON,
    mode,
    text: { primary: GREY[800], secondary: GREY[600], disabled: GREY[500] },
    background: {
      paper: '#FFFFFF',
      default: contrast === 'high' ? GREY[200] : '#FFFFFF',
      neutral: GREY[200],
    },
    action: { ...COMMON.action, active: GREY[600] },
  }
}

/**
 * The light palette, for the modules that read a colour outside a theme
 * (`shadows.ts` tints `primary.main` for its named shadows).
 */
export const palette = buildPalette('light', 'default')
