/**
 * i18n initialisation.
 *
 * Korean is both the default and the fallback: this is a Korean-first product,
 * so an untranslated English key must fall back to text a user can read rather
 * than to the key itself. Interpolation escaping is off because React already
 * escapes everything it renders — leaving it on double-escapes names.
 *
 * The reader's choice of language is remembered in the same `app-settings`
 * object the theme keeps its mode in (`theme/settings.tsx`), under `language`.
 * It is read here, before `init`, because this module runs before the first
 * render: a language applied in an effect painted the page in Korean first
 * and then swapped every word. Measured: English chosen in the header was
 * Korean again after a reload, and nothing in storage said otherwise.
 */

import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from '@/locales/en'
import { ko } from '@/locales/ko'

export const DEFAULT_LANGUAGE = 'ko'

export const SUPPORTED_LANGUAGES = ['ko', 'en'] as const

type Language = (typeof SUPPORTED_LANGUAGES)[number]

/** The key `theme/settings.tsx` stores its object under; this module adds one field. */
const SETTINGS_KEY = 'app-settings'

function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.some((language) => language === value)
}

function readStoredSettings(): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function storedLanguage(): Language {
  const held = readStoredSettings().language
  return isLanguage(held) ? held : DEFAULT_LANGUAGE
}

function storeLanguage(language: string): void {
  if (!isLanguage(language)) return
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...readStoredSettings(), language }))
  } catch {
    /* storage unavailable — the language holds for this session only */
  }
}

void i18next.use(initReactI18next).init({
  resources: { ko, en },
  lng: storedLanguage(),
  fallbackLng: DEFAULT_LANGUAGE,
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

// The document says which language it is in, so a screen reader pronounces it
// and the browser offers no translation of a Korean page into Korean.
document.documentElement.lang = i18next.language
i18next.on('languageChanged', (lng) => {
  document.documentElement.lang = lng
  storeLanguage(lng)
})

export default i18next
