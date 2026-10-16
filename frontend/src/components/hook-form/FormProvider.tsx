/**
 * The form shell: react-hook-form context plus the `<form>` element.
 *
 * Every form in the app submits through `handleSubmit`, so validation runs
 * before the mutation and the Enter key behaves like the submit button.
 */

import { FormProvider as Form } from 'react-hook-form'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import type { ReactNode } from 'react'

interface FormProviderProps<T extends FieldValues> {
  children: ReactNode
  methods: UseFormReturn<T>
  onSubmit: () => void
}

export default function FormProvider<T extends FieldValues>({
  children,
  methods,
  onSubmit,
}: FormProviderProps<T>) {
  return (
    <Form {...methods}>
      <form onSubmit={onSubmit} noValidate>
        {children}
      </form>
    </Form>
  )
}
