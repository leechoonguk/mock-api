---
description: Backend model files — one table, one model class, one file named after the table
globs:
      - backend/app/models/**/*.py
      - .omp/hooks/lib/backend-model-files.ts
alwaysApply: false
---

# Backend Model Files

## The Rule

**One table, one model class, one file, named after the table. A domain that
owns more than one table keeps its files in `models/<domain>/`.**

```
backend/app/models/
  base.py                      # declarative base + mixins — declares no table
  project.py                   # class Project    → table project
  endpoint.py                  # class Endpoint   → table endpoint
  request_log.py               # class RequestLog → table request_log
```

Each of today's tables is its own domain's only table, so every file is flat.
The folder shape below is what a domain takes the day it owns a second table.

**Inside a folder the file is named after its table with the domain prefix
dropped.** A hypothetical `project` domain owning `project_variable` would keep
it at `models/project/variable.py`, not `models/project/project_variable.py`
— the path already says `project`; the checker reads the table name back as
`<folder>_<file>`.

**One file stays flat.** `endpoint` owns one table, so `models/endpoint.py` is
the whole domain — a folder holding one file adds a level and says nothing.

`__init__.py` in a domain folder is **empty**. It is a package marker, not a
barrel: re-exporting from it would restore the "one import path for several
tables" shape the split removes.

**A layer holds one shape or the other, never both.** `models/project.py` beside
`models/project/` gives "which files does this domain own" two answers, and the
one that answers first wins silently. Finish the move and delete the flat file.

A file with no `__tablename__` is not a table file and is exempt — `base.py`
qualifies by measurement rather than by name.

## Why

When several tables share one model file, **every reader of models has to
special-case that filename**: a check that maps a model file to a domain needs
a hardcoded skip, the `__tablename__` can no longer equal the file name, and the
file grows into several unrelated schemas. One table per file removes all of
that: a **domain** is the stack whose `services/<name>.py` exists, owning
`models/<name>.py` or `models/<name>/*.py`. No exception list survives.

The folder exists for the same reason: several flat `<domain>_*.py` files in a
directory where every other domain has one file make a reader reconstruct the
grouping from the prefix, and a checker match on it. The folder states it once.

## What Follows From It

- **A domain may own many tables.** Domain discovery reads `services/`, never
  `models/`, so a new table is a new file and nothing else.
- **File names are lower snake case**, because they are table names
  (`request_log` → `request_log.py`), not identifiers.
- **Imports point at the owner.** A file that needs another table's FK string
  imports it from that table's module (`from app.models.project import
  PROJECT_FK`, `from app.models.endpoint import ENDPOINT_FK`), so the dependency
  is visible and acyclic: project ← endpoint ← request_log.
- **Back-references use `TYPE_CHECKING`.** A parent annotates children it cannot
  import at runtime; SQLAlchemy resolves the relationship through its registry
  once every module is imported (`alembic/env.py` and `tests/conftest.py` import
  all of them — a table nobody imports is absent from the metadata, so
  autogenerate writes an empty migration).
- **Shared model constants live in `base.py`** (`CHILD_CASCADE`), not duplicated
  per file.
- **The same shape applies to the other layers.** `repositories/<domain>/`
  (`backend-repository-files.md`) and `schemas/<domain>/` follow the identical
  rule, so one domain reads the same way down the stack.

## Validation (Post-Hook)

`check-backend-model-files` reads `backend/app/models/`, one level into domain
folders:

| Check | Fires when |
|---|---|
| one table per file | a file declares two `__tablename__` values |
| named after its table | the file name and `__tablename__` disagree — inside a folder the expected name is `<folder>_<file>` |
| one mapped class per file | a file declares two classes inheriting `Base` |
| a multi-table domain uses a folder | two or more flat `<domain>_*.py` files exist instead of `models/<domain>/` |

## Never Do These

- Put two tables in one model file.
- Name a model file something other than its table.
- Repeat the domain prefix inside its own folder
  (`project/project_variable.py`).
- Leave a domain's second table as a flat sibling — move both into the folder.
- Add a filename to an exception list in a hook because a model file is "special".
- Re-export a model from a barrel module to keep old imports working — move the
  imports instead.
