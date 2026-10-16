/**
 * One box per filterable column, and the control that clears them.
 *
 * A single keyword box over several columns cannot say which column it matched,
 * and a reader who wants "the account whose *email* contains probe" has to hope.
 * So each filterable column gets its own labelled box, named exactly as the
 * query parameter the router reads — the label says which column, the parameter
 * proves it.
 *
 * **Two kinds of box, and the column decides which.**
 *
 * | Kind | When | Renders | The router matches |
 * |---|---|---|---|
 * | text | free text: a code, a name, an alias list | a search field | contains (`ilike %v%`) |
 * | select | a closed vocabulary: a class, a status | a multi-select the reader can type into | any of the values (`.in_()`) |
 *
 * A field is a select the moment it carries `options`. The options are **the
 * ledger's distinct values, fetched** — never typed into the screen — because
 * the portal owns those vocabularies and the sync brings a new one the night it
 * appears; a list written here would offer yesterday's choices. So a screen with
 * select filters also reads a `facets` endpoint, and passes what it answers.
 *
 * **A select is typed into, not only scrolled.** The vocabularies are the
 * columns' own values and some are long - 85 상태 on the raw material list is
 * held whole, and a reader who knows the value they want should not hunt for it
 * in a list that height. So the box is an `Autocomplete`: typing narrows the
 * options by contains, and what it sends is still one of them, so the router's
 * whole-value match holds. A vocabulary past a few hundred values (2,849
 * 식품유형, 20,788 원재료) is searched on the server instead (`search`): the box
 * reports what is typed, the screen asks `facets?contains=` for the best 50.
 *
 * Cleared is "all": the empty list, which `useListFilters` omits from the query
 * like an empty text box, so the reset button needs no second rule; `allLabel`
 * is what the empty box says.
 *
 * The boxes are never disabled, not even while a page is in flight: the
 * fetch fires 500ms after the last keystroke, and a box that locks then cuts
 * the word the reader is still typing (measured: `밀가` sent, `루` dropped).
 * The race a locked box would prevent is closed by the query key instead -
 * a newer key supersedes the older request's answer.
 *
 * The head's reset (`ListCardHead`) is the last item of this grid's flow and is
 * disabled until something is filtered, so the row never offers to undo nothing.
 * It is an undo glyph in the plain colour: it gives back an empty row of boxes,
 * it deletes nothing, and the red trash it was read as a delete.
 *
 * **Every select is a multi-select** (rule://frontend-screens, Select filters):
 * the screen hands its `SELECT_FIELDS` to `useListFilters`, which keeps a list
 * for each. On a desktop the popup stays open, so several values are ticked in
 * one visit; closing keeps the typed query, and the clear button empties it.
 * On a phone, and in a searched box (식품유형, 원재료), a pick closes the list
 * and the query goes with it. The reset
 * empties every query with every value. Two values in one box match either -
 * the chip row says so.
 * Each row is a label and a `span`
 * the listbox ticks by CSS from the option's `aria-selected`, because a MUI
 * `Checkbox` per row froze 2,852 rows for 1,673ms to open. The box stays one
 * line - the first value and how many more - because a box that grew a row per
 * value would push the grid down as the reader ticks. The values themselves are
 * drawn as `Label` badges on the **chip row** under the boxes, grouped by the
 * box that holds them: a badge's close button removes that one value, and the
 * head's reset clears every box and every badge at once, so there is one "clear
 * all" and it is where it has always been. The row exists only while a select
 * holds something. At `FILTER_VALUES_MAX` the unticked options are disabled and
 * the group says why - the router refuses a longer list.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Autocomplete,
  Box,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material'
import ClippedText from '@/components/clipped-text/ClippedText'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import { FILTER_VALUES_MAX } from '@/config'
import { endsWithJamo } from '@/utils/hangul'
import type { ListFilterValue } from '@/hooks/useListFilters'

/** What a select holds before anything is ticked - one array, so no render allocates it. */
const NOTHING_TICKED: readonly string[] = []

/** The class of an option's tick box, drawn by `OPTION_LIST_SX` rather than per row. */
const CHECK_CLASS = 'list-filter-check'

/** A searched select's filter: the server already chose and ranked the options. */
const KEEP_ALL = <T,>(options: T[]) => options

/** A date bound's name (glossary: `_from` / `_to`) - typed as a day. */
const DATE_BOUND_FIELD = /_(from|to)$/

/** `yyyy-mm-dd`. */
const DATE_LENGTH = 10

/** A typed date's digits, as the hyphenated day the router takes: `20261001` -> `2026-10-01`. */
const maskDate = (typed: string) => {
  const digits = typed.replace(/\D/g, '').slice(0, 8)
  return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6)].filter(Boolean).join('-')
}

