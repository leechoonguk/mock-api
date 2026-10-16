---
description: Duplicated block runs — the same run of lines twice in one file means a botched rewrite, not a numbering problem
alwaysApply: false
globs:
      - backend/app/**/*.py
      - backend/tests/**/*.py
      - backend/scripts/**/*.py
      - backend/alembic/**/*.py
      - frontend/src/**/*.ts
      - frontend/src/**/*.tsx
---

# Duplicated Block Runs

One file must state each thing once. When 24+ consecutive identical lines appear
twice in the same file (non-overlapping, with at least 8 distinct non-blank
lines in the run), the file contains a **duplicated block** — the usual cause is
a full-file rewrite from stale content followed by partial edits layered on top.

## What to do when it fires

1. **Read the whole file first** — the two copies drifted, so decide which copy
   is current before touching anything.
2. **Delete one copy entirely.** Do not renumber, re-title, or patch around the
   duplicate: every downstream symptom (out-of-sequence sections, doubled
   definitions, shadowed exports) disappears with the copy.
3. Re-run the reporting check — `make check-duplicate-blocks` — and confirm the
   file is clean before moving on.

## Why this is its own check

Domain checks see only the second-order symptoms (a section numbered out of
sequence, a redefined symbol) and their messages then read as "fix the numbers"
— measured: a session spent 15+ minutes renumbering sections of a file
that simply contained the whole run twice. The duplicate is the cause; this
check names it at write time, in the file just written.

Machine check: `make check-duplicate-blocks` (scans `backend/app`,
`backend/tests`, `backend/scripts`, `backend/alembic` and `frontend/src`; data
formats like JSON and lock files are exempt — structural repetition is normal
there).
