---
description: Frontend design system — theme tokens, layout metrics, and the ported component vocabulary
globs:
      - frontend/src/theme/**/*.ts
      - frontend/src/theme/**/*.tsx
      - frontend/src/components/**/*.tsx
      - frontend/src/layouts/**/*.tsx
      - frontend/src/sections/**/*.tsx
      - frontend/src/styles.css
alwaysApply: false
---

# Frontend Design

The design is ported, not invented: the palette, the type scale, the shadows and
the component vocabulary come from a reference admin template, and the values
are exact. A screen that picks its own green, its own radius or its own shadow
does not look "slightly different" — it looks broken next to the screen beside
it.

This document is a convention (not machine-checked): no design hook is ported.
`check-frontend-code` and `check-frontend-layout` (in `make verify`) hold the
file placement; the rules below are held in review and proven on screen with
`skill://screen-check`.

## Where the Design Lives

| File | Owns |
|---|---|
| `theme/palette.ts` | every colour, including `background.neutral` and each colour's `lighter`/`darker`, as a **function of the mode and the contrast** |
| `theme/settings.tsx` | what the reader chose — mode and contrast — and where it is kept |
| `theme/typography.ts` | the type scale — `pxToRem`, weights, responsive heading sizes |
| `theme/shadows.ts` | the 25-step elevation array **and** the named `customShadows` (`card`, `dialog`, `dropdown`), tinted per mode |
| `theme/overrides.ts` | component defaults — card radius and shadow, dialog shape, tab metrics, table head, input border |
| `config.ts` | layout metrics — `HEADER`, `NAV`, `ICON`, `MAIN_SPACING`, `SCREEN` |
| `styles.css` | a document reset and nothing else |

`styles.css` is deliberately three rules long. It previously carried the stub
app's page layout (`max-width: 40rem` on `:root`), which clamped the whole
document and squeezed the shell into a 230px strip no matter what the layout
asked for — a stylesheet that lays out pages competes with the theme and wins
silently.

## Record Cards Stand At One Gap

A record surface is cards - `DetailSection` and `PagedTableSection` - and the
gap between two of them belongs to the parent that stacks them, never to a card.
Two numbers, both named in `RECORD_SURFACE`:

| gap | value | between |
| --- | --- | --- |
| `SECTION_GAP` | 2 (16px) | two sibling cards |
| `SECTION_GROUP_GAP` | 3 (24px) | two groups of cards |

