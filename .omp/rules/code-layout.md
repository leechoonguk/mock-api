---
description: Code layout for every language — comments, section banners, constant placement, class member order
globs:
      - backend/app/**/*.py
      - backend/scripts/**/*.py
      - backend/tests/**/*.py
      - backend/alembic/**/*.py
      - frontend/*.ts
      - frontend/*.js
      - frontend/src/**/*.ts
      - frontend/src/**/*.tsx
      - .omp/hooks/**/*.ts
alwaysApply: false
---

# Code Layout

Where a declaration sits and what a comment says are read far more often than
they are written. This rule fixes both so a reader finds the same shape in every
file, and so review spends its attention on behaviour instead of arrangement.

Applies to **all code** in the repository — backend Python, frontend TypeScript
and its package-root config, and the harness's own hooks. Machine-checked by
`check-code-layout.ts` (`make check-code-layout`).

## Coverage

| Surface | Comments | Banners + constant section | Class member order | File layout |
|---|---|---|---|---|
| `backend/app/**`, `backend/scripts/**` | yes | yes | yes | — |
| `backend/tests/**`, `backend/alembic/**` | yes | — (fixtures and revision headers have their own shape) | yes | — |
| `.omp/hooks/**`, `frontend/src/**`, `frontend/*.ts|js` | yes | constants after imports, never `let` | yes | yes |

An empty `__init__.py` is a package marker: it has no code to divide, so the
banner requirement does not apply to it.

## Comments (every language)

- **A comment explains why, never what.** The code already states what it does;
  the comment carries the reason, the constraint, or the failure it prevents.
- **No commented-out code.** Dead code in a comment is a claim about what runs
  that the runtime does not honour. Delete it — Git remembers.
- **No `TODO` / `FIXME` / `XXX` / `HACK` markers.** An intention parked in a
  comment is never found again. Either do it now, or record it where work is
  actually tracked. The repository currently contains zero such markers, and
  that is the state the check preserves.
- **Every harness hook and lib opens with a JSDoc header** naming what it
  enforces. A hook whose purpose is undocumented cannot be reviewed against the
  rule it serves.

## Section Banners (`backend/app/**/*.py`, `backend/scripts/**/*.py`)

A banner is a landmark: a reader finds a section by the shape of the page before
reading a word of it. So the drawing is fixed and the section is not optional.

- **One width, exactly** - each rule line is `# ` followed by 60 `=` (62
  characters). Two widths in one file make the eye stop on the drawing instead
  of the title.
- **Three lines** - rule, `# Title`, rule. A bare `# Router` comment is not a
  banner and does not satisfy the section it looks like.
- **Two blank lines before every banner, none before the first** — a file opens
  with its own first section, and exactly two blank lines separate every later
  one. The import block ends the same way: `lines-after-imports = 2` in
  `pyproject.toml`, so the page has one rhythm instead of two.
- **The construct names its section** - a file that defines `router = APIRouter(`
  carries a `Router` banner; a file that defines a class carries `Classes` (or
  `Middleware`, where the class *is* the middleware). Presence and order cannot
  see a router filed under "Functions", so the construct is checked against the
  titles.

Every module in the application package is divided by banner comments:

```python
# ============================================================
# Constants
# ============================================================
```

- The file **opens with an `Imports` banner**.
- Titles come from a fixed vocabulary — an ad-hoc title makes files stop looking
  alike, which is the whole point of the banners:

  `Imports` → `Constants` → `Classes` → `Middleware` → `Lifespan` →
  `App Setup` → `Router` → `Functions` → `Dependencies` → `Router Registration`

- Banners appear in that order. Only the sections a file needs are present.

## Constant Placement

- **Module-level constants live under the `Constants` banner, before the first
  class.** A constant declared halfway down a module is invisible to a reader
  scanning the top, and it reads as if its position were meaningful.
