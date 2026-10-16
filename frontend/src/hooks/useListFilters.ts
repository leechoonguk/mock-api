/**
 * The filter state of a list screen: what is typed, what is asked for, and when.
 *
 * A list filters by naming columns — `username`, `code` — and each name is the
 * query parameter the router reads (`TextFilterQuery` in
 * `app/dependencies/query.py`). The hook holds one value per field and answers
 * with `params`: the fields that have a value, omitted entirely when they do
 * not. An empty box is never sent as `field=`, because the backend declares
 * `min_length=1` and would answer 422 for a screen the reader thinks is
 * unfiltered.
 *
 * **A field is one string or a list of them, and the screen says which.** The
 * names in `multiple` hold a list: a multi-select, sent as the parameter
 * repeated (an exact column of a query entity), empty as `[]` and omitted from `params` like
 * an empty string. The shape is the only flag: `ListFilters` renders a box as a
 * multi-select because the value it is handed is a list, so the hook and the
 * box cannot disagree about a field.
 *
 * Two behaviours it owns, because both were written per screen and both are the
 * kind of thing that drifts:
 *
 *   - **Debounce.** Every keystroke is a query key, so an undebounced field
 *     sends one request per character and the answers can land out of order —
 *     "ali" arriving after "alic" shows rows the boxes no longer describe. It
 *     holds for the multi-selects too: four boxes ticked in a row are one request.
 *     While an IME composes, nothing is applied at all, and a value that ends in
 *     a bare jamo or a half-typed date keeps the last applied one: each of those
 *     was a request (7 for 고추장) or a 422 the reader never meant.
 *   - **Page reset.** A filter that matches three rows while the grid sits on
 *     page 4 answers an empty page, which reads as "no results" for a filter
 *     that has them. `onApply` is the screen's `resetPage`.
 *
 * **What is applied lives in the URL**, each box under its own parameter name
 * (a select repeated: `?ingredient_material_name=밀가루&ingredient_material_name=설탕`),
 * so a reload, a link and a detail→back keep the filters; what is *typed* stays
 * here until it settles. A typed box replaces the entry it was typed on; a
 * select's tick, a chip's removal and the reset push - the policy is
 * `useSearchParamWriter`'s. A pick applies at once: the debounce is for typing,
 * and a tick that waited 500ms for nothing read as a tick that did nothing.
 * When the URL moves under the boxes (back, forward), the boxes follow it.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FILTER_DEBOUNCE_MS } from '@/config'
import { useSearchParamWriter } from '@/hooks/useSearchParamWriter'
import type { HistoryMode } from '@/hooks/useSearchParamWriter'
import { endsWithJamo } from '@/utils/hangul'

/** A date bound's name (glossary: `_from` / `_to`), and the two shapes the router takes. */
const DATE_BOUND_FIELD = /_(from|to)$/
const DATE_BOUND_VALUE = /^(\d{8}|\d{4}-\d{2}-\d{2})$/

/** A date the calendar has: `2026-13-45` is eight digits and a 422. */
const isDay = (value: string) => {
  if (!DATE_BOUND_VALUE.test(value)) return false
  const digits = value.replace(/-/g, '')
  const day = new Date(Date.UTC(+digits.slice(0, 4), +digits.slice(4, 6) - 1, +digits.slice(6)))
  return day.toISOString().slice(0, 10).replace(/-/g, '') === digits
}

/** The default for a screen with no multi-select, kept stable so `reset` is too. */
const NO_MULTIPLE: readonly never[] = []

/** One box's value: a typed or picked string, or the values a multi-select holds. */
export type ListFilterValue = string | readonly string[]

/** The boxes' values: a string per single field, a list per multi-select. */
export type ListFilterValues<F extends string, M extends F> = Record<Exclude<F, M>, string> &
  Record<M, readonly string[]>

const emptyValues = <F extends string, M extends F>(
  fields: readonly F[],
  multiple: readonly M[],
): ListFilterValues<F, M> =>
  Object.fromEntries(
    fields.map((field) => [field, (multiple as readonly string[]).includes(field) ? [] : '']),
  ) as ListFilterValues<F, M>

const isEmpty = (value: ListFilterValue) =>
  typeof value === 'string' ? value === '' : value.length === 0

/**
 * What a box sends once typing rests: the trimmed value, or the one already
 * applied while the value is still mid-word (a bare jamo) or mid-date.
 */
const settledValue = (field: string, value: ListFilterValue, previous: ListFilterValue): ListFilterValue => {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (endsWithJamo(trimmed)) return previous
  if (DATE_BOUND_FIELD.test(field) && trimmed !== '' && !isDay(trimmed)) return previous
  return trimmed
}

