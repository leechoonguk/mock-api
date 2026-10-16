---
name: screen-check
description: Prove a frontend change on the running screen - drive the real browser, click with a real pointer from a fresh entry, and report numbers that moved instead of an opinion. Use when the user asks to verify, fix, or refine anything visible in the web UI: layout, alignment, spacing, colour states, dialogs, grids, or whether a button actually works.
enforced-by: []
---

# Screen Check

A frontend claim is only as good as the number behind it. This skill is the order
that works and the traps that were measured — every rule below exists because a
plausible-looking verification passed while the screen was broken.

This is a procedure skill: it owns no check of its own. The screen conventions
it proves are rule://frontend-screens and rule://frontend-design (convention,
not machine-checked); the structural frontend checks in `make verify`
(`check-frontend-code`, `check-frontend-layout`, `check-frontend-domain`,
`check-frontend-routing`, `check-frontend-api-layer`, `check-frontend-i18n`)
cannot see geometry or interaction, which is why they are measured here.

## Workflow

### 1. Use the stack that is already running

`make dev` runs the backend on `127.0.0.1:47821` and Vite on
`http://localhost:47823` (which proxies `/api`, `/mock` and `/health` to the
backend). Check before starting one:

```bash
curl -s http://localhost:47823/health
```

A second Vite silently takes the next port and you end up measuring a server
the user is not looking at. Reuse the running one; it applies your edit through
HMR, and `curl -s http://localhost:47823/src/<path>.tsx` proves which version it
serves. Start one only when nothing answers, as a long-lived service
(`make dev`, ready on port 47823).

Drive it with the omp `browser` tool from Eval:

```js
const tab = await browser.open({ name: 'screen', url: 'http://localhost:47823/project',
  viewport: { width: 1440, height: 900 } })
```

### 2. Seed what you measure, then give it back

There is no login: the admin UI talks to the API directly. Seed the rows a
screen needs over the API, and **delete them when done** — a list screen is the
thing under test, and leftover rows change what the next measurement sees.

