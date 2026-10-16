/**
 * Text input bound to react-hook-form.
 *
 * The binding is the point: a raw `<TextField value onChange>` inside a form
 * keeps its own copy of the value, so the resolver validates one string and the
 * user sees another. `error`/`helperText` come from the field's own state, so a
 * validation message can never be attached to the wrong input.
 *
 * The field's `ref` goes to the **input** (`inputRef`), not the root: spread
 * as a prop it landed on the wrapping `div`, which cannot take focus, so an
 * invalid submit left the caret on the save button instead of the first field
 * it refused (react-hook-form's `shouldFocusError` calls that ref's `focus`).
 */

import { Controller, useFormContext } from 'react-hook-form'
import { TextField } from '@mui/material'
import type { TextFieldProps } from '@mui/material'

type RHFTextFieldProps = Omit<TextFieldProps, 'name'> & { name: string }

export default function RHFTextField({ name, helperText, ...other }: RHFTextFieldProps) {
  const { control } = useFormContext()

  return (
    <Controller
      name={name}
      control={control}
      render={({ field: { ref, ...field }, fieldState: { error } }) => (
        <TextField
          {...field}
          inputRef={ref}
          value={field.value ?? ''}
          fullWidth
          error={error !== undefined}
          helperText={error?.message ?? helperText}
          {...other}
        />
      )}
    />
  )
}
