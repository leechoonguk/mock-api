/**
 * What the reader decided about the surface they are reading on.
 *
 * Three settings, all the reference's: the **mode** (light or dark), the
 * **contrast** (whether the page steps away from the cards) and the **nav
 * layout** (the sidebar wide or folded to its glyphs). They live here and
 * not in the theme because they outlive a render — a reader who picked dark
 * expects it on the next machine's first paint, not after a flash of white.
 *
 * Persisted under one key as one object, the way the reference does it
 * (`app-settings`). One key means one read at mount and one write per change;
 * a key per setting drifts the moment a third is added.
 *
 * The first paint has no stored answer to read for a new reader, so the mode
 * falls back to the operating system's (`prefers-color-scheme`). A default of
 * `light` would show a dark-mode user a white screen every time they open the
 * app on a new machine.
 */

import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { ThemeContrast, ThemeMode } from '@/theme/palette'

/**
 * The sidebar's two layouts.
 *
 * `mini` is not a hidden nav: the label stays under the glyph, so a folded
 * column still says which screen each row is. It is the reader's click and
 * nothing else — no screen folds it for them, because a menu that changes shape
 * on its own is a menu they have to re-read.
 */
export type NavLayout = 'vertical' | 'mini'

const STORAGE_KEY = 'app-settings'

/** The media query that answers what the reader's system already decided. */
const DARK_QUERY = '(prefers-color-scheme: dark)'

export interface Settings {
  mode: ThemeMode
  contrast: ThemeContrast
  navLayout: NavLayout
}

interface SettingsValue extends Settings {
  setMode: (mode: ThemeMode) => void
  setContrast: (contrast: ThemeContrast) => void
  setNavLayout: (navLayout: NavLayout) => void
  reset: () => void
}

const SettingsContext = createContext<SettingsValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(readSettings)

  const store = useCallback((next: Settings) => {
    setSettings(next)
    // A quota error or a locked-down browser must not take the app down with
    // it: the choice still applies to this session, it just is not remembered.
    try {
      // Merged, not replaced: `locales/i18n.ts` keeps the reader's language in
      // the same object, and a mode switch must not forget it.
      const held = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null') as object | null
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...held, ...next }))
    } catch {
      /* storage unavailable — the setting holds for this session only */
    }
  }, [])

  const value = useMemo<SettingsValue>(
    () => ({
      ...settings,
      setMode: (mode) => store({ ...settings, mode }),
      setContrast: (contrast) => store({ ...settings, contrast }),
      setNavLayout: (navLayout) => store({ ...settings, navLayout }),
      reset: () => store(systemDefaults()),
    }),
    [settings, store],
  )

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext)
  if (value === null) throw new Error('useSettings must be used inside SettingsProvider')
  return value
}

/** The stored answer, or the system's — read once, while the state initialises. */
function readSettings(): Settings {
  const defaults = systemDefaults()
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === null) return defaults
    const parsed: unknown = JSON.parse(stored)
    if (typeof parsed !== 'object' || parsed === null) return defaults
    const held = parsed as Partial<Settings>
    // Each field is validated on its own: a stored object written by an older
    // version holds the settings it knew about and nothing about the rest.
    return {
      mode: held.mode === 'dark' || held.mode === 'light' ? held.mode : defaults.mode,
      contrast:
        held.contrast === 'high' || held.contrast === 'default'
          ? held.contrast
          : defaults.contrast,
      navLayout:
        held.navLayout === 'mini' || held.navLayout === 'vertical'
          ? held.navLayout
          : defaults.navLayout,
    }
  } catch {
    // Unreadable storage and unparseable JSON answer the same way: the reader
    // gets what their system asked for rather than a crash on first paint.
    return defaults
  }
}

function systemDefaults(): Settings {
  const prefersDark = window.matchMedia(DARK_QUERY).matches
  return { mode: prefersDark ? 'dark' : 'light', contrast: 'default', navLayout: 'vertical' }
}
