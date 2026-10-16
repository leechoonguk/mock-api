/**
 * The head of a list card: what the collection is, what narrows it, what acts on it.
 *
 * Two rows. First a tab strip whose label carries the total as a `Label` — the
 * total under the filters, so the badge and the footer never disagree about how
 * much data is behind the screen — and, at its right end, the list-wide verbs:
 * add a row, choose columns, re-read the page, centred on the label. Then the
 * filter area, which holds only filters: the screen's boxes in a grid, and the
 * reset as its last item, in the next free cell.
 *
 * Each control has one slot (rule://frontend-screens, The List Head's Three
 * Slots): the verbs in the title row (a phone's head row beside 필터), the reset
 * among the boxes (a phone's sheet footer), and nothing else. Beside the
 * filters the verbs floated between rows at 1440, mid-three at 1280 and formed a
 * row of their own at 820 and 600; `check-frontend-screens` reads this file for
 * the three slots and `listHeadReport` measures them.
 *
 * It replaced `ListToolbar`, which put the add button alone on its own row above
 * the filters. The eye crossed the card twice to read one line, and the row that
 * held a single button also held a density control that changed how the rows
 * looked and nothing about what they are.
 *
 * **The fields are the screen's, the frame is not.** Which columns a list
 * filters is domain knowledge — `username`/`email` here, `code`/`display_name`
 * there — so they arrive as a node; a generic search box in this component
 * would have to guess what it searches. What the frame owns is the geometry:
 * the verbs at the title's right, the filters under it, always in that order.
 *
 * Add is an icon, not a labelled button: it adds a row *to this table*, and the
 * table's own operations are icons on the table's own row.
 *
 * **A derived table has no add.** The `food_*` collections are rebuilt off the
 * ledgers by a nightly job and read here; a row a user typed would be gone by
 * morning, and the backend has no verb to receive it. So `add` is one optional object — the
 * label and the handler travel together, because an add button with a handler
 * and no label, or the reverse, is half a control.
 */