Measured on a record dialog with several tabs: one tab drew both rhythms,
another rendered its cards straight into the dialog body with **no stack at
all** - the cards touched. One reader, three rhythms, by switching tabs. The
project detail dialog's tabs and panels (endpoints, logs, endpoint, test, log)
each stack their cards at `RECORD_SURFACE.SECTION_GAP` - never a bare `2`,
which is today's value and tomorrow's copy. A `return` that draws a single card
(a tab's empty state) needs no stack: it has no sibling to stand apart from.

## The Surface Has Two Answers

The palette is `buildPalette(mode, contrast)`, and the reader picks both from the
header's settings drawer. The values are the reference's v7 generation, measured
off the running reference rather than copied from `template/`, which holds v4 —
a generation where `primary.main` was `#00AB55`, `grey.800` was `#212B36` and
`secondary` was blue. Both generations are internally consistent; mixing them is
what makes a screen look almost right.

| Setting | What moves | Values |
|---|---|---|
| `mode` | text, background, shadow tint | light / dark |
| `contrast` | `background.default` only | `#FFFFFF` / `#F4F6F8` (light) |

Three consequences the design carries:

- **A shadow is grey on a light page and black on a dark one.** Measured on the
  reference: the same card casts `rgba(145,158,171,…)` in light and
  `rgba(0,0,0,…)` in dark. Grey on a dark page is a glow, not a shadow.
- **A soft `Label` takes `tone.dark` in light and `tone.light` in dark.** `dark`
  in both is a badge that disappears into its own 16 % tint.
- **Contrast is a light-mode distinction.** In dark the page already sits under
  the card, so the drawer disables that row and says why rather than offering a
  switch that changes nothing.

**A colour a component picks by hand has one mode's answer.** `grey[800]` is a
card in dark and near-black text in light; `common.white` is the surface in one
and a glare in the other. So outside `theme/`, a `bgcolor`/`color` set to a
`common.*` or an end-of-range grey fails unless the file reads `palette.mode` —
that read is the file stating it knows there are two answers.
`alpha(grey[500], …)` is exempt: a tint of the mid grey is the one value that
reads on both surfaces, which is why the divider and every hover is built from
it. Planting a `common.white` surface on `StatCard` is the case to review for.

## The Shell Has One Breakpoint

The header switches at `lg` (`width: calc(100% - NAV)` and its desktop height),
and the nav switches with it: docked (`permanent`) from `lg` up, a `temporary`
drawer below, opened by the header's menu button and closed by the choice made
in it. Every layout metric in `config.ts` (`HEADER`, `NAV`) is read by both,
so a phone, a tablet and a desktop are one code path at three widths. Measured
before the rule: the nav was `permanent` at every width, the
header was not, and a phone showed 78px of content beside a 280px menu.

The desktop header is 72px and fixed — no shrink on scroll. The window never
scrolls (the screen fills it and its card scrolls inside), so the reference's
92px bar with its scrolled 60px state held 92px for nothing.

## A Phone Dialog Is The Screen

Below `sm` every dialog but the `xs` confirm fills the screen: `MuiDialog`'s
paper drops its margin and radius and takes `width`/`height: '100%'`. Measured
at 390px: a record dialog was a card 32px short of each edge, its tabs
scrolled inside 326px, and its height jumped with every tab. A tab's icon
stands a spacing step from its label (`.MuiTab-icon`, which `Iconify` forwards
as `className` - dropped, the glyph sat flush), and a phone's tab strip
spaces tabs at 12px.

## The Docked Nav Has Two Widths

`navLayout` is the third setting, and the reader is the only thing that changes
it: the button on the sidebar's own edge. **No screen folds the nav for them** —
a menu that changes shape on its own is a menu they have to re-read, and the
width a wide table wants is not the width the reader wants to keep.

| Layout | Width | Row |
|---|---|---|
| `vertical` | `NAV.W_DASHBOARD` (280) | glyph beside label, `H_ITEM` 48 |
| `mini` | `NAV.W_MINI` (88) | glyph above a `caption` label, `H_ITEM_MINI` 58 |

Measured at 1440 on a list screen: the card goes **1080 → 1272px**, the header
**1159 → 1351**, and the setting survives a reload.

Three things the fold is not allowed to break:

- **The label stays.** Folded, it is `caption` and centred under the glyph. A
  column of unlabelled icons is a menu the reader has to learn.
- **The header ends where the nav ends**, in both layouts, and both animate over
  `transitions.duration.shorter` — two durations open a gap mid-fold.
- **Mini exists only where the nav is docked.** Below `lg` the nav is a
  `temporary` drawer the reader opened on purpose; an 88px sheet over the page
  is neither open nor closed. Verified at 390/820/1180: temporary, 280 wide, no
  fold button.

The fold button is the reference's, at its numbers: a **26px circle centred on
the column's edge** (measured offset 0 against the reference's +1), a 16px
chevron in `text.secondary`, `1px alpha(grey[500], 0.12)` border, on the page's
own surface.

It is rendered **beside the drawer, not inside it**. The paper clips its overflow
— without that, labels spill onto the page while the column animates — and a
button half outside a clipped box is half a hit area: measured, the first version
straddled the edge from inside the paper, and the click landed on nothing while
every gate stayed green.

## The Screen Fills The Window

A screen's height is decided the way its width is: a **floor**, and the rest of
the window. Width already worked that way - the card spans what the nav leaves,
every column has a floor and a share - while height was whatever the content
happened to be: a fixed-height card left a third of a 1440p window unused and
made a 768px laptop scroll the page, and a list grew with its page size until
the pager left the screen.