/** A number's name (`license_no`, `item_report_no`) - the phone opens its digit pad. */
const NUMBER_FIELD = /_no$/

/**
 * A multi-select's list, styled once for every row. The 식품유형 box lists all
 * 2,852 types, and a MUI `Checkbox` per row - a button, a ripple, an SVG and its
 * own styles - cost one 1,673ms task to open and 417-554ms per tick (measured
 * 2026-09-26). So a row is a `span` and a label: the tick is drawn here from the
 * option's own `aria-selected`, which MUI already sets, so nothing per row
 * renders or restyles when a value is ticked. `content-visibility` lets the
 * browser skip laying out the rows scrolled out of the 320px popup.
 */
const OPTION_LIST_SX: SxProps<Theme> = {
  '& .MuiAutocomplete-option': { contentVisibility: 'auto', containIntrinsicSize: 'auto 36px' },
  [`& .${CHECK_CLASS}`]: {
    position: 'relative',
    flexShrink: 0,
    width: 16,
    height: 16,
    mr: 1.5,
    borderRadius: 0.5,
    border: 2,
    borderColor: 'text.disabled',
  },
  [`& [aria-selected="true"] .${CHECK_CLASS}`]: {
    bgcolor: 'primary.main',
    borderColor: 'primary.main',
    '&::after': {
      content: '""',
      position: 'absolute',
      left: 3,
      top: 0,
      width: 6,
      height: 10,
      borderStyle: 'solid',
      borderColor: 'primary.contrastText',
      borderWidth: '0 2px 2px 0',
      transform: 'rotate(45deg)',
    },
  },
}

export interface ListFilterField {
  /** The query parameter, and the key into `values`. */
  name: string
  label: string
  /**
   * Present on a closed-vocabulary column: the values the box may take, as the
   * `facets` endpoint answered them. Absent on free text.
   */
  options?: readonly string[]
  /**
   * How an option reads. A facets value is the row's own text and reads as
   * itself; a *code* the schema closes (`food` / `livestock`) is not a word a
   * reader knows, so a field whose options are codes owes the translation here.
   * `check-frontend-screens` demands it wherever `options` is not a facets read.
   */
  optionLabel?: (value: string) => string
  /**
   * Present on a vocabulary too long to hold whole (원재료 20,788 names): the
   * box reports what is typed and the screen answers with the server's matches
   * as `options`. `loading` while that answer is in flight.
   */
  search?: { onQuery: (query: string) => void; loading: boolean }
}

interface ListFiltersProps {
  fields: readonly ListFilterField[]
  /** A string per box, a list per multi-select - the shape decides the box. */
  values: Record<string, ListFilterValue>
  onChange: (name: string, value: ListFilterValue) => void
  /** What an empty select says — required as soon as any field has `options`. */
  allLabel?: string
  /** MUI's own Autocomplete strings, in the reader's language. */
  noOptionsLabel?: string
  clearLabel?: string
  openLabel?: string
  closeLabel?: string
  /** Told when an IME starts and ends composing in a text box: nothing applies meanwhile. */
  onComposing?: (composing: boolean) => void
  /** What a searched select says before anything is typed, and while it searches. */
  typeToSearchLabel?: string
  searchingLabel?: string
}

