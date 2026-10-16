/**
 * The mechanism a row editor needs, once, for every screen that edits in place.
 *
 * Two screens carried it and 24 of their 26 row-edit lines were byte-identical:
 * the modes map, the three commands, the deferred focus move, and the
 * `reported` flag that stops a refused save being explained twice. None of that
 * is a decision a screen makes — the decisions are `problemOf` and `refusal`,
 * which stay in the screen because they are what the domain refuses.
 *
 * `apiRef` is taken rather than created here: the screen hands the same ref to
 * `ServerDataGrid`, so the pending values this hook reads are the ones the grid
 * is showing (rule://frontend-screens, Refusing A Save).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject, SetStateAction } from 'react'
import { GridCellModes, GridRowModes } from '@mui/x-data-grid'
import type { GridApiCommunity } from '@mui/x-data-grid/internals'
import type { GridRowId, GridRowModesModel, GridValidRowModel } from '@mui/x-data-grid'
import { useToast } from '@/hooks/useToast'

/** Why a row cannot be saved: the offending cell, and the sentence to show. */
export interface RowRefusal<F extends string> {
  field: F
  sentence: string
}

interface RowEditorOptions<R extends GridValidRowModel, F extends string> {
  apiRef: RefObject<GridApiCommunity | null>
  /** The screen's own judgement of a pending row — `null` when it may be saved. */
  refusal: (row: R) => RowRefusal<F> | null
  /**
   * What the screen keeps beyond the row's mode, at the three moments it turns.
   *
   * The user list needs all three: a refused row joins the set that is allowed
   * to look wrong, a committed one leaves it, and a cancelled draft is dropped
   * rather than reverted to a version no endpoint ever stored. They are
   * optional because a screen editing saved rows only needs the modes.
   */
  onRefused?: (id: GridRowId) => void
  onCommitted?: (id: GridRowId) => void
  onCancelled?: (id: GridRowId) => void
}

/** Whether a thrown refusal already told the reader what was wrong. */
function wasReported(error: unknown): boolean {
  return error !== null && typeof error === 'object' && 'reported' in error && error.reported === true
}

