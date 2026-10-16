---
description: Frontend screen types — project list, form dialog, project detail dialog with tabs and panels, confirm dialog
globs:
      - frontend/src/sections/**/*.tsx
      - frontend/src/pages/*.tsx
      - frontend/src/components/**/*.tsx
      - frontend/src/hooks/*.ts
alwaysApply: false
---

# Frontend Screens

Four screen types cover this application, and each has exactly one shape. A
screen is written by copying the nearest screen of its type: the similarity is
the standard, not duplication waiting to be factored away. A generic
`<CrudScreen domain={...}>` would hide the columns, the dialogs and the empty
sentence behind configuration, and the first screen needing an exception would
fork it.

This document is a convention (not machine-checked): no screen hook is ported.
The structural parts that are checked live in `check-frontend-domain`,
`check-frontend-layout`, `check-frontend-routing`, `check-frontend-api-layer`,
`check-frontend-i18n` and `check-frontend-code` (all in `make verify`).

## Screen Types

| Type | File | Exemplar |
|---|---|---|
| List + CRUD | `sections/<domain>/<Domain>List.tsx` | `sections/project/ProjectList.tsx` |
| Form dialog | `sections/<domain>/<Domain>FormDialog.tsx` | `sections/project/ProjectFormDialog.tsx` |
| Detail dialog + tabs + panels | `sections/<domain>/<Domain>DetailDialog.tsx` + `detail/*Tab.tsx` + `*Panel.tsx` | `sections/project/ProjectDetailDialog.tsx` |
| Confirm | `components/confirm-dialog/ConfirmDialog.tsx` | every delete |

`endpoint` and `request_log` are child domains of `project`: they have no page,
no list screen and no form dialog of their own. Their screens are the project
detail dialog's tabs (`detail/ProjectEndpointsTab.tsx`,
`detail/ProjectLogsTab.tsx`) and its panels (`EndpointPanel`,
`EndpointTestPanel`, `LogPanel`). There are no param routes: a record is a URL
dialog over the list (`?detail=<id>`), and its tab and panel ride in the query
string.

## A Zero Is Not Information, A Date Is Not Digits

- **A count is drawn when there is something to count**, or says in a sentence
  that there is nothing. `endpoint_count` is a number on the list row; inside
  the detail dialog an empty endpoints tab says "no endpoints yet" and offers
  the add, rather than drawing an empty table.
- **A timestamp is a date to the reader.** A field or cell holding a `*_at`
  reads it through `formatDateTime` (`utils/formatTime.ts`); a grid column
  names the formatter in `valueFormatter` or `renderCell`, because a grid has
  no JSX for the raw value to show up in.
- **No two columns of one grid carry the same header**, in either language.

## A Column Fits What It Prints

Two things in a table cannot shrink: a **badge** (`Label` is
`white-space: nowrap`, so a narrow column cuts it — the method badge `OPTIONS`,
a status code) and a **header name** (a header nobody can read is a column
nobody can sort). A column's floor is at least the ink of its header in either
locale and of the widest value of its badge vocabulary.

## Column Width

Every grid column has a **floor**, a **share** and a **priority**, kept in one
`COLUMN` table at the top of the list screen and turned into grid props by
`sized(...)` (`ProjectList`). The name is the row's identity and takes the
largest share; a slug or a count takes a small one; the floors are pixels and
the shares divide what is left. Below the sum of the floors the grid scrolls
sideways instead of crushing a column; at a phone width the list is cards
(`GridCardList`, the screen's `CARD` = title + fields).

Every grid cell centres its content vertically through the theme's
`MuiDataGrid` cell override (rule://frontend-design); a `renderCell` sets no
vertical alignment of its own.

## List Screen

Five hooks, in this order, and nothing else holds state:

```tsx
const grid = useDataGridState({ sortable: SORTABLE })
const filters = useListFilters(FILTER_FIELDS, grid.resetPage)
const query = useProjectList({ ...grid.params, ...filters.params })
const dialog = useCrudDialog<Project>()
const toast = useToast()

useQueryErrorToast(query, tCommon('messages.load_failed'))
```

Required parts:

- `ScreenCard` — the one surface a page's section draws.
- `ListCardHead` — the collection's name with the **total** as a badge, the
  filter boxes, and the list-wide verbs (add, refresh) as icons at the right of
  the title row. No labelled add button, no density control.
- `ListFilters` + `useListFilters` — one labelled box per filterable column.
- `ServerDataGrid` — never MUI's `DataGrid` directly, wired to
  `grid.sortModel` / `grid.setSortModel`, with `loading={query.isFetching}`:
  the list keeps the previous page on screen while the next loads
  (`placeholderData: (previous) => previous`), so `isLoading` is only true on
  first mount and would hide every later fetch. Loading locks nothing — not
  the pager, not the header sort, not the filter boxes.
- `useQueryErrorToast` — a failed page otherwise renders as an empty list, the
  one state a user cannot tell from success.
- `emptyTitle` — the empty state needs a sentence, and it turns on
  `isFiltered` (`messages.no_match`): "no projects" under a typed name reads
  as an empty table.
- `formatCount`/`formatNumber` for every printed count.

### List State Is The URL

The page, its size, the sort and every filter live in the query string
(`?page=2&size=50&sort=name&order=asc&name=shop`, defaults omitted), so a
reload, a pasted link and back land on the list the reader was looking at; an
open record is `?detail=<id>` through `useUrlDialog`, its open tab `&tab=`
through `useUrlTab`. A choice pushes (a page, a size, a sort, the reset),
typing replaces once it settles, and the writes of one gesture are one entry
(`useSearchParamWriter`). A size change lands on page one. A page, size or
`sort` the screen cannot mean (outside `SORTABLE`) reads as its default and
leaves the address in place.

- **Every overlay closes on back.** A `Dialog`, `Drawer`, `Popover` or `Menu`
  is back-aware: `useUrlDialog`, `useBackCloses`, or `useDiscardGuard`. A
  record dialog opened from `useState` alone leaves the screen on back.
- **A query-string write states its history.** Outside `hooks/`, a
  `setSearchParams(` passes `replace:`; the hooks own push-or-replace.
- **A record dialog is an address.** `ProjectDetailDialog` calls
  `useMissingRecordCloses` (a project that answers 404 closes its dialog) and
  `useUrlTab`; closing never writes the bare list (`setSearchParams({})`),
  because the entry under it still names the record.

### The Keyboard Opens What The Pointer Opens

A row that opens a record opens on Enter or Space (`ServerDataGrid` handles
`onCellKeyDown` on a cell that edits nothing). A row that opens something is
44px under a finger. The pager keeps the keyboard: an arrow that goes disabled
at the end hands focus to the pager's first live arrow (`usePagerFocus`).

### Sorting

**The header sorts the collection, on the server.** `useDataGridState` keeps
the one sorted column and sends `sort` and `order`; a sort change lands on page
one. `ServerDataGrid` runs `sortingMode="server"`, so the grid never sorts the
loaded page itself. The columns a grid may sort are the router's to close:
`ProjectSortQuery` in `app/dependencies/query.py` is a `Literal` of them
(`name`, `slug`, `created_at`; rule://backend-router-params). A column the
server does not sort (`endpoint_count`) says `sortable: false`, or its first
header click answers 422.

### Filtering

**One box per column, named as the query parameter.** `FILTER_FIELDS` is the
list of parameter names (`['name']`), and the boxes are built from it, so a
box, its label and what it sends cannot drift apart. `FILTER_LABEL_KEYS` maps
each field to its locale key and the box reads `t(FILTER_LABEL_KEYS[field])` —
a ternary on the field name is right for two fields and silently wrong for the
third.

**One query parameter, one control.** Driving a parameter from two controls
leaves the screen holding two answers for one column. A control that replaces a
box removes that field from `FILTER_FIELDS` in the same edit.

A single keyword box over several columns is not the standard: it cannot say
which column matched. An empty box is an omitted parameter, never `field=`.
`useListFilters` owns the debounce (500ms; a value ending in a bare jamo is not
sent) and the page reset.

### Editing In Place

A list edits rows in the grid when the editable columns *are* the row.
`ServerDataGrid` takes the row-edit props with `editMode` fixed to `row` (a
cell-at-a-time edit would send one `PUT` per cell to an endpoint that takes the
whole resource). `useRowEditor` owns the mechanism — modes, `startEdit` /
`commitEdit` / `cancelEdit`, caret placement, the `reported` flag. The screen
owns what its domain refuses (`ProjectList`'s `nameProblem`), used by both
`preProcessEditCellProps` and the refused save so a red cell and the message
never disagree, and `processRowUpdate` returns the server's row so the grid
holds the new `version` (a stale one answers 409 `stale_version`).

**Creating in the row** is allowed only when every field of
`<Domain>CreateRequest` is an editable column (`check-frontend-domain`
compares them). `ProjectCreateRequest` carries `slug` and a multiline
`description`, so the project is created by `ProjectFormDialog` and the row
edits `name` only.

**Refusing a save** says why in one sentence carried by the rule itself
(`{ key: 'validation.name_max', count: NAME_MAX_LENGTH }`), toasts it and puts
the caret in the offending cell; never a label and a code joined by a colon.
Nothing is said while typing an untouched draft.

Every intent a row serves is a button in its last column, built by
`rowActionsColumn` (MUI's `type: 'actions'`), whose `count` is the widest
branch's button count — it is the column's width. A row may also be a door
(open the detail dialog); `ServerDataGrid` guards it: no door in edit mode, a
click in the actions cell belongs to its button, double-click editing is off.
One intent, one control: the door replaces the "open" button it duplicates.

## Form Dialog

- `useForm` + `yupResolver` — the schema is the only validator.
- `FormProvider` + `RHF*` field wrappers — a raw `<TextField value onChange>`
  keeps a second copy of the value.
- `methods.reset(...)` on open — the dialog stays mounted between rows.
- **No `useState` for field values.**
- `useDiscardGuard(isDirty, onClose, open)` + `FormDialogActions` — Escape,
  the backdrop and back ask before typed input is lost; cancel and the close
  button never ask. The two action rows are keyed (`key="asking"` /
  `key="actions"`): React otherwise reuses one `<button>` across the branches,
  and "keep editing" becomes submit mid-click.
- The first field takes focus through `methods.setFocus(...)` in
  `slotProps.transition.onEntered`; `autoFocus` loses to the focus trap.
- An `RHF*` field hands react-hook-form's `ref` to the input
  (`inputRef={ref}`), so an invalid submit focuses the refused field.
- A server refusal goes through `applyServerError` (`lib/api/formErrors.ts`):
  `errors.<code>` on the field that owns it (a 409 `conflict` on a duplicate
  slug lands on `slug`), the toast for everything else.

## Detail Dialog — project, its tabs and its panels

`ProjectDetailDialog` is the record surface for a project and everything that
hangs off it:

| Layer | File | Owns |
|---|---|---|
| Dialog | `ProjectDetailDialog.tsx` | header, tab strip (`useUrlTab`), **panel mode**, **paging state** |
| Tab | `detail/ProjectEndpointsTab.tsx` | the project's endpoints table (method badge, path, status, enabled) |
| Tab | `detail/ProjectLogsTab.tsx` | the request log table (time, method, path, status, matched, duration), clear-all |
| Panel | `EndpointPanel.tsx` | one endpoint read **and** edited (create too), through `PanelStrip` |
| Panel | `EndpointTestPanel.tsx` | send a request through the mock router and show the one answer |
| Panel | `LogPanel.tsx` | one request log read-only: request headers/body, the response status |

**One modal, then panels.** A dialog stacked on the detail dialog hides the
record it asks about. A panel *replaces* the dialog body while the header
stays, and leaving is drawn by the panel's strip (`onBack` on the line above
the identity row; verbs through `actions`). The confirm dialog is the one
exception: an `xs` question, answered and gone.

**The identity row is one line, and exactly one child absorbs what is left** —
the endpoint's path is the `noWrap` child; the method badge and the status
keep their width.

**A tab is a pure presenter for the entity's own data**, with one declared
exception: a child collection with its own server pagination is read by its
own hook (`useEndpointList`, `useLogList`) because it cannot arrive as a prop
from the project read. The project itself is read once, by the dialog.

**The dialog owns what has the dialog's lifetime**: which tab shows, which
panel replaced the body, and where each table is paged to. Paging cannot live
in the tab — opening a panel unmounts it, and the reader would return to page
1. The close transition resets all three.

**One record has one surface.** Reading an endpoint renders text; editing
turns the same rows into inputs; the pinned strip carries both modes' verbs.
A read is text (`DetailField`, `RecordFields`), never a disabled input. A row
carries one door: open (and delete); "edit" is the button inside the panel.

**A record is addressed by its id**, never by a held object: the panel
resolves its endpoint from the current list on every render, and an id that no
longer resolves falls back to the tab.

**One run has one ending, and one place that shows it.** `EndpointTestPanel`
holds the whole outcome — status, headers, body, duration, or the transport
failure — in one state value and renders one result section; a re-run
replaces it. It never renders a mutation hook's `.data` beside a separate
failure state. What the mock answered (including a 404 `mock_not_matched`) *is*
the result, so it is shown where the result goes, not as a toast.

**The log is append-only.** `ProjectLogsTab` and `LogPanel` read, never edit;
the only write is "clear logs" (`useDeleteLog`), which goes through the confirm
dialog. A log row whose endpoint was deleted shows the stored method and path
with no link (`endpoint_id` is `SET NULL`).

**A body or header value is read whole.** A request body or a template is the
content the reader opened the panel for: it renders in a wrapping monospace
block, not a clipped cell. Tables clip on purpose, and every clipped cell
renders `ClippedText` (a real MUI `Tooltip`, attached only while the text
overflows; the native `title` attribute does not count).

**A row's key is the row's `.id`**, never its words (two endpoints may share a
path under different methods).

**Every table pages, and the footer shows whenever there are rows**, clamped
(11 rows keeps page 2 at `11–11`; 10 rows falls back to page 1). Footer wording
comes from `usePaginationLabels`. `ServerPagedTable` draws its own
`LinearProgress` from `loading={query.isFetching}` and locks nothing.

**A panel's alert goes under its strip**, never at the end of its body: it is
the reason the pinned save is dead.

## Confirming A Delete

`ConfirmDialog` is the one question every delete goes through — a project, an
endpoint, clearing a project's logs — and it wears the app's dialog head
(`FormDialogHeader`, `tone="error"`). A file that calls a `useDelete…`
mutation renders the confirm.

**The body is one sentence**, the domain's own (`messages.delete_confirm`),
naming the row *and* what deleting costs: deleting a project removes its
endpoints and logs (`CASCADE`). The title says the verb once. `xs` +
`fullWidth`.

## Reporting Failure

| Failure | Reported by | Retry |
|---|---|---|
| A read (`query.isError`) | `useQueryErrorToast(query, tCommon('messages.load_failed'))` | the head's refresh |
| A write (`mutateAsync`) | `applyServerError` / `serverErrorMessage` / `useToast` | the user resubmits |

Every failure ends in a toast; a field error stays on its field. No screen
renders `messages.load_failed` itself, no `isError` branch belongs in JSX, and
no inline error `<Alert>` replaces a table. `useQueryErrorToast` takes the
query, keyed by `errorUpdatedAt`, so every failed fetch is answered exactly
once. The test panel's mock answer is the one result shown inline (above).

## Review Judgement

- Whether a copied screen should have diverged as much as it did.
- Whether a list's columns, an empty sentence or a confirm body actually say
  something.
- Whether a dialog should have been a page, or a panel a dialog.
- `PageHeader` is required on pages routed under `DashboardLayout`; the
  catch-all is routed inside the shell too.

## Never Do These

- Render `DataGrid` outside `components/data-grid/ServerDataGrid.tsx`
- Ship a list screen with no `useQueryErrorToast` or no empty sentence
- Build a list head by hand instead of `ListCardHead`
- Filter with one keyword box over several columns, or with boxes whose names
  are not the router's query parameters
- Add a filter or sort control the backend has no parameter for
- Refuse a save without saying why
- Report a failure in the body (`<Alert severity="error">`, an `isError`
  branch in JSX) — except the test panel's mock answer
- Hold form field state in `useState`, or skip `methods.reset` in a reused
  dialog
- Give endpoint or log a page, a list screen or a form dialog of their own
- Stack a second modal on the detail dialog other than the confirm
- Call a delete in a file that renders no confirm
- Open a record dialog, a drawer or a menu from `useState` alone
- Write the query string from a screen without saying `replace:`
