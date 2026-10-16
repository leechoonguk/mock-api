/**
 * The icon registry — every icon this app draws, named by what it means.
 *
 * Two systems, split by role, exactly as the reference application splits them:
 *
 *   `ACTION_ICONS`  inline UI icons from Iconify's **eva** set, filled variants.
 *                   One family and one weight, because an `eva:edit-fill` beside
 *                   an `eva:edit-outline` beside a `solar:pen-bold` is three
 *                   different drawings of one idea.
 *   `NAV_ICONS`     local SVGs under `public/assets/icons/navbar/`, drawn through
 *                   `SvgColor` so they inherit the nav item's colour and turn
 *                   primary when it is active.
 *
 * Screens reference these names, never an icon string: a raw string is how a
 * fifth family arrives, and `check-frontend-design` rejects one.
 */

export const ACTION_ICONS = {
  add: 'eva:plus-fill',
  edit: 'eva:edit-fill',
  delete: 'eva:trash-2-fill',
  view: 'eva:eye-fill',
  close: 'eva:close-fill',
  search: 'eva:search-fill',
  refresh: 'eva:refresh-fill',
  run: 'eva:play-circle-fill',
  back: 'eva:arrow-back-fill',
  density: 'eva:menu-2-fill',
  menu: 'eva:menu-fill',
  logout: 'eva:log-out-fill',
  expand: 'eva:arrow-ios-downward-fill',
  collapse: 'eva:arrow-ios-upward-fill',
  info: 'eva:info-fill',
  lock: 'eva:lock-fill',
  shield: 'eva:shield-fill',
  empty: 'eva:inbox-fill',
  check: 'eva:checkmark-fill',
  success: 'eva:checkmark-circle-2-fill',
  alert: 'eva:alert-triangle-fill',
  link: 'eva:link-2-fill',
  layers: 'eva:layers-fill',
  people: 'eva:people-fill',
  clock: 'eva:clock-fill',
  server: 'eva:hard-drive-fill',
  stop: 'eva:stop-circle-fill',
  download: 'eva:download-fill',
  bell: 'eva:bell-fill',
  fold: 'eva:arrow-ios-back-fill',
  unfold: 'eva:arrow-ios-forward-fill',
  settings: 'eva:settings-2-fill',
  moon: 'eva:moon-fill',
  sun: 'eva:sun-fill',
  contrast: 'eva:color-palette-fill',
  reset: 'eva:undo-fill',
  filter: 'eva:funnel-fill',
  columns: 'eva:grid-fill',
  hide: 'eva:eye-off-fill',
  content: 'eva:file-text-fill',
  copy: 'eva:copy-fill',
  code: 'eva:code-fill',
} as const

const NAV_ICON_ROOT = '/assets/icons/navbar'

export const NAV_ICONS = {
  project: `${NAV_ICON_ROOT}/ic_project.svg`,
} as const

/** The brand mark, drawn like a nav glyph so it inherits the primary colour. */
export const BRAND_MARK = '/logo/logo_single.svg'

/** The empty-state illustration, drawn as an image (it is multi-colour). */
export const EMPTY_CONTENT_ILLUSTRATION = '/assets/illustrations/illustration_empty_content.svg'

/**
 * Language flags, one per supported language. Images, not masks: a flag is
 * multi-colour, so it cannot inherit `currentColor` the way a nav glyph does.
 */
export const FLAG_ICONS: Record<string, string> = {
  ko: '/assets/icons/flags/ic_flag_kr.svg',
  en: '/assets/icons/flags/ic_flag_en.svg',
}

export type ActionIcon = keyof typeof ACTION_ICONS

export type NavIcon = keyof typeof NAV_ICONS
