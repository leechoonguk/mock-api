/**
 * Application-wide configuration.
 *
 * Every value the app reads at runtime lives here so a reader finds the wiring
 * in one file instead of grepping for a literal. The API base is a relative
 * path on purpose: Vite proxies it in dev, so the bundle never carries a host.
 */

export const API_BASE_URL = '/api/v1'

export const API_TIMEOUT_MS = 30_000

/**
 * Where the mock server answers, for the base URL a project shows and the
 * test panel's requests.
 *
 * The dev proxy forwards the mock router's prefix to the backend, so the page's
 * own origin works by default; `VITE_MOCK_ORIGIN` points the copied URL straight
 * at the backend so a `curl` pasted from the screen does not depend on Vite.
 */
export const MOCK_ORIGIN: string = import.meta.env.VITE_MOCK_ORIGIN ?? window.location.origin

export const APP_NAME = 'Mock API'

export const DEFAULT_PAGE_SIZE = 20

export const PAGE_SIZE_OPTIONS = [20, 50, 100]

/**
 * Layout metrics, ported from the reference application's `config-global.ts`.
 * The header is fixed, so the main column's top padding is derived from its
 * height — a literal in one and not the other is how content ends up under the
 * bar on one screen only.
 */
export const HEADER = {
  H_MOBILE: 64,
  H_DESKTOP: 72,
}

export const NAV = {
  W_DASHBOARD: 280,
  /**
   * The folded column: the icon with its label under it, nothing else.
   *
   * The reference's own width (measured: 87px, rounded to a spacing step here).
   * It is a second *layout*, not a hidden nav — the label stays, smaller, under
   * the glyph, so a folded sidebar still says which screen each row is.
   */
  W_MINI: 88,
  H_ITEM: 48,
  /** A mini row stacks two lines, so it is taller than the wide one. */
  H_ITEM_MINI: 58,
  H_ITEM_SUB: 36,
}

export const ICON = {
  NAV_ITEM: 24,
}

/** Gap between the fixed header and the first row of content. */
export const MAIN_SPACING = 8

/**
 * A screen's surface fills the window under its page header, as its width
 * fills what the nav leaves; these are the floors below which it stops
 * shrinking and `main` scrolls instead.
 *
 * - `CARD_MIN_HEIGHT` - a list card's head, its column header, five rows and
 *   its pager; what a 768px laptop leaves under the header and the heading.
 * - `GRID_MIN_HEIGHT` - a grid's own floor inside the card: the column header,
 *   four and a half rows (the cut row says there are more) and the pager.
 *   Measured without it at 390px: the filter boxes stack one per row and the
 *   grid was left 79px of rows, one and a half. Where `main` leaves less, the
 *   grid stops scrolling and `main` scrolls its rows instead - never both.
 * - `SHORT_WINDOW_HEIGHT` - below it the page header is one heading and a trail.
 */
export const SCREEN = {
  CARD_MIN_HEIGHT: 480,
  GRID_MIN_HEIGHT: 340,
  SHORT_WINDOW_HEIGHT: 900,
}

/**
 * A window shorter than `SCREEN.SHORT_WINDOW_HEIGHT`, past a phone's width: a
 * laptop. Its page header is one heading and one trail, and `main` keeps a
 * narrower foot, so the surface under them keeps the height a grid reads in -
 * at 1280x720 the full header took 122px and left a list grid 288px of rows.
 */
export const SHORT_WINDOW_MEDIA = `@media (min-width: 600px) and (max-height: ${SCREEN.SHORT_WINDOW_HEIGHT - 0.02}px)`

/**
 * The tallest a select's dropdown may grow before it scrolls: eight and a half
 * rows, so the cut itself says there is more. MUI lets a `Select` menu take the
 * viewport - the 상태 filter's 86 values stood 804px tall from the top of the
 * screen, detached from the box that opened it - and gives an `Autocomplete`
 * listbox 40vh, which is a different height on every screen (measured
 * 2026-09-09: 338px at 844, 360 at 900). One number for both.
 */
export const SELECT_MENU_MAX_HEIGHT = 320

/**
 * The most values one multi-select filter may hold - `FILTER_VALUES_MAX` in
 * `app/dependencies/query.py`, which answers 422 past it. The box disables the
 * unticked options at this count rather than send a request the router refuses.
 */
export const FILTER_VALUES_MAX = 20

/**
 * How long typing rests before a filter becomes a request. Phone typing rests
 * 300–700ms between jamo; at 300 every syllable was a request (measured: 7 for
 * 고추장).
 */
export const FILTER_DEBOUNCE_MS = 500

/**
 * The floor of a grid column that prints `formatDateTime`.
 *
 * One string on every screen, so one number - the widest language's: Korean
 * `2026. 12. 28. 오후 12:58` is 148px of ink, English `May 28, 2026, 12:58 PM`
 * 156, plus the cell's 40px of gutter. At 185 the English batch list cut all
 * 12 of its rows (`Sep 15, 2026, 10:…`, measured at 1440 and 1180).
 */
export const TIMESTAMP_COLUMN_FLOOR = 200

/**
 * Metrics of a record surface — the dialog, its section cards, its tables.
 *
 * They were literals inside five components, and each one that disagreed showed
 * up as a row of a different height beside its sibling: the operations table read
 * at 37px while the credentials table read at 43, one section header stood 70px
 * and another 62. Measured, then named here, so a new domain gets the rhythm by
 * importing it rather than by copying a number out of the exemplar.
 */
export const RECORD_SURFACE = {
  /**
   * The dialog body's floor. Measured at 420 it padded the landing tab with 261px
   * of empty neutral; the body follows its content and MUI's own
   * `calc(100% - 64px)` paper cap keeps a long form inside the viewport.
   */
  BODY_MIN_HEIGHT: 160,
  /**
   * One height for every section header. Measured without it: a header carrying an
   * action button was 70px and a text-only header 62px, so the title row moved as
   * the reader switched tabs. The taller is the floor — the button needs the room.
   */
  SECTION_HEADER_HEIGHT: 70,
  /** A table row at rest. A wrapped cell costs 20px of this, so cells clip. */
  TABLE_ROW_HEIGHT: 37,
  /** A select's own width, kept when the same field is read as text. */
  CHOICE_FIELD_WIDTH: 140,
  /**
   * The gap between two sibling cards of a record surface (16px): one number,
   * so a tab cannot stack its cards at a rhythm of its own.
   */
  SECTION_GAP: 2,
  /**
   * The dialog's breakpoint: `lg` (1200px) leaves a table about 1,120px to
   * divide, so every header and badge of the endpoint and log tables stands whole.
   */
  DIALOG_MAX_WIDTH: 'lg' as const,
}