import { isValidElement, useRef, useState } from 'react'
import type { ComponentProps, FocusEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import type { Theme } from '@mui/material'
import ClippedText from '@/components/clipped-text/ClippedText'
import ListFilters from '@/components/data-grid/ListFilters'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import { useBackCloses } from '@/hooks/useBackCloses'
import { formatCount } from '@/utils/formatNumber'

/** The narrowest a filter box may be: a 16-digit registry number or a 7-syllable industry name without clipping. */
const FILTER_MIN = 200

const SPINNER_SIZE = 20

/**
 * The verbs' gap under a finger: a 36px icon's target reaches 4px past each
 * side, so 8px lets two targets meet without overlapping - the header's gap.
 * At 4px a tap 4px right of 추가 landed on 새로고침 (measured at 390).
 */
const VERB_TOUCH_GAP = 8

/** The badge's own spinner, inside a 24px label. */
const COUNT_SPINNER_SIZE = 12

/**
 * The phone's filter sheet stops short of the top, so the page it narrows is
 * still seen behind it and the sheet reads as over the list, not instead of it.
 */
const SHEET_MAX_HEIGHT = '90dvh'

/**
 * What the sheet's body adds under itself while a box is focused: room for the
 * box to scroll to the top of the sheet, so its suggestions open downward above
 * a phone keyboard (about 336px of a 664px iPhone window) instead of upward over
 * the box's own label. Measured before: the 품목 보고 원재료 box, last of seven,
 * sat at y=646-674 under a 664px window and its popup covered its label.
 */
const FOCUS_ROOM = '60dvh'

/** A box brought to the top of the sheet's body when focused. */
const BOX_SELECTOR = '.MuiAutocomplete-root, .MuiFormControl-root'

/**
 * What raises a box: a field the keyboard types into, never a button. A chip's
 * ✕ or a clear button is focused by Android Chrome on the press, and raising
 * its box then scrolled the button 18px up before the finger lifted, so the
 * click landed on the box's padding (measured: a tap 8-16px below the ✕'s
 * centre removed nothing).
 */
const TYPED_FIELD = 'input:not([type=checkbox]):not([type=radio]), textarea'

/** One value a box holds, as the phone's row under the head shows it. */
interface AppliedFilter {
  key: string
  label: string
  remove: () => void
}

interface ListCardHeadProps {
  /** The tab label — the collection's name. */
  title: string
  /** The total under the current filters, shown as the tab's count badge. */
  count: number
  /**
   * The total is the previous filters' while the new page loads (the query's
   * `isPlaceholderData`): the badge says it is counting rather than print a
   * number that no longer describes the boxes - measured, `전체 1,856,644` stood
   * for 3-6 s over a 원재료 filter that matched 94,342.
   */
  countLoading?: boolean
  /**
   * A screen whose card holds several lists (개정 / 행정예고) puts them here, as
   * the title row's tabs - one tab strip, not a page-level one above the card.
   * The active item's badge is `count`, live under the filters; the others show
   * the `count` they carry, or none. `title` is then the strip's accessible name.
   */
  tabs?: {
    value: string
    items: { value: string; label: string; count?: number }[]
    onChange: (value: string) => void
  }
  /** One box per filterable column. */
  filters: ReactNode
  /**
   * The control that clears every box: a text button, the last item of the
   * boxes' grid, in the next free cell. Beside the grid it floated between
   * rows at 1440 and formed a row of its own at 820 and 600. A phone has it in
   * the sheet's footer instead, and the head row has none.
   */
  reset: { label: string; onReset: () => void; disabled: boolean }
  /**
   * The control that adds a row, or nothing on a read-only ledger.
   * `disabled` is `true` while a row is being added, so a second draft cannot start.
   */
  add?: { label: string; onAdd: () => void; disabled?: boolean }
  refreshLabel: string
  onRefresh: () => void
  refreshing: boolean
  /**
   * How many boxes hold something, and what the folded row's button says. On a
   * phone the boxes fold behind one button: seven stacked boxes pushed the
   * first row of the 품목 보고 list to y=753 on an 844px screen.
   */
  activeFilterCount: number
  filtersLabel: string
  /** The grid's column chooser, on a screen with more columns than it shows. */
  columns?: { label: string; onOpen: () => void }
}

export default function ListCardHead({
  title,
  count,
  countLoading = false,
  tabs,
  filters,
  reset,
  add,
  refreshLabel,
  onRefresh,
  refreshing,
  activeFilterCount,
  filtersLabel,
  columns,
}: ListCardHeadProps) {
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'))
  const [unfolded, setUnfolded] = useState(false)
  // Back closes the phone's sheet instead of leaving the list under it.
  useBackCloses(unfolded, () => setUnfolded(false), 'filters', phone)
  const boxesRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLButtonElement>(null)
  /**
   * The reset disables itself once nothing is filtered, and a disabled button
   * drops its focus to the page (measured: `BODY` after 필터 초기화). Focus goes
   * where the reader starts again: the first box, or the sheet's result button
   * on a phone, where a focused box would raise the keyboard.
   */
  const handleReset = () => {
    reset.onReset()
    if (phone) resultRef.current?.focus()
    else boxesRef.current?.querySelector<HTMLInputElement>('input')?.focus()
  }
  const { t: tCommon } = useTranslation('common')
  /**
   * On a phone the boxes are folded into the sheet, and closing it left only
   * `필터 (1)` to say the list was narrowed - measured: after 품목보고에서 보기
   * the list never said 밀가루. So what the boxes hold stands under the head,
   * each value a button that removes it.
   */
  const applied = phone ? appliedOf(filters) : []

  /*
    A focused box rises to the top of the sheet's body, after the body has grown
    the room to put it there (`FOCUS_ROOM`, applied by `:has(<typed field>:focus)`
    in the same frame as the focus). A tap on the box itself, not on a suggestion
    in its popup, which is portalled outside the body - and only on a field the
    keyboard types into (`TYPED_FIELD`).
  */
  const raiseFocusedBox = (event: FocusEvent<HTMLElement>) => {
    if (!event.target.matches(TYPED_FIELD)) return
    const box = event.target.closest(BOX_SELECTOR)
    if (box === null || !event.currentTarget.contains(box)) return
    requestAnimationFrame(() => box.scrollIntoView({ block: 'start' }))
  }

  /*
    A grid of equal cells, as many per row as fit at FILTER_MIN each, and
    the cells stretch to fill the row. Fixed widths wrapped: six boxes at
    1400px ran 130px past the card's edge (measured, the last select's
    centre at x=1530), and at 900px they folded into 3+3 with a ragged
    right edge and the reset stranded beside the gap. A filter nobody can
    reach is a filter that does not exist; a row that ends short of the
    edge reads as unfinished.
  */
  const boxes = (
    <Box
      ref={boxesRef}
      data-list-head="boxes"
      sx={{
        flexGrow: 1,
        display: 'grid',
        gap: 2,
        alignItems: 'center',
        gridTemplateColumns: { xs: '1fr', sm: `repeat(auto-fit, minmax(${FILTER_MIN}px, 1fr))` },
      }}
    >
      {filters}
      {/*
        The reset is the last item of the flow: the next free cell, so at 1440 it
        stands after the last box on the second row instead of adding a third.
        On a phone the sheet's footer is the reset. `order` puts it before the
        chip row of ticked values, which spans a row of its own at the end.
      */}
      {!phone && (
        <Button
          variant="text"
          color="inherit"
          data-list-head="reset"
          disabled={reset.disabled}
          onClick={handleReset}
          startIcon={<Iconify name="reset" />}
          sx={{ order: 1, justifySelf: 'start', minWidth: 0 }}
        >
          {reset.label}
        </Button>
      )}
    </Box>
  )

  /**
   * The list-wide verbs: the title row's right end, or the phone's head row. Never
   * beside the filters (rule://frontend-screens, The List Head's Three Slots).
   */
  const actions = (
    <Stack
      direction="row"
      alignItems="center"
      spacing={0.5}
      useFlexGap
      sx={{
        ml: 'auto',
        '@media (pointer: coarse)': { gap: `${VERB_TOUCH_GAP}px` },
      }}
    >
      {add !== undefined && (
        <Tooltip title={add.label}>
          <span>
            <IconButton
              data-head-action="add"
              aria-label={add.label}
              color="primary"
              onClick={add.onAdd}
              disabled={add.disabled === true}
            >
              <Iconify name="add" />
            </IconButton>
          </span>
        </Tooltip>
      )}

      {columns !== undefined && !phone && (
        <Tooltip title={columns.label}>
          <IconButton aria-label={columns.label} onClick={columns.onOpen} data-head-action="columns">
            <Iconify name="columns" />
          </IconButton>
        </Tooltip>
      )}

      <Tooltip title={refreshLabel}>
        <span>
          <IconButton aria-label={refreshLabel} onClick={onRefresh} disabled={refreshing} data-head-action="refresh">
            {refreshing ? <CircularProgress size={SPINNER_SIZE} /> : <Iconify name="refresh" />}
          </IconButton>
        </span>
      </Tooltip>
    </Stack>
  )

  return (
    <>
      <Stack direction="row" alignItems="center" data-list-head="title" sx={{ bgcolor: 'background.neutral', pr: 2.5 }}>
        <Tabs
          value={tabs?.value ?? 'all'}
          onChange={tabs === undefined ? undefined : (_event, value: string) => tabs.onChange(value)}
          aria-label={tabs === undefined ? undefined : title}
          sx={{ px: 2.5, flexShrink: 0 }}
        >
          {(tabs?.items ?? [{ value: 'all', label: title }]).map((item) => {
            const active = tabs === undefined || item.value === tabs.value
            const shown = active ? count : item.count
            return (
              <Tab
                key={item.value}
                value={item.value}
                label={
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <span>{item.label}</span>
                    {shown !== undefined && (
                      // Dimmed while a new count is on its way, like the rows under it.
                      <Box
                        component="span"
                        aria-busy={active && countLoading}
                        sx={{ display: 'inline-flex', opacity: active && refreshing && !countLoading ? 0.48 : 1 }}
                      >
                        <Label variant="soft" color="default">
                          {active && countLoading ? (
                            <CircularProgress
                              size={COUNT_SPINNER_SIZE}
                              color="inherit"
                              aria-label={tCommon('filters.counting')}
                            />
                          ) : (
                            formatCount(shown)
                          )}
                        </Label>
                      </Box>
                    )}
                  </Stack>
                }
              />
            )
          })}
        </Tabs>
        {!phone && actions}
      </Stack>

      <Divider />

      {phone ? (
        /*
          On a phone the boxes open in a sheet over the list, with the count they
          leave on its button. Unfolded inline, seven boxes (392px) pushed the
          list and its pager off the screen: the reader filtered without seeing
          a single result change. The sheet stays mounted, so what a box holds
          and what it was searching survive closing it.
        */
        <Box sx={{ px: 2.5, py: 2 }}>
          {/* `useFlexGap`: with margins, the row's own spacing outranks the actions'
              `ml: 'auto'` and they sat beside the button instead of at the right. */}
          <Stack direction="row" alignItems="center" spacing={1} useFlexGap>
            <Button
              variant="outlined"
              data-list-head="fold"
              startIcon={<Iconify name="filter" />}
              aria-expanded={unfolded}
              aria-haspopup="dialog"
              onClick={() => setUnfolded(true)}
            >
              {filtersLabel}
              {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </Button>
            {actions}
          </Stack>
          {applied.length > 0 && (
            // A 30px button reaches 7px above and below under a finger: 16px between rows keeps the targets apart.
            <Stack direction="row" flexWrap="wrap" useFlexGap columnGap={1} rowGap={2} sx={{ mt: 2, minWidth: 0 }}>
              {applied.map((filter) => (
                <Button
                  key={filter.key}
                  size="small"
                  variant="outlined"
                  color="inherit"
                  endIcon={<Iconify name="close" />}
                  aria-label={tCommon('filters.remove', { value: filter.label })}
                  onClick={filter.remove}
                  sx={{ minWidth: 0, maxWidth: '100%' }}
                >
                  <ClippedText text={filter.label} />
                </Button>
              ))}
            </Stack>
          )}
          <Drawer
            anchor="bottom"
            open={unfolded}
            onClose={() => setUnfolded(false)}
            ModalProps={{ keepMounted: true }}
            slotProps={{
              paper: {
                role: 'dialog',
                'aria-label': filtersLabel,
                sx: {
                  maxHeight: SHEET_MAX_HEIGHT,
                  borderRight: 0,
                  borderTopLeftRadius: (theme: Theme) => Number(theme.shape.borderRadius) * 2,
                  borderTopRightRadius: (theme: Theme) => Number(theme.shape.borderRadius) * 2,
                },
              },
            }}
          >
            <Stack direction="row" alignItems="center" sx={{ pl: 2.5, pr: 1, py: 1 }}>
              <Typography variant="h6" component="h2" sx={{ flexGrow: 1 }}>
                {filtersLabel}
              </Typography>
              <IconButton aria-label={tCommon('actions.close')} onClick={() => setUnfolded(false)}>
                <Iconify name="close" />
              </IconButton>
            </Stack>
            <Divider />
            <Box
              onFocus={raiseFocusedBox}
              sx={{
                flex: '1 1 auto',
                minHeight: 0,
                overflowY: 'auto',
                px: 2.5,
                py: 2,
                [`&:has(:is(${TYPED_FIELD}):focus)`]: { pb: FOCUS_ROOM },
              }}
            >
              {boxes}
            </Box>
            <Divider />
            <Stack direction="row" spacing={1.5} sx={{ px: 2.5, py: 1.5 }}>
              <Button
                variant="outlined"
                color="inherit"
                disabled={reset.disabled}
                onClick={handleReset}
                data-list-head="sheet-reset"
                sx={{ flexShrink: 0 }}
              >
                {reset.label}
              </Button>
              <Button
                variant="contained"
                fullWidth
                data-filter-result
                ref={resultRef}
                onClick={() => setUnfolded(false)}
                startIcon={refreshing ? <CircularProgress size={SPINNER_SIZE} color="inherit" /> : undefined}
              >
                {countLoading ? tCommon('filters.show_results_pending') : tCommon('filters.show_results', { total: formatCount(count) })}
              </Button>
            </Stack>
          </Drawer>
        </Box>
      ) : (
        <Box sx={{ px: 2.5, py: 2 }}>{boxes}</Box>
      )}

      <Divider />
    </>
  )
}

/**
 * What the boxes hold, read off the `ListFilters` the screen hands in as
 * `filters` - the one element that knows each box's caption, its option labels
 * and how to empty it, so the row can never name a filter the boxes do not hold.
 */
function appliedOf(filters: ReactNode): AppliedFilter[] {
  if (!isValidElement<ComponentProps<typeof ListFilters>>(filters) || filters.type !== ListFilters) return []
  const { fields, values, onChange } = filters.props
  return fields.flatMap((field) => {
    const value = values[field.name]
    if (value === undefined) return []
    if (typeof value === 'string') {
      const text = value.trim()
      return text === '' ? [] : [{ key: field.name, label: `${field.label}: ${text}`, remove: () => onChange(field.name, '') }]
    }
    return value.map((option) => ({
      key: `${field.name}=${option}`,
      label: `${field.label}: ${field.optionLabel?.(option) ?? option}`,
      remove: () => onChange(field.name, value.filter((kept) => kept !== option)),
    }))
  })
}
