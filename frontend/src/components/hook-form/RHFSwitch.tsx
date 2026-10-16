/**
 * Boolean input bound to react-hook-form.
 *
 * A switch carries `checked`, not `value`, which is exactly the detail that
 * gets forgotten when a form binds one by hand and then submits `undefined`.
 */

import { Controller, useFormContext } from 'react-hook-form'
import { FormControlLabel, Switch } from '@mui/material'

interface RHFSwitchProps {
  name: string
  label: string
}

export default function RHFSwitch({ name, label }: RHFSwitchProps) {
  const { control } = useFormContext()

  return (
    <Controller
      name={name}
      control={control}
      render={({ field }) => (
        <FormControlLabel
          label={label}
          control={<Switch checked={field.value === true} onChange={field.onChange} />}
        />
      )}
    />
  )
}
