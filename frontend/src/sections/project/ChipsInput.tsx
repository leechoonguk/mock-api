/**
 * A list of short names, one chip each - a project's hosts, the fields it ignores.
 *
 * A name is typed and becomes a chip on Enter, a comma, a space or leaving the
 * box; a pasted list (`a.com, *.b.com`) becomes its chips at once. Each is
 * parsed and judged by the caller's `rules` before it is a chip: one the server
 * would refuse stays in the box with the reason under it, so a chip is always
 * a name the server takes.
 *
 * Controlled: the chips are the caller's (`value`), only the half-typed text
 * is held here. A name the server refused as taken is drawn red (`takenItem`),
 * beside the field's message.
 */

import { useState } from 'react'
import type { Ref } from 'react'
import { Autocomplete, Chip, TextField } from '@mui/material'

/** Nothing to pick from: every chip is typed. */
const NO_OPTIONS: string[] = []

/** The run of text after the last separator - the name still being typed. */
const TYPING_TAIL = /[^\s,]*$/

/** How one kind of name is read from the box and judged before it is a chip. */
export interface ChipRules {
  /** Every name typed into the box, as the server will store them: blanks and repeats dropped. */
  parse: (text: string) => string[]
  /** Why `item` cannot join `count` chips, or `undefined` when it can. */
  refusal: (item: string, count: number) => string | undefined
}

interface ChipsInputProps {
  value: readonly string[]
  onChange: (items: string[]) => void
  rules: ChipRules
  label: string
  placeholder?: string
  helperText?: string
  /** A refusal from outside the box: the form's schema, or the server's. */
  error?: string
  /** The name the server refused as another record's: its chip is drawn red. */
  takenItem?: string | null
  inputRef?: Ref<HTMLInputElement>
  onBlur?: () => void
  autoFocus?: boolean
  disabled?: boolean
}

export default function ChipsInput({
  value,
  onChange,
  rules,
  label,
  placeholder,
  helperText,
  error,
  takenItem = null,
  inputRef,
  onBlur,
  autoFocus = false,
  disabled = false,
}: ChipsInputProps) {
  const [text, setText] = useState('')
  // Why the text left in the box did not become a chip.
  const [refusal, setRefusal] = useState<string | undefined>(undefined)

  /** Chips for every acceptable name of `typed`; the refused ones go back in the box before `rest`. */
  const add = (typed: string[], rest: string) => {
    const next = [...value]
    const refused: string[] = []
    let reason: string | undefined
    for (const item of typed) {
      if (next.includes(item)) continue
      const problem = rules.refusal(item, next.length)
      if (problem === undefined) next.push(item)
      else {
        refused.push(item)
        reason ??= problem
      }
    }
    if (next.length !== value.length) onChange(next)
    setText([...refused, rest].filter((part) => part !== '').join(' '))
    setRefusal(reason)
  }

  const shown = refusal ?? error

  return (
    <Autocomplete
      multiple
      freeSolo
      fullWidth
      size="small"
      disabled={disabled}
      options={NO_OPTIONS}
      value={[...value]}
      inputValue={text}
      // MUI resets the text after a chip lands (`reset`); the text is this
      // component's, so only what the reader typed moves it.
      onInputChange={(_event, next, reason) => {
        if (reason !== 'input') return
        const tail = next.search(TYPING_TAIL)
        if (tail > 0) add(rules.parse(next.slice(0, tail)), next.slice(tail))
        else {
          setText(next)
          setRefusal(undefined)
        }
      }}
      onChange={(_event, next, reason) => {
        if (reason === 'createOption') {
          add(rules.parse(text), '')
          return
        }
        // Only removals are left: every chip was parsed as it landed.
        onChange(next)
        setRefusal(undefined)
      }}
      onBlur={() => {
        if (text.trim() !== '') add(rules.parse(text), '')
        onBlur?.()
      }}
      renderValue={(items, getItemProps) =>
        items.map((item, index) => {
          const { key, ...itemProps } = getItemProps({ index })
          return (
            <Chip
              key={key}
              {...itemProps}
              size="small"
              label={item}
              color={item === takenItem ? 'error' : 'default'}
              sx={{ fontFamily: 'monospace' }}
            />
          )
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder={value.length === 0 ? placeholder : undefined}
          inputRef={inputRef}
          autoFocus={autoFocus}
          error={shown !== undefined}
          helperText={shown ?? helperText}
        />
      )}
    />
  )
}