**Delete only what you created.** Keep the id of every row the run creates (the
`POST`'s answer) and delete by those ids at the end. Never delete by a time
window or a broad pattern: another session's rows go with yours. Deleting a
project cascades to its endpoints and request logs, so one seeded project is
one cleanup.

```bash
curl -s -X POST http://localhost:47823/api/v1/project/ -H 'Content-Type: application/json' \
  -d '{"name":"screen-check","slug":"screen-check"}'
curl -s -X POST http://localhost:47823/api/v1/project/<id>/endpoints -H 'Content-Type: application/json' \
  -d '{"method":"GET","path":"/users/{id}","status_code":200,"body":"{\"id\":\"{{id}}\"}"}'
curl -s http://localhost:47823/mock/screen-check/users/1      # writes a request_log row
curl -s -X DELETE http://localhost:47823/api/v1/project/<id>
```

Fill inputs through `tab.fill` / `tab.type`; from `evaluate`, set the value
through the native setter, or React never sees the change:

```js
const el = c.querySelector('input')
Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, v)
el.dispatchEvent(new Event('input', { bubbles: true }))
```

### 3. Click the way a user clicks

**`element.click()` from `tab.evaluate` is not a click.** It skips hit testing,
overlays, and the browser's own `mousedown`/`mouseup`/`click` sequence. A dead
first click survived five verifications that all used it, and the bug was only
visible through the pointer:

```js
await tab.run(async ({ page }) => {
  const h = await page.$('.MuiDataGrid-row [aria-label="Open"]')
  const b = await h.boundingBox()
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
})
```

**Enter the screen fresh for every trial.** Navigate away and back, then click
once. Repeating a click on a page you already interacted with hides the entire
class of first-interaction bugs — focus, mount, refetch, node replacement.

**Every width, every time the shell or a list is touched.** Open the screen at
320×568 (the narrowest phone), 390×844 (phone), 820×1180 (tablet portrait) and
1180×820 (tablet landscape) as well as the desktop, and read the same rects on
each: the card's `x` and width,
each filter box's width, the document's `scrollWidth` against `innerWidth`.
Measured: a permanent 280px nav left a phone's content 78px wide and
a tablet's two thirds, and every gate was green because none of them has a
viewport. The shell's rule is one breakpoint - the header's `lg` - below which
the nav is a drawer behind the header's menu button; a list's filter boxes are
full-width below `sm` and their reset sits at the right with the refresh.

**Tap the way a phone taps.** Android Chrome moves focus to a button on tap;
iOS Safari does not. A tap test emulates an Android device
(`tab.emulate({ device: 'Pixel 7' })`: touch, coarse pointer, its user agent),
so focus rings, `blur` handlers and focus-restore paths run as the phone that
has them runs them - a desktop viewport resized to 390 has a fine pointer and
none of them.

**The driver scrolls for you; a finger does not.** Before a locator click it
scrolls the element into view inside any overflow container, so a button
clipped by its card still "taps". Read the button's rect against the card's
(or the scroller's) `getBoundingClientRect()` before tapping: a button outside
that rect is clipped, whatever the click reported.

**A report from a tab that was open while the code changed is not yet a bug.**
Vite's HMR swaps a module under a mounted dialog and, when the swap fails,
leaves the old one rendering with the new one's data; measured: a
paging bug fixed and proven from a fresh load was reported again from a tab
that had the dialog open through the fix, with the pre-fix DOM (nineteen rows on
a page of ten). Reproduce from a hard reload before touching code, and when the
fresh load is clean, say so and ask for the exact screen and steps. The same
goes for a React hook-order error ("Rendered more hooks than during the
previous render") seen while other sessions edit the same files: HMR swapped a
component mid-edit. It is a bug only once a fresh load reproduces it.

### 4. Measure numbers, not impressions

A screenshot shows that something is wrong; a number says what and by how much,
and survives being wrong later. Read rects and computed styles:

| Claim | What to measure |
|---|---|
| "centred" | element centre minus container centre, and the two gaps |
| "aligned with the column beside it" | **ink**, not boxes — text via `range.selectNodeContents(cell)`, a glyph via its `<svg>` rect |
| "opens the dialog" | `[role=dialog]` count before and after |
| "the row is in edit mode" | `.MuiDataGrid-row--editing` count, plus the computed `backgroundColor` |
| "it refetched" | `performance.getEntriesByType('resource')` filtered by the endpoint |
| "nothing is clipped" | whether a child rect falls outside the cell's **border box** — `scrollWidth > clientWidth` is true for any content that overruns padding on purpose, and reports clipping that is not there |
| "it stands out from the page" | **pixels across the edge**, not the declared `boxShadow` — screenshot a 1px strip through the boundary and read the rows (§ 4c) |
| "a word is one request" | type through CDP `Input.imeSetComposition` / `Input.insertText` at 450ms per jamo, then count the list requests (`tab.requests()`) and check that no sent value ends in a bare jamo (U+3131–U+318E) |
| "opening a select is cheap" | `document.getElementsByTagName('*').length` and the longest `PerformanceObserver({ type: 'longtask' })` duration, before and after the tap |

**Time is read off the DOM, not off the driver.** A locator's auto-wait and
the driver round trip add a constant to every "click → visible" interval. Take
both ends inside the page - `performance.now()` at the event (a capture-phase
listener) and at the change (a `MutationObserver`, or a `requestAnimationFrame`
poll) - and report that difference.

Six traps that cost real time here:

- **A button box is not its glyph.** A 30px hit box holding a 20px glyph reads as
  5px of extra gutter; box arithmetic said 20/20 while the screen showed 20/25.
- **`window.fetch` patches catch nothing** when the app uses axios (XHR). Use
  resource entries, or a state change the request causes.
- **Framework layout is measured, not assumed.** Moving a hand-rolled cell to
  MUI's `type: 'actions'` kept a 4px gap constant while `.MuiDataGrid-actionsCell`
  uses 8px; the column came out 8px narrow and the gutter read 16px against the
  text's 20px. Read `getComputedStyle(...).gap` and the button rects instead.
- **A screen that never settles reads as fine.** A box that chooses its
  padding by its own content width measured 195px, took the phone padding,
  measured 203px and dropped it again - every frame, 1,080 DOM mutations in
  1.5s, with every rect identical at both reads. The symptom was an element
  screenshot timing out on "waiting for element to be stable". After the
  render, count mutations under the surface for a second
  (`MutationObserver`, spinners and skeletons excluded); anything but 0 is a
  loop to find before any other number is trusted.
- **A button that changes role between renders must be a different element.**
  A dialog foot that swaps cancel/save for the discard question reused one
  `<button>` across the two branches, so the pressed "keep editing" became
  `type=submit` in the same click and saved the form: 1 PATCH, dialog closed.
  Probe it by pressing the control while it changes: type, Escape, click keep
  editing, count non-GET requests (0 expected), dialogs (1) and the typed text
  (kept). Each branch carries its own `key`.
- **A synthetic tap is faster than a finger.** A driver's tap sends
  `touchend` in the same task as `touchstart`, so a handler that waits even
  0ms on a timer (MUI's `enterTouchDelay`) is cancelled before it runs, and
  the `mouseleave` Chrome emulates after a tap closes what the tap opened.
  Prove a touch control by what is on screen 100, 500 and 3000ms after the tap.
- **Driving a screen writes to the database.** A stray click on the enabled
  switch of an endpoint disables it, and a later run measures that as the
  state. Read the row back and restore it; a stale `version` answers 409
  `stale_version`, so read before you write.
- **The test panel and `/mock` write request logs.** Every send appends a
  `request_log` row; count the logs tab before and after, and clear the
  seeded project's logs (or delete the project) when done.

### 4b. Keep measurements as reusable functions

There is no probe script in this repo and no browser dependency in
`make verify` — adding one would put a Chromium download inside every gate run.
Write each measurement as a dependency-free DOM function passed to
`tab.evaluate` (or run inside `tab.run`), so a second run reports the same
numbers instead of a hand-written variant. The ones these screens keep needing:

| Measurement | Answers |
|---|---|
| overflow | which cells clip, and whether each clipped one has a tooltip trigger |
| column bleed | does a cell draw over its neighbour (shares past 100%) |
| tooltip | the tooltip a hover produced, its gap above the cursor and its centring |
| panel strip | is the panel strip pinned, and where it sits after the body scrolled |
| scroll containers | every element that scrolls on either axis, and whether the document scrolls sideways |
| tap targets | each target's box, the span a pointer owns through its centre, and the gap to its neighbour |
| layout shift | `tab.vitals()` CLS, and what moved |
| list state | URL params (`page`, `size`, `sort`, `name`, `detail`, `tab`), pager, rendered rows, focus — before and after Back and reload |
| cell centring | how far each grid cell's content (ink) sits from the cell's vertical centre |
| settle | DOM mutations in a quiet second (`MutationObserver`) |

**Sweep, don't sample.** Run the page-wide measurements for every changed
route (`/project`, `/project?detail=<id>&tab=endpoints`, `&tab=logs`) at
320x568 and 390x844 (phone, touch), 820x1180 and 1180x820 (tablet, touch),
1280x720 and 1440x900, in both `ko` and `en`. Read these on every sweep:

- **Scrollers.** The scroll-container list should hold the screen's intended
  scrollers and nothing else: an extent of a few pixels on an axis nobody wrote
  is a one-axis `hidden` (the other computes to `auto`) or a hidden line sized
  `1` (MUI's 100%).
- **Cell centring.** Touching a grid, a cell renderer or a dialog's table: the
  largest offset should be 1px or less. A cell's ink is measured, not its box.
  Zero cells is an empty list, not a pass - seed rows first.
- **Stacked targets.** Under a touch viewport every target in a column or row
  owns 44px or more through its centre.

### 4c. A render result is read off pixels, and only here

Geometry, counts and computed styles all come from the DOM, and a check can read
them. **Whether the thing is visible cannot be**: the surface, the shadow and the
page compose in the compositor, and every gate in this repo is text over source.
So a claim like "the toast is hard to see" is settled in this skill or not at all.

The measurement is a **1px strip across the boundary**, screenshotted and decoded
in the page itself:

```js
const r = el.getBoundingClientRect()
const strip = await page.screenshot({
  clip: { x: r.x + r.width / 2, y: r.y - 8, width: 1, height: 16 },
  encoding: 'base64', type: 'png',
})
// decode in the tab: draw it on a canvas and read the rows
const rows = await page.evaluate(async (src) => {
  const img = new Image(); img.src = src; await img.decode()
  const c = document.createElement('canvas')
  c.width = img.width; c.height = img.height
  c.getContext('2d').drawImage(img, 0, 0)
  const d = c.getContext('2d').getImageData(0, 0, img.width, img.height).data
  return [...Array(img.height)].map((_, y) => [d[y * 4 * img.width], d[y * 4 * img.width + 1], d[y * 4 * img.width + 2]])
}, 'data:image/png;base64,' + strip)
```

Measured on the toast: outside the box `252,252,253`, inside `255,255,255`, and
the edge row **`255,255,255`** — the surface only got *brighter*, so there was no
boundary at all. The declared style said `boxShadow: customShadows.z16`, which
reads as a shadow and is `0 16px 32px **-4px**`: the offset pushes it down and the
negative spread pulls it inward, so nothing is drawn above the box. After `z8`
(spread 0) plus a 1px hairline the edge row read `237,239,241`.

Two rules this leaves:

- **Read the pixels, not the property.** A `boxShadow` that exists proves
  nothing; its offset and spread decide whether any of it lands where you are
  looking.
- **Falsify in the same run.** Put the previous style back on the live node
  (`el.style.boxShadow = …`), re-read the same strip, and report both numbers.
  Without the before, an edge row of `237` is a number with nothing to beat.

### 5. When an event disappears, record a timeline

Do not guess through hypotheses. Log capture-phase `pointerdown`/`mousedown`/
`mouseup`/`click`, DOM `childList` mutations in the render zone, and network
entries with timestamps, then read the order:

```
 5ms mousedown  → button
10ms mouseup    → button
13ms removed path / added path      ← the pressed node was replaced
     click      ← never fired
```

That log named the cause in one run after three wrong hypotheses (tooltip, cell
focus, refetch timing) had each been rejected by an experiment.

### 6. Falsify the check, not just the code

A verification that passes proves nothing until it fails on a broken tree. Plant
the violation, watch it fire, restore:

- A style assertion that matched the **comment explaining the style** passed with
  the style deleted. Strip comments before testing code.
- A grid measurement on an empty grid returns "no rows", not a failure — guard
  for `null` or seed a row, or the run reports success against nothing.

### 7. Leave the diff you meant

Never run a formatter over the tree with its default settings: the repository
has no prettier configuration, so `prettier --write` (or an editor's format on
save) rewrites quotes, semicolons and wrapping in lines nobody touched, and the
diff stops saying what changed. Format nothing you did not write; `make verify`
holds the style that matters (`npm run lint`).

### 8. Report what moved

Give the before/after table and name the mechanism. "Looks right" is not a
result; `52 → 67`, `0 → 1`, `25 → 20` are.

## Verification

- Every claim about the changed surface has a number from a browser run, taken
  from a fresh entry with a real pointer.
- Seeded projects (and with them their endpoints and logs) are deleted by the
  ids this run created; `git status` shows no stray fixtures and no formatter
  churn.
- `make verify` is green.

## Never Do These

- Verify a click with `element.click()`, or re-click a page you already touched.
- Start a second dev server instead of using the running one.
- Report a screenshot as proof of geometry, or an opinion as proof of behaviour.
- Leave the projects you seeded in the database, or clean up by a time window
  instead of by the ids you created.
- Prove a tap from a desktop viewport, or call a clipped button tappable
  because the driver scrolled to it.
- Run a formatter with its default settings over files you did not write.
- Report a hook-order error from a tab HMR was patching before a fresh load
  reproduces it.
- Keep a check that passes when the thing it guards is deleted.