| Piece | Holds |
|---|---|
| `DashboardLayout` | the shell is the window: `height: '100dvh'`, and `main` is a flex column that scrolls itself (`overflowY: 'auto'`) - the document never does |
| `components/screen-card/ScreenCard` | the one surface a page's section draws: a flex column that grows from its content's floors into the rest of `main` (`flex: '1 0 auto'`), never shorter than `SCREEN.CARD_MIN_HEIGHT` |
| `ServerDataGrid` | fills what its card leaves on a `0px` basis (`flex: '1 1 0px'`), floored at `SCREEN.GRID_MIN_HEIGHT`: the column header and the pager stay on screen and the rows scroll between them. `autoHeight` is gone - MUI X deprecates it, and it is what pushed the pager below the window |
| `ServerDataGrid`, below its floor | where `main` leaves the grid less than `SCREEN.GRID_MIN_HEIGHT` (read off the grid's position, so the choice cannot flip), the grid stops scrolling: it takes its rows' height (`height: 'auto'` over MUI's `100%`), `main` is the one scroll, and the pager is `position: sticky` at the window's bottom - a phone's cards, on a short laptop |
| `PageHeader` on a short window | below `SCREEN.SHORT_WINDOW_HEIGHT` past `sm` (`SHORT_WINDOW_MEDIA`) the heading steps down to `h5`, the description is visually hidden (still read), and `main`'s foot is 16px - the height goes to the grid |

- **The floors are the only fixed numbers, and they live in `config.ts`.** Below
  them the window is too short for the surface to work, so `main` scrolls instead
  of the surface collapsing - the same answer a column's floor gives a narrow
  window. The grid has a floor of its own because the card head is not one
  height: on a phone the filter boxes stack one per row, and without it the grid
  was left 79px of rows.
- **What scrolls inside the card contributes its floor, never its content.** The
  card is sized from its content (so a tall head pushes it past the window rather
  than crushing the grid), which means a growing child's own size must not be its
  content: the grid takes a `0px` basis - `flex: 1` is `0%`, and a percentage of a
  content-sized card resolves to the rows (measured: 629px, the card past the
  window) - and a scrolling box takes `height: 0` (measured without it: a card
  grew to its content's 3085px).
- **A section a page renders draws `ScreenCard`, never a bare `Card`.** A bare
  card sizes to its content, which is the fixed-height screen again.
- **No fixed height in a section or page**: no `*_HEIGHT = <number>` constant and
  no three-digit `height`/`minHeight`/`maxHeight` literal. A block that must stop
  growing inside a dialog bounds itself by the window (`dvh`), and a shared floor
  is a `config.ts` metric.
- **One vertical scroll per screen, at every window.** Either the grid fills
  what is left and scrolls its rows while `main` does not move, or - below the
  grid's floor - `main` scrolls and the grid does not. Two scrolls one inside
  the other (the page and the rows under one wheel) is the defect: measured at
  1280x720 on seven lists before the short header and the page-scroll mode.
- **A phone's list is the exception that proves the floor.** Below `sm` the
  cards (`GridCardList`) grow the card and `main` scrolls them - one scroll
  under one thumb. `ScreenCard` clips with `overflow: clip`, never `hidden`, at
  every width: a hidden overflow is a scroll box, and a pager - the phone's, or
  a short laptop's grid's - sticks to the window's bottom only when no scroll
  box stands between it and `main`.
- **A row of widgets is not a surface.** A section that draws no card of its
  own is not held to the fill.

Review reads the shell, `ScreenCard`, `ServerDataGrid` and every section a page
renders against these.

## A Grid Cell Centres Its Content

MUI X's cell is a block whose one line is centred by a line height as tall as
the row, so anything else a cell holds - a chip, a stack of chips, a row of
buttons - stood at the top: a chip cell measured 13px
above the row's centre (ink 24px in a 52px cell). The theme owns it: the
`MuiDataGrid` `cell` override is `display: 'flex'; alignItems: 'center'`, so every
cell, the custom `renderCell`s included, centres vertically, and the column's own
alignment (`align: 'right'` for numbers, centre for actions) still places it across.

- A custom `renderCell` sets no vertical alignment of its own (no `alignItems` or
  `height: 100%` on the cell's root to centre it): the cell does.
- A glyph in a wrapper is centred by the wrapper being a flex box
  (`display: 'inline-flex'`): a block span put an inline icon on a line box taller
  than the icon, 2.5px above its button's centre.
- A dialog's `<Table>` rows centre through the table's own `vertical-align:
  middle`; a phone card's field row is a flex row with `alignItems: 'center'`.

Measured with `cellCentreReport()`-style DOM reads in `skill://screen-check`:
the content's ink centre against the cell's, every cell within 1px. Keep both
properties on the override.

## A Select Is Bounded

A select's dropdown scrolls past eight and a half rows (`SELECT_MENU_MAX_HEIGHT`
in `config.ts`, applied as `MuiSelect`'s default `MenuProps`). MUI's own default
lets the menu take the viewport: a long vocabulary stood 804px tall from the
top of the screen, detached from the box that opened it - measured. Bounded,
the menu sits under its box, and the cut row says there is more. Keep the
default on `MuiSelect`, read from the constant, and `scrollButtons: false` on
`MuiTabs`.

## A Hidden Axis Is A Scroller On The Other

- `overflowX: 'hidden'` (or `overflowY`) alone makes the browser compute the
  other axis to `auto`: the box becomes a scroll container on the axis nobody
  wrote: a 3px nested vertical scroller inside every table it wrapped. Write
  `overflowX: 'clip'` / `overflow: 'clip'`, or declare the
  other axis in the same style object when that box should scroll.
- A visually-hidden style (`clip: 'rect(0 0 0 0)'`) is `width: '1px'` and
  `height: '1px'`, as strings: MUI's `sx` reads a bare `1` as 100%, and the
  hidden line becomes a window-sized box that scrolls its container (319 x 113px
  at 1280x720; a second scroller in a drawer).
- A two-axis scroll sweep in `skill://screen-check` is what finds the
  scrollers the source cannot show.

## Component Vocabulary

These exist so a screen never re-solves a solved problem:

| Component | Use |
|---|---|
| `components/label/Label` | every status/enum badge — 24px, radius 6, bold 12px, `soft` tint |
| `components/page-header/PageHeader` | heading, description, dot-separated breadcrumbs, right-aligned action |
| `components/data-grid/ListToolbar` | the tab strip with the row count plus the action row |
| `components/data-grid/RowActions` | `rowActionsColumn` — the last column of a grid: every per-row intent as a visible icon button, never a `⋮` menu and never the row click |
| `components/data-grid/ServerDataGrid` | the only place MUI's `DataGrid` is rendered |
| `components/detail/DetailSection` | a titled white card inside a neutral detail body |
| `components/detail/DetailField` | one caption/value pair |
| `components/card/StatCard` | one summary number, with its own loading and failure states |
| `components/iconify/Iconify` | every inline icon, by registry name |
| `components/svg-color/SvgColor` | every navigation glyph, masked over `currentColor` |
| `components/menu-popover/MenuPopover` | every header menu: a 12px arrow aimed at its button, inset rounded `body2` rows |

## Icons: Two Systems, Split by Role

The reference application uses two, and so does this one. Mixing them is what
makes a screen look "slightly off": an outline icon beside a filled one beside a
third family's bold one is three drawings of the same idea.

| System | Where | How |
|---|---|---|
| `ACTION_ICONS` | inline UI — buttons, menus, tabs, alerts | Iconify **eva** set, **filled** variants only (`eva:edit-fill`), through `<Iconify name="edit" />` |
| `NAV_ICONS` | the sidebar | local SVGs in `public/assets/icons/navbar/`, through `<SvgColor src={NAV_ICONS.project} />` |

`SvgColor` masks the file over `currentColor`, which is why a nav icon turns
primary the moment its item is active — an `<img>` cannot inherit colour.

**Every nav item draws its own glyph.** The icon column is the sidebar's fastest
read - the eye aims at a shape before it reads a word - so a shape four items
share carries no information at all. Each item in `config-navigation.tsx` names
its own `icon`; two items on one glyph is the defect.

`components/iconify/icons.ts` is the only module that spells an icon id or an
asset path. A screen names what it means (`add`, `delete`, `more`), so changing
what "delete" looks like is one edit instead of a grep, and a raw
`icon="mdi:…"` is rejected.

## Rules

- **No colour literal in a component.** No `#rrggbb`, `rgb(`, or `hsl(` outside
  `theme/palette.ts`. Colours are read as tokens (`primary.main`,
  `text.secondary`, `background.neutral`) or tinted with `alpha(theme.palette…)`.
- **No `boxShadow` literal.** Use `theme.customShadows.*`, or let the component
  override in the theme do it.
- **No `fontSize` / `fontWeight` literal.** Use a `variant`; if the variant does
  not exist, the type scale is what changes.
- **No layout metric literal.** The header height and nav width come from
  `config.ts` — a literal in one place and a constant in another is how content
  ends up under the fixed header on one screen only.
- **`Chip` is not a status badge.** `Label` is, and it is the same badge in a
  grid cell, a dialog header and a tab count.
- **A detail body is `background.neutral` with white section cards.** That
  contrast is what separates the record from the page.
- **A container that accepts children spaces them; a caller never has to.**
  `DetailSection`'s body is `<Stack spacing={2}>`. Measured without it: `rowGap:
  normal`, so a table and the block below it touched at **0px** — a
  `TablePagination` survived on its own padding, an `Alert` read as glued to the
  last row. The gap belongs to the container for the same reason the gap between
  two cards belongs to their parent: a caller that has to remember it forgets once.
- **Two cards are stacked by their parent at `spacing={2}` (16px).**
  `DetailSection` carries no margin, so a component returning several cards from
  a bare fragment draws them touching (measured: **0px** on one tab, **16 and
  16** on its sibling wrapped in `<Stack spacing={2}>`). A tab nests one level
  further only when the cards group (`spacing={3}` between groups, `{2}` inside
  one): two or more cards returned from a fragment, or from a `Stack` that
  spells no spacing, is the failure.
- **A row being edited is marked by the action colour and an edge bar, never by
  `warning`.** `EDITING_ROW_SX` — `alpha(primary.main, 0.08)` plus
  `inset 3px 0 primary.main` — exported from `ServerDataGrid` so the grid and a
  plain editing `TableRow` cannot drift. Amber was the first attempt and the wrong
  word: `warning.lighter` is this palette's caution (a delete panel's alert, a
  field the server would reject), and a row someone chose to edit is not a
  caution — spending the caution colour on an ordinary action leaves nothing
  louder for a real one. The bar carries the state without hue, so the row
  survives greyscale and colour-blind vision (WCAG 1.4.1). The wash covers
  `:hover` too, or moving the mouse erases the one signal that unsaved changes
  exist, and the cell background is cleared because MUI's own editing style — a
  white cell with a shadow — is invisible on a white table.
- **The focused cell is ringed for keyboards, not for the pointer that aimed.**
  MUI X rings on `:focus-within`, so clicking a row's pencil drew a second green
  rectangle around the action buttons while the row already said it was editing.
  `:focus` and `:focus-within` are cleared; `:focus-visible` keeps the ring on the
  cell (arrow-key navigation has no other cue) and a 2px ring on a focused button.
  Never drop the indicator entirely — WCAG 2.4.7 requires focus to be visible.
- **An edit control is the same control the forms use.** `type: 'boolean'` edits
  through a bare checkbox, the one control that appears nowhere else: the read
  cell is a `Label` chip and both form dialogs use a `Switch`. A boolean column
  overrides `renderEditCell` with that switch, which reads as the state it is in
  rather than as a box being ticked.
- **A glyph never takes pointer events.** `Iconify` is `pointerEvents: 'none'`, so
  the button around it is the event target. `@iconify/react` re-creates its `<path>`
  nodes on re-render; inside a grid cell that lands between `mouseup` and the
  browser's `click` dispatch, and the click is dropped with no error anywhere.
- **A glyph holds its box before it arrives.** The icon set's data loads after
  the first paint, and until then `Icon` draws a bare 0px `<span>`; `Iconify`
  passes a `fallback` of the same width and height (`boxSx`), so a row of
  buttons does not move when the glyphs land.
- **A child that pushes itself to the edge needs its parent on `gap`.** `Stack
  spacing={n}` writes `margin-left: 8n` onto every child after the first, from a
  selector on the parent — which outranks the child's own `sx`, so `ml: 'auto'`
  computes to that margin and the child does not move. `useFlexGap` switches the
  parent to `gap` and the auto margin works. Measured twice in one screen: the
  panel strip's verbs sat against the method badge with 457px of empty row to
  their right while the component's own comment claimed they were at the edge, and
  the field editor's segment-order controls sat against the switches.

## Review Judgement

- Whether a repeated `sx` block should have become a theme default.
- Whether the chosen token is the right one — `text.secondary` on a heading
  still reads as a mistake.
- Whether a new shared layout metric belongs in `config.ts` beside
  `NAV.W_DASHBOARD`, `HEADER.H_DESKTOP` and `HEADER.H_MOBILE`.
- Whether an icon name means what the screen needs. The registry keeps one
  family; it cannot say that `link` was the wrong glyph for that button.

## Never Do These

- Write a hex colour, `rgb()` or `hsl()` anywhere outside `theme/palette.ts`
- Write a `boxShadow` string in a component
- Pass a raw icon id (`icon="mdi:account"`) — name it in `components/iconify/icons.ts`
- Mix icon families or weights — inline icons are eva, filled
- Render a navigation glyph with `Iconify` — nav icons are `SvgColor` over a local SVG
- Set `fontSize` or `fontWeight` instead of choosing a typography variant
- Hardcode the nav width or header height
- Use `Chip` where `Label` is the design
- Put page layout in `styles.css`
- Give a screen a fixed height, or let a page's section draw a bare `Card`
- Centre a grid cell's content inside its `renderCell`, or remove `alignItems: 'center'` from the theme's `MuiDataGrid` cell override
- Set `borderRadius` on a `Card` — the theme already does, at twice the base