- Constants are `UPPER_SNAKE_CASE`. A repeated literal becomes a constant
  (`MOCK_PREFIX`, `MAX_DELAY_MS`), so a typo becomes an import error instead of
  a silent behaviour change.

## Class Member Order (Python)

Within a class, members appear in this order:

1. docstring
2. declarative configuration — `__tablename__`, `__table_args__`,
   `model_config`, `__mapper_args__`
3. mapped columns / model fields
4. relationships
5. properties
6. `__init__`
7. public methods
8. private methods (`_name`), including `@staticmethod`/`@classmethod` helpers

- **The order is checked, not suggested.** A declarative config line after a
  field, a mapped column after a relationship, or a property after a method is a
  violation naming both members.
- **`__init__` comes before every other method.** A reader looking for what a
  class holds should not scroll past behaviour to find its state.
- **Private helpers come after every public method.** The public surface is what
  a caller needs; the helpers are implementation detail and belong below it.
- **Dunders are protocol, not helpers.** `__aenter__`, `__repr__` and friends
  are exempt from the private-below-public rule: their position is dictated by
  the protocol they implement.

## Class Member Order (TypeScript / JavaScript)

Same principle, the language's members: **fields → `constructor` → public
methods → private methods** (`#name`, `_name`). A class whose constructor sits
below its methods hides what the instance holds.

## File Layout (`.omp/hooks/**`, `frontend/src/**`, `frontend/*.ts|js`)

- Imports first — no declaration precedes the last import.
- Constants after the imports, before the first function.
- **A module constant is `const`, never `let`.** A reassignable constant is a
  lie: compute the value once (a ternary, a helper call) instead of declaring a
  default and patching it two lines later.
- `export default` (the hook entry point) precedes the plain helper functions it
  calls, so the file reads top-down from its purpose to its details.

## Whitespace (every text asset)

Whitespace at a line's end or a file's edge is invisible in an editor and loud
in a diff: it turns a one-line change into a multi-line one and buries the real
edit. One shape, everywhere - `*.py`, `*.ts(x)`, `*.md`, `*.yml`, `*.toml`,
`*.ini`, `*.css`, `*.sh`, `.env.example`, and the `Makefile`s.

- **No trailing whitespace** on any line.
- **Exactly one final newline** - a file that does not end with a newline has a
  last line that is not a line; two newlines leave a blank line behind.
- **LF only** - never CRLF.
- **Spaces, not tabs** - the sole exception is a `Makefile` recipe, where a tab
  is the language.

**Ownership** - `ruff` (`W291`/`W293`) owns trailing whitespace inside Python, so
`check-code-layout` checks Python only at the file boundary; ruff's own `W391`
is preview-gated and cannot be relied on. Migrations (`backend/alembic/`) are
outside the whitespace walk - a pushed revision is immutable, so its shape is
history, not a standard.

## Review Judgement (not machine-checked)

A hook can see that a comment exists, never whether it earns its line. These are
review concerns, and a violation is a review comment, not a failing check:

- A comment that restates the line below it (`# increment i`).
- A docstring that is technically present and says nothing.
- Whether a banner's contents actually belong under that banner.

## Never Do These

- Leave commented-out code, or a `TODO`/`FIXME`/`XXX`/`HACK` marker
- Ship a hook or lib without a JSDoc header
- Invent a banner title outside the vocabulary, or place banners out of order
- Draw a banner at any width but 62 characters, or with mismatched rule lines
- Separate sections by anything but exactly two blank lines, or open a file with
  a blank line
- Define a router or a class in a file whose banners never name that section
- Declare a module constant after the first class, or outside the `Constants`
  section
- Put `__init__` after another method, or a private helper above a public one
- Write a comment that restates the line below it
- Leave trailing whitespace, a tab indent, a CRLF line, or a missing/duplicated
  final newline in any text asset
- Declare a module constant with `let`, or patch it after declaration
- Put a TypeScript `constructor` below the methods, or a `#private` above them
