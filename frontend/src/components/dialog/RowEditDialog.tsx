/**
 * A phone's way to edit a grid row: the row's editable columns as a form.
 *
 * A phone reads a list as cards, and the grid's row editor needs the grid. It
 * used to swap the cards for the desktop grid the moment a row opened -
 * measured at 390: 783px of grid in 358, the save and cancel buttons a 425px
 * horizontal scroll away, the cards gone. The form is the same edit: the
 * screen's own `processRowUpdate` saves it (its refusal, its toast, its create
 * for a draft), and cancelling is the grid's cancel (`ignoreModifications`), so
 * a draft is dropped exactly as Escape drops it on a desktop.
 *
 * A field is drawn from its column: `boolean` as a switch, `singleSelect` from
 * its `valueOptions`, `number` as a number box, and a secret (`password`,
 * `*_token`) masked - the cell editors a screen writes cannot be reused
 * outside the grid, so the column's declared type is the contract.
 *
 * Its closes are a create form's (`useDiscardGuard`): Escape, the backdrop and
 * a phone's back ask before an edited row is dropped. Measured before: back
 * with the editor open left the user list for the screen before it.
 */

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
} from '@mui/material'
import type { GridColDef, GridValidRowModel } from '@mui/x-data-grid'
import { useTranslation } from 'react-i18next'
import FormDialogActions from '@/components/dialog/FormDialogActions'
import FormDialogHeader from '@/components/dialog/FormDialogHeader'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'

/** The form's id, for the save button that stands outside it. */
const FORM_ID = 'row-edit-form'

/** Fields whose value is never shown as typed. */
const SECRET_FIELD = /(^password$|_token$|secret)/

interface RowEditDialogProps<R extends GridValidRowModel> {
  row: R
  /** The grid's columns; only the editable ones become fields. */
  columns: GridColDef<R>[]
  /** The screen's own save - it refuses, toasts and throws to keep the form open. */
  onSave: (updated: R, original: R) => Promise<unknown>
  onCancel: () => void
}

export default function RowEditDialog<R extends GridValidRowModel>({
  row,
  columns,
  onSave,
  onCancel,
}: RowEditDialogProps<R>) {
  const { t } = useTranslation('common')
  const editable = columns.filter((column) => column.editable === true)
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(editable.map((column) => [column.field, row[column.field] as unknown])),
  )
  const [saving, setSaving] = useState(false)
  const isNew = 'isNew' in row && row.isNew === true
  const dirty = editable.some((column) => values[column.field] !== row[column.field])
  // Drawn only while its row edits, so it is open for as long as it exists.
  const guard = useDiscardGuard(dirty, onCancel, true)

  const set = (field: string, value: unknown) => setValues((previous) => ({ ...previous, [field]: value }))

  const save = async () => {
    setSaving(true)
    try {
      await onSave({ ...row, ...values }, row)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={guard.request} fullWidth>
      <FormDialogHeader
        name={isNew ? 'add' : 'edit'}
        title={isNew ? t('actions.add') : t('actions.edit')}
        onClose={onCancel}
      />
      <DialogContent sx={{ p: 2 }}>
        <Stack
          component="form"
          id={FORM_ID}
          spacing={2}
          sx={{ pt: 1 }}
          onSubmit={(event) => {
            event.preventDefault()
            void save()
          }}
        >
          {editable.map((column, index) => {
            const label = column.headerName ?? column.field
            const value = values[column.field]
            if (column.type === 'boolean') {
              return (
                <FormControlLabel
                  key={column.field}
                  label={label}
                  control={
                    <Switch
                      checked={value === true}
                      onChange={(event) => set(column.field, event.target.checked)}
                    />
                  }
                />
              )
            }
            const options = column.type === 'singleSelect' ? optionsOf(column) : []
            return (
              <TextField
                key={column.field}
                label={label}
                autoFocus={index === 0}
                select={options.length > 0}
                type={
                  column.type === 'number' ? 'number' : SECRET_FIELD.test(column.field) ? 'password' : 'text'
                }
                value={value === null || value === undefined ? '' : String(value)}
                onChange={(event) =>
                  set(
                    column.field,
                    column.type === 'number' && event.target.value !== ''
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
                fullWidth
              >
                {options.map((option) => (
                  <MenuItem key={String(option)} value={String(option)}>
                    {labelOf(column, option)}
                  </MenuItem>
                ))}
              </TextField>
            )
          })}
        </Stack>
      </DialogContent>
      <FormDialogActions pending={saving} onCancel={onCancel} guard={guard} form={FORM_ID} />
    </Dialog>
  )
}

/** A column's `valueOptions` as plain values, when it declares a list. */
function optionsOf<R extends GridValidRowModel>(column: GridColDef<R>): unknown[] {
  const options = 'valueOptions' in column ? column.valueOptions : undefined
  return Array.isArray(options) ? options : []
}

/** What an option reads as: the column's `getOptionLabel`, else the value itself. */
function labelOf<R extends GridValidRowModel>(column: GridColDef<R>, option: unknown): string {
  const label = 'getOptionLabel' in column ? column.getOptionLabel : undefined
  return typeof label === 'function' ? String(label(option as never)) : String(option)
}
