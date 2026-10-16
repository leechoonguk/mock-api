---
description: Backend repository files — one repository, one table, named after it; a full-entity select of another table belongs in that table's own file
globs:
      - backend/app/repositories/**/*.py
      - .omp/hooks/lib/backend-repository-files.ts
alwaysApply: false
---

# Backend Repository Files

## The Rule

**One repository, one table, named after it. A domain with more than one
repository keeps them in `repositories/<domain>/`.** A repository file's own
queries — every whole entity a `select(...)` names, `select(Model)` alone or
beside columns (`select(Model, Other.id)`), never a dotted column — must target
the table its filename names.

```
repositories/
  project.py         ProjectRepository    → table project
  endpoint.py        EndpointRepository   → table endpoint
  request_log.py     RequestLogRepository → table request_log
```

A domain that grows a second repository moves both into a folder, and inside
the folder the file drops the domain prefix: the checker reads the table back
as `<folder>_<file>` — the same shape as `models/<domain>/`
(`backend-model-files.md`), so one domain reads identically in both layers.

## What Counts as Another Table's Query

The defect this rule closes is a table's own persistence logic living in a file
whose name points somewhere else: a reader looking for how `endpoint` rows are
listed opens `repositories/endpoint.py`, and the query is not there.

**A column projection is not this rule.** The project list answers
`endpoint_count`; counting `select(func.count(Endpoint.id)).where(Endpoint.project_id == ...)`
for that read is a projection serving the project's own read, not
`Endpoint`'s CRUD hosted in the wrong file. The rule reads every bare name
among a `select(...)`'s arguments and exempts `select(Model.column)`.

**An entity beside a column is still that entity's rows.** `select(Endpoint,
Project.slug)` in `project.py` pages and orders endpoint rows — that is the
endpoint repository's query, whatever it is joined to. Put the clause on the
repository that owns the rows and let the service compose the two.

**Constructing another table's row is not this rule either.** A repository that
builds child instances and assigns them into a relationship inside one
aggregate-root transaction is assembly, and SQLAlchemy's cascade performs the
inserts. The repository never calls `select` on those tables to do it.

## Not Every Table Has a Repository File

A file exists the day a caller needs one, not before. A repository with one
method nobody calls is exactly the kind of scaffolding the completeness
contract forbids.

## Validation (Post-Hook)

`check-backend-repository-files` reads `backend/app/repositories/`, one level
into domain folders:

| Check | Fires when |
|---|---|
| named after its table | the file's table name (`<folder>_<file>` inside a folder) is not a table any model file declares |
| queries only its own table | a whole entity among a `select(...)`'s arguments - alone or beside columns - targets a table other than the file's own (planted counter-cases judge the reader first) |
| one repository class per file | a file declares two classes that take a `session` |
| a multi-repository domain uses a folder | two or more flat `<domain>_*.py` files exist instead of `repositories/<domain>/` |

## Never Do These

- Put a second table's whole entity in a `select(...)` - `select(Model)` or
  `select(Model, X.col)` - in a repository that is not that table's own file.
- Name a repository file after anything but the table it queries.
- Declare two repository classes in one file.
- Create an empty repository file for a table nothing queries directly yet.
- Leave a domain's second repository as a flat sibling — move both into the
  folder.