export function useRowEditor<R extends GridValidRowModel, F extends string>({
  apiRef,
  refusal,
  onRefused,
  onCommitted,
  onCancelled,
}: RowEditorOptions<R, F>) {
  const toast = useToast()
  const [rowModes, setRowModes] = useState<GridRowModesModel>({})

  /**
   * The caret lands in the row's first editable cell, not on the save button
   * the click left focus beside: typing is what the reader came to do, and
   * Escape only reaches the grid's cancel from inside an editing cell.
   */
  const startEdit = useCallback(
    (id: GridRowId) => {
      const fieldToFocus = apiRef.current?.getVisibleColumns().find((column) => column.editable)?.field
      setRowModes((previous) => ({ ...previous, [id]: { mode: GridRowModes.Edit, fieldToFocus } }))
    },
    [apiRef],
  )

  /**
   * Rows whose cancel the grid has been told of and has not yet finished.
   *
   * `onCancelled` waits for the grid's own answer — the modes model without the
   * row — because MUI stops a row in a layout effect and, when it no longer
   * finds the row there, *commits* it whatever `ignoreModifications` said.
   * A draft dropped on the cancel itself (even a microtask later) raced that
   * effect: Escape on a filled draft POSTed it and toasted `등록했습니다`, and a
   * half-filled one toasted its validation instead of closing (measured on the
   * user list, 2/2 runs once the last field's value had settled).
   */
  const cancelling = useRef(new Set<string>())

  const cancelEdit = useCallback((id: GridRowId) => {
    cancelling.current.add(String(id))
    setRowModes((previous) => ({
      ...previous,
      [id]: { mode: GridRowModes.View, ignoreModifications: true },
    }))
  }, [])

  /**
   * Refusing a save says which cell refused, and puts the caret in it.
   *
   * The grid's own answer to an invalid row is to stay open, silently, so the
   * save button reads as broken. The focus move is deferred because the button
   * that was clicked takes focus back on its own mouse event.
   */
  const reportRefusal = useCallback(
    (id: GridRowId, problem: RowRefusal<F>) => {
      onRefused?.(id)
      toast.error(problem.sentence)
      queueMicrotask(() => {
        apiRef.current?.setCellFocus(id, problem.field)
        apiRef.current?.getCellElement(id, problem.field)?.querySelector('input')?.focus()
      })
    },
    [apiRef, onRefused, toast],
  )

  const commitEdit = useCallback(
    (id: GridRowId) => {
      // The grid answers in its own row type; the screen's row is what it was given.
      const row = apiRef.current?.getRowWithUpdatedValues(id, '') as R | undefined
      const problem = row === undefined ? null : refusal(row)
      if (problem !== null) {
        reportRefusal(id, problem)
        return
      }
      onCommitted?.(id)
      setRowModes((previous) => ({ ...previous, [id]: { mode: GridRowModes.View } }))
    },
    [apiRef, onCommitted, refusal, reportRefusal],
  )

  /**
   * The same judgement around the grid's own commit, because Enter never passes
   * the save button: a rule enforced on the click alone lets the keyboard
   * through into a 422 the server has to explain. The throw is what keeps the
   * row open, and `reported` is what stops the error handler saying a second,
   * vaguer thing about a failure already named.
   */
  const guardRowUpdate = useCallback(
    (save: (updated: R, original: R) => Promise<R> | R) => async (updated: R, original: R) => {
      const problem = refusal(updated)
      if (problem !== null) {
        // A grid row is keyed by its id, which this app spells as a uuid string.
        const id: GridRowId = updated.id
        reportRefusal(id, problem)
        throw Object.assign(new Error(problem.sentence), { reported: true })
      }
      return await save(updated, original)
    },
    [refusal, reportRefusal],
  )

  /** The sentence a failed save shows, unless the refusal already named one. */
  const rowUpdateError = useCallback(
    (error: unknown, fallback: (error: unknown) => string) => {
      if (wasReported(error)) return
      toast.error(fallback(error))
    },
    [toast],
  )

  const isEditing = useCallback(
    (id: GridRowId) => rowModes[id]?.mode === GridRowModes.Edit,
    [rowModes],
  )

  /**
   * The modes setter the grid is handed, which also hears the grid's own cancel.
   *
   * Escape in an editing cell ends the edit inside MUI (`ignoreModifications`)
   * and never passes `cancelEdit`, so `onCancelled` never ran: a draft row
   * cancelled with Escape stayed in the table as an empty `—` row, counted in
   * the total, with `추가` disabled behind it (measured on the user list).
   * A cancel is noted when it is asked for and reported when the grid hands
   * back a model without the row — its edit state is gone by then, so the
   * screen may drop the row (see `cancelling`).
   */
  const changeRowModes = useCallback(
    (next: SetStateAction<GridRowModesModel>) => {
      if (typeof next !== 'function') {
        for (const [id, mode] of Object.entries(next)) {
          const cancelled = mode.mode === GridRowModes.View && mode.ignoreModifications === true
          if (cancelled && rowModes[id]?.mode === GridRowModes.Edit) cancelling.current.add(id)
        }
        for (const id of [...cancelling.current]) {
          if (id in next) continue
          cancelling.current.delete(id)
          onCancelled?.(id)
        }
      }
      setRowModes(next)
    },
    [rowModes, onCancelled],
  )

  /**
   * Escape anywhere in an editing row cancels it — on the save and cancel
   * buttons too, which are not editing cells and so got nothing from the grid.
   * Subscribed while a row edits, because the grid is mounted then (a phone
   * shows cards until a row opens).
   */
  const editingAny = Object.values(rowModes).some((mode) => mode.mode === GridRowModes.Edit)
  useEffect(() => {
    const api = apiRef.current
    if (!editingAny || api === null) return undefined
    return api.subscribeEvent('cellKeyDown', (params, event) => {
      if (event.key !== 'Escape' || params.cellMode === GridCellModes.Edit) return
      if (rowModes[params.id]?.mode !== GridRowModes.Edit) return
      cancelEdit(params.id)
      queueMicrotask(() => {
        if (apiRef.current?.getRow(params.id) != null) apiRef.current.setCellFocus(params.id, params.field)
      })
    })
  }, [apiRef, editingAny, rowModes, cancelEdit])

  return useMemo(
    () => ({
      rowModes,
      setRowModes: changeRowModes,
      startEdit,
      cancelEdit,
      commitEdit,
      isEditing,
      guardRowUpdate,
      rowUpdateError,
    }),
    [rowModes, changeRowModes, startEdit, cancelEdit, commitEdit, isEditing, guardRowUpdate, rowUpdateError],
  )
}
