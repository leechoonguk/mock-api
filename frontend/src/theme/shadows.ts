/**
 * Shadows, ported from the reference application.
 *
 * Two sets, because they answer different questions. MUI's 25-step `shadows`
 * array is what `elevation` reads; `customShadows` is the named set the design
 * actually uses — `card`, `dialog`, `dropdown` are specific two-layer shadows
 * that no elevation step reproduces, which is why a component that writes its
 * own `boxShadow` never matches the ones beside it.
 *
 * **The tint follows the mode.** A shadow is grey on a light page and black on a
 * dark one: measured on the reference, the same card carries
 * `rgba(145,158,171,…)` in light and `rgba(0,0,0,…)` in dark. Grey on a
 * a dark page is a *lighter* halo — a glow where a shadow belongs.
 */

import { alpha } from '@mui/material/styles'
import { GREY, palette } from '@/theme/palette'
import type { ThemeMode } from '@/theme/palette'

/** The tint each mode casts with: grey on a light page, black on a dark one. */
const SHADOW_COLOR: Record<ThemeMode, string> = { light: GREY[500], dark: palette.common.black }

function elevations(color: string): string[] {
  const first = alpha(color, 0.2)
  const second = alpha(color, 0.14)
  const third = alpha(color, 0.12)
  return [
    'none',
    `0px 2px 1px -1px ${first},0px 1px 1px 0px ${second},0px 1px 3px 0px ${third}`,
    `0px 3px 1px -2px ${first},0px 2px 2px 0px ${second},0px 1px 5px 0px ${third}`,
    `0px 3px 3px -2px ${first},0px 3px 4px 0px ${second},0px 1px 8px 0px ${third}`,
    `0px 2px 4px -1px ${first},0px 4px 5px 0px ${second},0px 1px 10px 0px ${third}`,
    `0px 3px 5px -1px ${first},0px 5px 8px 0px ${second},0px 1px 14px 0px ${third}`,
    `0px 3px 5px -1px ${first},0px 6px 10px 0px ${second},0px 1px 18px 0px ${third}`,
    `0px 4px 5px -2px ${first},0px 7px 10px 1px ${second},0px 2px 16px 1px ${third}`,
    `0px 5px 5px -3px ${first},0px 8px 10px 1px ${second},0px 3px 14px 2px ${third}`,
    `0px 5px 6px -3px ${first},0px 9px 12px 1px ${second},0px 3px 16px 2px ${third}`,
    `0px 6px 6px -3px ${first},0px 10px 14px 1px ${second},0px 4px 18px 3px ${third}`,
    `0px 6px 7px -4px ${first},0px 11px 15px 1px ${second},0px 4px 20px 3px ${third}`,
    `0px 7px 8px -4px ${first},0px 12px 17px 2px ${second},0px 5px 22px 4px ${third}`,
    `0px 7px 8px -4px ${first},0px 13px 19px 2px ${second},0px 5px 24px 4px ${third}`,
    `0px 7px 9px -4px ${first},0px 14px 21px 2px ${second},0px 5px 26px 4px ${third}`,
    `0px 8px 9px -5px ${first},0px 15px 22px 2px ${second},0px 6px 28px 5px ${third}`,
    `0px 8px 10px -5px ${first},0px 16px 24px 2px ${second},0px 6px 30px 5px ${third}`,
    `0px 8px 11px -5px ${first},0px 17px 26px 2px ${second},0px 6px 32px 5px ${third}`,
    `0px 9px 11px -5px ${first},0px 18px 28px 2px ${second},0px 7px 34px 6px ${third}`,
    `0px 9px 12px -6px ${first},0px 19px 29px 2px ${second},0px 7px 36px 6px ${third}`,
    `0px 10px 13px -6px ${first},0px 20px 31px 3px ${second},0px 8px 38px 7px ${third}`,
    `0px 10px 13px -6px ${first},0px 21px 33px 3px ${second},0px 8px 40px 7px ${third}`,
    `0px 10px 14px -6px ${first},0px 22px 35px 3px ${second},0px 8px 42px 7px ${third}`,
    `0px 11px 14px -7px ${first},0px 23px 36px 3px ${second},0px 9px 44px 8px ${third}`,
    `0px 11px 15px -7px ${first},0px 24px 38px 3px ${second},0px 9px 46px 8px ${third}`,
  ]
}

function named(color: string) {
  const transparent = alpha(color, 0.16)
  return {
    z1: `0 1px 2px 0 ${transparent}`,
    z4: `0 4px 8px 0 ${transparent}`,
    z8: `0 8px 16px 0 ${transparent}`,
    z12: `0 12px 24px -4px ${transparent}`,
    z16: `0 16px 32px -4px ${transparent}`,
    z20: `0 20px 40px -4px ${transparent}`,
    z24: `0 24px 48px 0 ${transparent}`,
    primary: `0 8px 16px 0 ${alpha(palette.primary.main, 0.24)}`,
    secondary: `0 8px 16px 0 ${alpha(palette.secondary.main, 0.24)}`,
    info: `0 8px 16px 0 ${alpha(palette.info.main, 0.24)}`,
    success: `0 8px 16px 0 ${alpha(palette.success.main, 0.24)}`,
    warning: `0 8px 16px 0 ${alpha(palette.warning.main, 0.24)}`,
    error: `0 8px 16px 0 ${alpha(palette.error.main, 0.24)}`,
    card: `0 0 2px 0 ${alpha(color, 0.2)}, 0 12px 24px -4px ${alpha(color, 0.12)}`,
    dialog: `-40px 40px 80px -8px ${alpha(color, 0.24)}`,
    dropdown: `0 0 2px 0 ${alpha(color, 0.24)}, -20px 20px 40px -4px ${alpha(color, 0.24)}`,
  }
}

export const buildShadows = (mode: ThemeMode) => elevations(SHADOW_COLOR[mode])

export const buildCustomShadows = (mode: ThemeMode) => named(SHADOW_COLOR[mode])

export type CustomShadows = ReturnType<typeof buildCustomShadows>
