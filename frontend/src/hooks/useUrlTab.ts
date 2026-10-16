/**
 * A record dialog's open tab, in the URL beside the record (`?detail=<id>&tab=products`).
 *
 * The tab was component state, so it lived exactly as long as the dialog's
 * screen stayed mounted. A record reached from another record opens on its own
 * screen (rule://frontend-screens, List State Is The URL), and back from there
 * remounted the first screen with its record on the first tab - measured on a
 * phone: a raw material reopened on 원재료 정보 instead of 사용 제품, a report on
 * 제품 정보 instead of 원재료, and on a desktop a business on its record instead
 * of 생산 제품. In the URL, back lands where the reader was.
 *
 * A tab is no step of its own: switching *replaces* the entry the dialog is open
 * on (keeping that entry's dialog marker, `useSearchParamWriter`), so back still
 * closes the dialog in one press. The first tab is no parameter at all. The
 * dialog's close drops the parameter with the dialog's (`useUrlDialog`); while
 * the dialog fades out it keeps showing the tab it was closed on.
 */

import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSearchParamWriter } from '@/hooks/useSearchParamWriter'

/** The query parameter a record dialog's tab is addressed by. */
export const TAB_PARAM = 'tab'

export function useUrlTab<T extends string>(
  tabs: readonly T[],
  first: T,
  open: boolean,
): [T, (tab: T) => void] {
  const [searchParams] = useSearchParams()
  const write = useSearchParamWriter()
  const asked = searchParams.get(TAB_PARAM)
  const inUrl = tabs.find((tab) => tab === asked) ?? first

  // What the dialog showed last while open: the parameter leaves with the close.
  const [shown, setShown] = useState(inUrl)
  if (open && shown !== inUrl) setShown(inUrl)

  const select = useCallback(
    (tab: T) =>
      write((search) => {
        if (tab === first) search.delete(TAB_PARAM)
        else search.set(TAB_PARAM, tab)
      }, 'replace'),
    [write, first],
  )

  return [open ? inUrl : shown, select]
}
