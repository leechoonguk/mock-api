---
description: Root Git workflow — verified commits and pushes through the commit skill
globs:
      - Makefile
      - .omp/skills/commit/SKILL.md
      - .omp/hooks/pre/strict-verified-git.ts
      - .omp/hooks/pre/strict-publish-consent.ts
      - .omp/hooks/lib/hook-publish-consent.ts
alwaysApply: false
---

# Root Git Workflow

## Consent Comes First

A green tree is not a reason to publish. Two different failures:

| Question | Owner |
|---|---|
| Is this tree green? | `strict-verified-git.ts` — reruns `make verify` before the Git command |
| Did the user ask for this publish? | `strict-publish-consent.ts` — reads the session's own entries |

Consent is the **current** user turn, read from `sessionManager.getBranch()`. A
request three turns ago, followed by other instructions, is not permission to
publish now, and a turn that names the verb while forbidding it - "커밋하고 푸쉬
하지말도록" - is not a request. The hook fails closed: an unreadable history
blocks the publish.

What it cannot decide is whether the *word* was meant as an instruction: "커밋
메시지 초안 써줘" grants consent under this rule. The gate is a permission check,
not a promise that every match was an order.

## Verified Commit and Push

- `make commit m="type(scope): subject"` and `make push` are the publish path.
  `verify` is a prerequisite of both, so the tree that is published is the tree
  the gate read. Use them instead of hand-rolled `git commit` pipelines.
- Use the `commit` skill for user-requested commits or pushes.
- Before staging, inspect the complete workspace and keep unrelated user changes
  out of the commit unless the user explicitly approves them.
- `make verify` must pass before a commit or push. Capture its actual status:

  ```bash
  make verify; status=$?; printf 'MAKE_VERIFY_EXIT=%s\n' "$status"
  ```

- `MAKE_VERIFY_EXIT=0` is the pass condition. If a wrapper reports a conflicting
  status, report the harness issue; do not change project code to satisfy it.
- `strict-verified-git.ts` reruns `make verify` immediately before every
  OMP-mediated `git commit` or `git push` and blocks the Git command on failure.
- **The commit must be the verified tree.** `make verify` reads the worktree, so
  a commit with unstaged changes or untracked files publishes a tree that was
  never verified — an untracked new module imported by tracked files is the
  classic case: green verify, broken commit. `strict-verified-git.ts` blocks a
  commit while `git status --porcelain` shows either, naming both ways out:
  `git add -A` (commit what was verified) or `git stash -k` (move the rest out
  first, then re-verify).
- Confirm the remote branch and clean worktree after push.

## Parallel Sessions In One Worktree

Several sessions often work this tree at once, on one SQLite database and one
pair of dev servers. Each item below is a failure seen with two sessions live;
what holds it mechanically, if anything, is named beside it.

1. **Re-read a shared file right before editing it, and add beside what is
   there.** These files are edited by every feature: the nav
   (`frontend/src/layouts/dashboard/config-navigation.tsx`), `routes/paths.ts`,
   `App.tsx`, `locales/ko.ts` and `en.ts`, `lib/api/endpoints.ts` and
   `queryKeys.ts`, `backend/app/main.py` and `routers/__init__.py`,
   `backend/app/dependencies/*.py`, and `alembic/env.py`. An edit from a stale
   read silently reverts the other session's lines. `strict-additive-writes`
   refuses only the wholesale case (a full-file write keeping under half the
   file, a `>` truncation); a targeted edit from a stale read is held by nothing
   but the re-read.
2. **A model and its migration are one step.** Generate the revision
   (`make -C backend migrate-gen m="..."`) and apply it (`make migrate`) before
   anything else reads the model: the other session's reloading dev server
   imports the new model against a database that lacks its columns.
   `make -C backend migrate-check` fails a model that is ahead of its revisions.
3. **One alembic head.** Two sessions generating at once both write revision
   `N`; renumber yours onto the other's before applying. Convention (not
   machine-checked beyond `migrate-check`).
4. **Do not restart what you did not start.** `make down` kills the listeners on
   the backend and Vite ports, which ends the other session's servers too. The
   dev servers reload on their own; restart only when your change needs it.
5. **Delete only the rows you created, by their ids.** Keep each created id
   (the `POST` answer) and delete by those ids at the end; never by a time
   window or a name pattern, which takes the other session's projects and
   endpoints with yours. Clearing a project's request logs is the same: clear
   only a project you created.
6. **No formatter with its default settings.** The repository has no prettier
   configuration: `prettier --write` rewrites lines nobody touched and another
   session's diff with them. Format nothing you did not write.

## Review Judgement (not machine-checked)

- Whether staged work is *related* - only the author knows what the change is.
- Whether a commit message describes the change honestly.

The gate that **is** enforced is narrower and absolute: `strict-verified-git.ts`
runs `make verify` immediately before any commit or push, and a nonzero status
blocks it.

## Never Do These

- Commit or push unverified changes.
- Include unrelated staged work without explicit user approval.
- Commit a partial index after verifying the whole worktree — verify the tree you
  are publishing, not a different one.
- Bypass a failed verification gate.
- Commit or push without the user asking in the current turn — the tree being
  green is not the same as the publish being wanted.
