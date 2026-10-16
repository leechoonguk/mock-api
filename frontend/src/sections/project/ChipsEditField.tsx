/**
 * A project list shown as chips that read, turned into the chip editor
 * (`ChipsInput`) with save and cancel - the header's hosts and ignored fields.
 *
 * The whole list is saved at once. A name the server refuses as taken (a host
 * another project intercepts) is drawn red, and the field says why while it stays.
 */

import { useState } from 'react'
import { Chip, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import type { ApiError } from '@/lib/api/errors'
import ChipsInput from '@/sections/project/ChipsInput'
import type { ChipRules } from '@/sections/project/ChipsInput'

/** What one list reads as, and how it is edited. */
export interface ChipsEditText {
  /** The label before the chips that read. */
  label: string
  /** Shown in place of an empty list. */
  empty: string
  /** The edit button's tooltip. */
  edit: string
  /** The editor's own label, placeholder and help. */
  inputLabel: string
  placeholder: string
  helper: string
}

interface ChipsEditFieldProps {
  items: readonly string[]
  text: ChipsEditText
  rules: ChipRules
  /** Why the server would refuse the list, or `undefined` when it takes it. */
  problem: (items: readonly string[]) => string | undefined
  pending: boolean
  /** `null` once saved, which closes the editor; a refusal keeps the draft. */
  onSave: (items: string[]) => Promise<ApiError | null>
  /** The name a refusal says is taken, drawn red with `takenMessage`; `null` when it names none. */
  takenBy?: (refusal: ApiError) => string | null
  takenMessage?: string
}

export default function ChipsEditField({
  items,
  text,
  rules,
  problem,
  pending,
  onSave,
  takenBy,
  takenMessage,
}: ChipsEditFieldProps) {
  const { t: tCommon } = useTranslation('common')
  // `null` while reading; the chips while the list is being edited.
  const [draft, setDraft] = useState<string[] | null>(null)
  const [takenItem, setTakenItem] = useState<string | null>(null)
  const draftProblem = draft === null ? undefined : problem(draft)
  const taken = takenItem !== null && draft !== null && draft.includes(takenItem)
  const error = draftProblem ?? (taken ? takenMessage : undefined)

  const edit = (next: string[] | null) => {
    setDraft(next)
    setTakenItem(null)
  }

  const save = async () => {
    if (draft === null || draftProblem !== undefined) return
    const refusal = await onSave(draft)
    if (refusal === null) edit(null)
    else setTakenItem(takenBy?.(refusal) ?? null)
  }

  if (draft === null) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center" useFlexGap sx={{ minWidth: 0, flexWrap: 'wrap' }}>
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {text.empty}
          </Typography>
        ) : (
          <>
            <Label color="default">{text.label}</Label>
            {items.map((item) => (
              <Chip key={item} size="small" variant="outlined" label={item} sx={{ fontFamily: 'monospace' }} />
            ))}
          </>
        )}
        <Tooltip title={text.edit}>
          <IconButton size="small" aria-label={text.edit} onClick={() => edit([...items])}>
            <Iconify name="edit" />
          </IconButton>
        </Tooltip>
      </Stack>
    )
  }

  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <ChipsInput
        value={draft}
        onChange={setDraft}
        rules={rules}
        label={text.inputLabel}
        placeholder={text.placeholder}
        helperText={text.helper}
        error={error}
        takenItem={takenItem}
        autoFocus
      />
      <IconButton
        size="small"
        aria-label={tCommon('actions.save')}
        onClick={() => void save()}
        disabled={pending || draftProblem !== undefined}
      >
        <Iconify name="check" />
      </IconButton>
      <IconButton size="small" aria-label={tCommon('actions.cancel')} onClick={() => edit(null)}>
        <Iconify name="close" />
      </IconButton>
    </Stack>
  )
}
