---
description: Frontend routing — path registry, route table, navigation model, shell layout
globs:
      - frontend/src/App.tsx
      - frontend/src/routes/paths.ts
      - frontend/src/layouts/**/*.tsx
      - frontend/src/pages/*.tsx
alwaysApply: false
---

# Frontend Routing

Three tables describe the same set of screens, and all three are generated from
one: the registry names the paths, the route table binds them to components, the
navigation model makes them reachable. When they disagree the failure is silent —
a dead link, or a screen nobody can find.

Machine-checked by `check-frontend-routing.ts` (`make check-frontend-routing`).

## The Three Tables

| File | Role |
|---|---|
| `routes/paths.ts` | `PATHS` — every path, named once |
| `App.tsx` | `<Route path={PATHS.x} element={<XPage />} />` |
| `layouts/dashboard/config-navigation.tsx` | `NAV_ITEMS` — the sidebar |

Both directions are checked: a registry leaf that is not routed is a path that
reaches nothing; a route or nav entry not in the registry is a literal waiting
to break. `PATHS.root` is the one documented non-navigation leaf
(`NON_NAV_PATHS`) — the root only redirects to `PATHS.project`.

## The Shell Layout

```tsx
<Route element={<DashboardLayout />}>
  <Route path={PATHS.project} element={<ProjectPage />} />
  <Route path="*" element={<NotFoundPage />} />
</Route>
```

The admin UI is local-only and has no sign-in, so there are no guards: every
screen renders inside `DashboardLayout`. The catch-all (`path="*"`,
`NotFoundPage`) is routed inside `DashboardLayout` too, so an unknown path
renders inside the shell and the reader keeps the navigation to leave it.
Machine-checked by `check-frontend-routing` (`checkCatchAllInShell`).

A project's detail (endpoints, test panel, logs) opens as a dialog with tabs
held in the query string, not as a param route under `/project/:id`.

## One Item Active

`NavLink` marks an item active when the location starts with its path, so
`/project` would stay active on a hypothetical `/project/archive` and the
sidebar would show two selected items. The sidebar renders every item with
`end`: the match is exact, and exactly one item is active on every route. The
routes are flat - a detail opens as a dialog held in the query string,
not under a sub-path - so no screen relies on prefix matching.
`check-frontend-routing` (`checkNavActiveIsExact`) fails when two nav paths are in
a prefix relation and the `NavLink` has no `end`.

## Code Splitting

Pages are `lazy()` and the route table is wrapped in one `Suspense`. MUI and the
data grid are most of the bundle; the first paint should not wait for screens
the reader has not opened.

## Review Judgement (not machine-checked)

- Whether a route belongs in the sidebar at all, or under a group that is not
  the one it was put in. Presence is checked; placement is a decision.
- Whether the root redirect target is the right landing screen.
- Whether a path reads as a URL a user could type.

## Never Do These

- Write a literal path in `to=`, `navigate(...)` or `path=` — use `PATHS`
- Route a screen without adding it to `NAV_ITEMS` (except `PATHS.root`)
- Route the catch-all outside `DashboardLayout`
- Add a param route for a detail that belongs in the dialog
- Render a nav item through `NavLink` without `end` where another nav path begins with its path
- Add a path to the registry and leave it unrouted