/** The values a query string holds for these boxes: a list per select, a string otherwise. */
const valuesOf = <F extends string, M extends F>(
  search: URLSearchParams,
  fields: readonly F[],
  multiple: readonly M[],
): ListFilterValues<F, M> =>
  Object.fromEntries(
    fields.map((field) => [
      field,
      (multiple as readonly string[]).includes(field) ? search.getAll(field) : (search.get(field) ?? ''),
    ]),
  ) as ListFilterValues<F, M>

/** The boxes written into a query string: an empty box is no parameter at all. */
const writeValues = (search: URLSearchParams, values: Record<string, ListFilterValue>) => {
  for (const [field, value] of Object.entries(values)) {
    search.delete(field)
    if (typeof value === 'string') {
      if (value !== '') search.set(field, value)
    } else {
      for (const item of value) search.append(field, item)
    }
  }
}

/** Every box settled against what is applied - what a write would send. */
const settleAll = <F extends string, M extends F>(
  inputs: ListFilterValues<F, M>,
  applied: ListFilterValues<F, M>,
): ListFilterValues<F, M> =>
  Object.fromEntries(
    Object.entries<ListFilterValue>(inputs).map(([field, value]) => [
      field,
      settledValue(field, value, (applied as Record<string, ListFilterValue>)[field]),
    ]),
  ) as ListFilterValues<F, M>

export function useListFilters<F extends string, M extends F = never>(
  fields: readonly F[],
  onApply: () => void,
  multiple: readonly M[] = NO_MULTIPLE,
) {
  const [searchParams] = useSearchParams()
  const write = useSearchParamWriter()
  const appliedKey = JSON.stringify(valuesOf(searchParams, fields, multiple))
  // Keyed by its text, so an unrelated parameter (a dialog's) is no new value.
  const applied = useMemo(() => JSON.parse(appliedKey) as ListFilterValues<F, M>, [appliedKey])

  const [inputs, setInputs] = useState<ListFilterValues<F, M>>(applied)
  const inputsRef = useRef(inputs)
  useLayoutEffect(() => {
    inputsRef.current = inputs
  })
  /** True while an IME composes in a box: nothing is applied until it ends. */
  const [composing, setComposing] = useState(false)

  /**
   * What this hook last wrote. The URL arriving at it is our own write landing,
   * and the boxes - possibly typed further meanwhile - are left alone; any other
   * value is back or forward, and the boxes take it.
   */
  const written = useRef(appliedKey)
  useEffect(() => {
    if (appliedKey === written.current) return
    written.current = appliedKey
    setInputs(JSON.parse(appliedKey) as ListFilterValues<F, M>)
  }, [appliedKey])

  const apply = useCallback(
    (next: ListFilterValues<F, M>, mode: HistoryMode) => {
      const key = JSON.stringify(next)
      // An unchanged value is no new request and no page reset.
      if (key === written.current) return
      written.current = key
      write((search) => writeValues(search, next), mode)
      onApply()
    },
    [write, onApply],
  )

  /**
   * `mode` is for a screen correcting a list itself - a cascade dropping a child
   * no ticked parent has - which is no choice of the reader's and must not be a
   * step of its own for back to land on.
   */
  const setInput = useCallback(
    (field: F, value: ListFilterValue, mode: HistoryMode = 'push') => {
      const next = { ...inputsRef.current, [field]: value }
      setInputs(next)
      // A pick is a choice, applied now; typing waits for the debounce below.
      if (typeof value !== 'string') apply(settleAll(next, applied), mode)
    },
    [apply, applied],
  )

  const reset = useCallback(() => {
    const empty = emptyValues(fields, multiple)
    setInputs(empty)
    apply(empty, 'push')
  }, [fields, multiple, apply])

  useEffect(() => {
    if (composing) return
    const timer = setTimeout(() => apply(settleAll(inputs, applied), 'replace'), FILTER_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [inputs, applied, composing, apply])

  const params = useMemo(
    () =>
      Object.fromEntries(
        Object.entries<ListFilterValue>(applied).filter(([, value]) => !isEmpty(value)),
      ) as Partial<ListFilterValues<F, M>>,
    [applied],
  )

  const isFiltered = useMemo(
    () => Object.values<ListFilterValue>(inputs).some((value) => !isEmpty(value)),
    [inputs],
  )

  /** How many boxes hold something - what a folded filter row says it carries. */
  const activeCount = useMemo(
    () => Object.values<ListFilterValue>(inputs).filter((value) => !isEmpty(value)).length,
    [inputs],
  )

  return { inputs, setInput, setComposing, reset, params, isFiltered, activeCount }
}