export default function ListFilters({
  fields,
  values,
  onChange,
  allLabel,
  noOptionsLabel,
  clearLabel,
  openLabel,
  closeLabel,
  onComposing,
  typeToSearchLabel,
  searchingLabel,
}: ListFiltersProps) {
  const { t: tCommon } = useTranslation('common')
  /**
   * What is typed into each multi-select. MUI empties it on every pick, which
   * over 2,852 식품유형 sends the reader back to the top of the list to type `빵`
   * again for the second 빵 type. So a pick in a vocabulary listed whole keeps
   * the query on a desktop, and so does closing the popup; a searched box and a
   * phone empty it on a pick (see `onChange`).
   */
  const [queries, setQueries] = useState<Record<string, string>>({})
  const setQuery = (name: string, query: string) =>
    setQueries((previous) => ({ ...previous, [name]: query }))
  const phone = useMediaQuery((theme: Theme) => theme.breakpoints.down('sm'))

  /**
   * Every box emptied at once is the head's reset (or back to an unfiltered
   * entry): the typed queries go with the values, or the reset left `밀가루`
   * standing in a box that filtered nothing. This box's own queries are
   * adjusted during render, the way React derives state from a prop, so no
   * frame shows the old query. The server search each box reported is the
   * screen's state, and a render may not set another component's state
   * (measured: React's "Cannot update a component while rendering a different
   * component" on every reset after a searched pick), so that half is told in
   * an effect.
   */
  const allEmpty = fields.every((field) => {
    const value = values[field.name]
    return value === undefined || value.length === 0
  })
  const [wasEmpty, setWasEmpty] = useState(allEmpty)
  const [searchesCleared, setSearchesCleared] = useState(0)
  if (allEmpty !== wasEmpty) {
    setWasEmpty(allEmpty)
    if (allEmpty && Object.values(queries).some((query) => query !== '')) {
      setQueries({})
      setSearchesCleared((count) => count + 1)
    }
  }
  const latestFields = useRef(fields)
  useEffect(() => {
    latestFields.current = fields
  })
  useEffect(() => {
    if (searchesCleared === 0) return
    for (const field of latestFields.current) field.search?.onQuery('')
  }, [searchesCleared])

  const labelOf = (field: ListFilterField, option: string) =>
    field.optionLabel === undefined ? option : field.optionLabel(option)

  /** The selects holding something, in box order - what the chip row draws. */
  const picked = fields.flatMap((field) => {
    const value = values[field.name]
    return typeof value !== 'string' && value !== undefined && value.length > 0 ? [{ field, value }] : []
  })

  return (
    <>
      {fields.map((field) => {
        const value = values[field.name] ?? ''
        if (field.options === undefined) {
          // A date bound (`_from` / `_to`) is typed as the day the app prints
          // everywhere (`2026-10-01`), hyphens added as the digits come. The
          // native `type="date"` drew the browser's `mm/dd/yyyy` under a Korean
          // page, and no `lang` moves it (measured); `useListFilters` sends
          // nothing until the eighth digit lands, so a half date is no request.
          if (DATE_BOUND_FIELD.test(field.name)) {
            return (
              <TextField
                key={field.name}
                size="small"
                label={field.label}
                placeholder={tCommon('filters.date_placeholder')}
                value={value}
                onChange={(event) => onChange(field.name, maskDate(event.target.value))}
                fullWidth
                slotProps={{
                  inputLabel: { shrink: true },
                  htmlInput: { inputMode: 'numeric', maxLength: DATE_LENGTH },
                }}
              />
            )
          }
          return (
            <TextField
              key={field.name}
              size="small"
              label={field.label}
              value={value}
              onChange={(event) => onChange(field.name, event.target.value)}
              onCompositionStart={() => onComposing?.(true)}
              onCompositionEnd={() => onComposing?.(false)}
              fullWidth
              slotProps={{
                htmlInput: {
                  enterKeyHint: 'search',
                  ...(NUMBER_FIELD.test(field.name) ? { inputMode: 'numeric' } : {}),
                },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <Iconify name="search" />
                    </InputAdornment>
                  ),
                },
              }}
            />
          )
        }
        // A select holds a list; a screen that did not hand its SELECT_FIELDS to
        // useListFilters holds '' here, and the box reads it as nothing ticked.
        const ticked = typeof value === 'string' ? NOTHING_TICKED : value
        const full = ticked.length >= FILTER_VALUES_MAX
        const query = queries[field.name] ?? ''
        const search = field.search
        return (
          <Autocomplete
            key={field.name}
            multiple
            // A phone's list covers the screen: one pick closes it so the reader
            // sees what the pick did. A desktop keeps it open to tick several -
            // unless the box is searched, where the pick empties the query and the
            // list left open would only say "type to search".
            disableCloseOnSelect={!phone && search === undefined}
            autoHighlight
            size="small"
            fullWidth
            options={field.options}
            // A searched vocabulary is already narrowed by the server; narrowing
            // again here would hide a match the server ranked on a word's middle.
            filterOptions={search === undefined ? undefined : KEEP_ALL}
            loading={search?.loading}
            loadingText={searchingLabel}
            slotProps={{ listbox: { sx: OPTION_LIST_SX } }}
            value={[...ticked]}
            onChange={(_event, next, reason) => {
              onChange(field.name, next)
              // A searched box (식품유형, 원재료) and a phone empty the query on a
              // pick: left beside the value it read `밀가루 밀가루` and had to be
              // deleted before the next word. A vocabulary listed whole keeps it
              // on a desktop, for the next value of the same word.
              if (reason === 'selectOption' && (phone || search !== undefined)) {
                setQuery(field.name, '')
                search?.onQuery('')
              }
            }}
            inputValue={query}
            // A pick arrives as `selectOption` and a re-sync as `reset`; only what
            // the reader typed, or the clear button, moves the query. Closing the
            // popup keeps it: a tap outside threw away a typed word. Every
            // keystroke - mid-composition too - reaches the search, whose debounce
            // restarts on each: holding the query while an IME composed let `정`
            // rest long enough to be searched on its way to `정제`.
            onInputChange={(_event, next, reason) => {
              if (reason !== 'input' && reason !== 'clear') return
              setQuery(field.name, next)
              search?.onQuery(next)
            }}
            getOptionLabel={(option) => labelOf(field, option)}
            getOptionDisabled={(option) => full && !ticked.includes(option)}
            // MUI's own strings, or the listbox says "No options" inside a Korean screen.
            // Nothing is searched while the box is empty or ends on a bare jamo.
            noOptionsText={
              search !== undefined && (query === '' || endsWithJamo(query))
                ? typeToSearchLabel
                : noOptionsLabel
            }
            clearText={clearLabel}
            openText={openLabel}
            closeText={closeLabel}
            // One line whatever is ticked: the chips live on the row below. The
            // box is a grid item, so `minWidth: 0` keeps a long first value from
            // widening its column (measured: 646px at a 390px viewport).
            sx={{ minWidth: 0, '& .MuiAutocomplete-inputRoot': { flexWrap: 'nowrap' } }}
            renderOption={({ key, ...props }, option) => (
              <li key={key} {...props}>
                <span className={CHECK_CLASS} />
                {labelOf(field, option)}
              </li>
            )}
            renderValue={(selected) => (
              <Box sx={{ minWidth: 0, flex: '0 1 auto', pl: 0.5 }}>
                <ClippedText
                  text={
                    selected.length === 1
                      ? labelOf(field, selected[0])
                      : tCommon('filters.selected_more', {
                          first: labelOf(field, selected[0]),
                          rest: String(selected.length - 1),
                        })
                  }
                />
              </Box>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label={field.label}
                placeholder={ticked.length === 0 ? allLabel : undefined}
                // The composed syllable lands after the last input event on some
                // IMEs: report the box's final text once composition ends.
                onCompositionEnd={(event) => search?.onQuery((event.target as HTMLInputElement).value)}
              />
            )}
          />
        )
      })}

      {picked.length > 0 && (
        // `order: 2` keeps the chips after the head's reset (`order: 1`), the last item of the boxes' flow.
        // `minWidth: 0`: a grid item's floor is its min-content, and one long 식품유형
        // value otherwise widened the single phone column to 465px in a 358px card.
        <Stack direction="row" flexWrap="wrap" useFlexGap spacing={1} sx={{ gridColumn: '1 / -1', minWidth: 0, order: 2 }}>
          {picked.map(({ field, value }) => (
            <Stack
              key={field.name}
              direction="row"
              flexWrap="wrap"
              alignItems="center"
              useFlexGap
              spacing={1}
              sx={{ p: 1, minWidth: 0, maxWidth: '100%', borderRadius: 1, border: 1, borderStyle: 'dashed', borderColor: 'divider' }}
            >
              <Typography variant="subtitle2" component="span">
                {field.label}
              </Typography>
              {/* Values of one box are ORed by the router; said once two are ticked. */}
              {value.length > 1 && (
                <Typography variant="caption" color="text.secondary" component="span">
                  {tCommon('filters.any_of')}
                </Typography>
              )}
              {value.map((option) => (
                // The design's badge, not MUI's Chip (rule://frontend-design). The
                // wrapper lets the nowrap badge shrink to the row so a long value
                // clips - with its tooltip - instead of running off the card, and
                // gives back a line height: `Label`'s is 0, which collapses
                // `ClippedText`'s overflow-hidden block to nothing.
                <Box
                  key={option}
                  sx={{
                    display: 'flex',
                    minWidth: 0,
                    maxWidth: '100%',
                    '& > span': { minWidth: 0, maxWidth: '100%', pr: 0.25, lineHeight: 1.5 },
                  }}
                >
                  <Label>
                    <ClippedText text={labelOf(field, option)} />
                    <IconButton
                      size="small"
                      aria-label={tCommon('filters.remove', { value: labelOf(field, option) })}
                      onClick={() => onChange(field.name, value.filter((kept) => kept !== option))}
                      sx={{ p: 0.25, ml: 0.25 }}
                    >
                      <Iconify name="close" width={14} />
                    </IconButton>
                  </Label>
                </Box>
              ))}
              {value.length >= FILTER_VALUES_MAX && (
                <Typography variant="caption" color="text.secondary">
                  {tCommon('filters.limit_reached', { max: String(FILTER_VALUES_MAX) })}
                </Typography>
              )}
            </Stack>
          ))}
        </Stack>
      )}
    </>
  )
}
