/**
 * The one wording for every row footer in the app.
 *
 * Two components render that footer — the list page's `ServerDataGrid` (MUI X)
 * and a detail dialog's `TablePagination` (MUI core) — and neither ships a usable
 * Korean string:
 *
 * - MUI core has no locale bundle wired here, so its defaults are English.
 * - The `@mui/x-data-grid` koKR bundle is half-translated: `paginationRowsPerPage`
 *   is `'페이지 당 행:'` while `paginationDisplayedRows` returns
 *   `` `${from}–${to} of ${count}` `` — measured on the integration list, which
 *   read `페이지 당 행: 10  1–2 of 2`.
 *
 * So the labels come from our own locale files and are handed to both surfaces.
 * A reader moving from a list into a dialog must not have to notice that the
 * footer changed vocabulary.
 */

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useMediaQuery } from '@mui/material'
import type { Theme } from '@mui/material'
import { formatCount } from '@/utils/formatNumber'

/** Read by a screen reader, drawn nowhere: the select's name without its width. */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const

/**
 * A footer that fits the narrowest phone, wherever it stands - a list's cards
 * or a dialog's tab. MUI's toolbar spends 32px after the select and 20px before
 * the arrows; with the full sentence (`1–20 / 전체 94,773`) and the 페이지당 행
 * label that ran the next arrow 31-49px past a 358px card, and 33-85px past a
 * dialog's 302px table (measured on six tabs: 사용 제품, 호출 로그, 생산 제품…).
 * The label is visually hidden (it still names the select), the numbers go
 * without words, and a total too long for one line wraps the arrows rather
 * than scrolling them away - at the right, under the thumb that turned the page.
 * The toolbar keeps 2px under the last line for the arrows' touch reach (40px
 * buttons reach 44, `TOUCH_REACH`): wrapped, the arrows stood on the footer's
 * bottom edge and their reach gave it 2px of vertical scroll (92 in 90,
 * measured on a dialog's table at 320). One line is still 52px.
 */
export const PHONE_PAGER_SX = {
  '& .MuiTablePagination-toolbar': { pl: 1, pr: 0.5, pb: '2px', flexWrap: 'wrap', columnGap: 0.5 },
  '& .MuiTablePagination-spacer': { display: 'none' },
  '& .MuiTablePagination-selectLabel': VISUALLY_HIDDEN,
  '& .MuiTablePagination-input': { ml: 0, mr: 0 },
  '& .MuiTablePagination-displayedRows': { flex: '1 1 auto', textAlign: 'right', whiteSpace: 'nowrap' },
  // Doubled selector: MUI's own 20px left margin on the actions outranks a
  // single class, and wrapped arrows sat at x=74 of a 228px footer at 320.
  '& .MuiTablePagination-toolbar .MuiTablePagination-actions': { ml: 'auto', flexShrink: 0 },
} as const

/** MUI passes `estimated` when the total is a guess; the grid uses -1 for unknown. */
export interface DisplayedRowsInfo {
  from: number
  to: number
  count: number
}

export function usePaginationLabels() {
  const { t } = useTranslation('common')
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'))

  return useMemo(
    () => ({
      labelRowsPerPage: t('pagination.rows_per_page'),
      /**
       * The arrows' names. MUI core's are English, so a phone's pager said "Go
       * to next page" where the grid's, through the koKR bundle, said 다음
       * 페이지로 이동.
       */
      getItemAriaLabel: (type: 'first' | 'last' | 'next' | 'previous') =>
        ({
          first: t('pagination.first_page'),
          previous: t('pagination.previous_page'),
          next: t('pagination.next_page'),
          last: t('pagination.last_page'),
        })[type],
      labelDisplayedRows: ({ from, to, count }: DisplayedRowsInfo) =>
        count < 0
          ? t('pagination.displayed_rows_unknown', { from: formatCount(from), to: formatCount(to) })
          : t('pagination.displayed_rows', {
              from: formatCount(from),
              to: formatCount(to),
              total: formatCount(count),
            }),
      /**
       * The phone's footer: the numbers alone. The card is 358px at 390 and 288px
       * at 320, and the full sentence beside the size select and both arrows ran
       * the next arrow 31-49px past the card, out of sight and out of reach.
       */
      labelDisplayedRowsCompact: ({ from, to, count }: DisplayedRowsInfo) =>
        count < 0
          ? `${formatCount(from)}–${formatCount(to)}`
          : `${formatCount(from)}–${formatCount(to)} / ${formatCount(count)}`,
      /** Below `sm`: the compact footer's style, for a footer that is not always on a phone. */
      phone,
    }),
    [t, phone],
  )
}
