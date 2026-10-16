/**
 * Project create dialog — names a project, the hosts it intercepts and the
 * fields it ignores when comparing requests.
 *
 * It creates and never edits: a row's name is edited in the row, and the rest
 * in the detail dialog. The hosts and the fields are chips (`ChipsInput`):
 * typed one by one or pasted as a list, each judged before it lands; a host
 * another project already intercepts comes back as `host_taken`, shown on the
 * hosts field with its chip drawn red.
 */

import { useEffect, useMemo, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Dialog, DialogContent, Stack } from '@mui/material'
import FormProvider from '@/components/hook-form/FormProvider'
import FormDialogActions from '@/components/dialog/FormDialogActions'
import FormDialogHeader from '@/components/dialog/FormDialogHeader'
import RHFTextField from '@/components/hook-form/RHFTextField'
import ChipsInput from '@/sections/project/ChipsInput'
import { fieldChipRules, fieldsProblem } from '@/sections/project/fieldPattern'
import { hostChipRules, hostsProblem } from '@/sections/project/hostPattern'
import { useCreateProject } from '@/lib/api/hooks/useProject'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useToast } from '@/hooks/useToast'
import { applyServerError } from '@/lib/api/formErrors'
import { toApiError } from '@/lib/api/errors'

/** Lengths mirror `ProjectCreateRequest` on the server. */
export const NAME_MAX_LENGTH = 120

export const DESCRIPTION_MAX_LENGTH = 512

interface ProjectFormValues {
  name: string
  description: string
  /** Normalized and judged as they became chips. */
  hosts: string[]
  /** Judged as they became chips; often left empty until the log suggests some. */
  ignored_fields: string[]
}

const EMPTY_VALUES: ProjectFormValues = { name: '', description: '', hosts: [], ignored_fields: [] }

interface ProjectFormDialogProps {
  open: boolean
  onClose: () => void
  /** The created project, so the list can open it at once. */
  onCreated: (id: string) => void
}

export default function ProjectFormDialog({ open, onClose, onCreated }: ProjectFormDialogProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()
  const createMutation = useCreateProject()
  // The host the server last refused as another project's: drawn red among the
  // chips while the field still carries that refusal (a reset clears it).
  const [takenHost, setTakenHost] = useState<string | null>(null)

  const schema = useMemo(
    () =>
      yup.object({
        name: yup
          .string()
          .trim()
          .required(tCommon('validation.required'))
          .max(NAME_MAX_LENGTH, tCommon('validation.max_length', { count: NAME_MAX_LENGTH })),
        description: yup
          .string()
          .defined()
          .max(DESCRIPTION_MAX_LENGTH, tCommon('validation.max_length', { count: DESCRIPTION_MAX_LENGTH })),
        hosts: yup
          .array()
          .of(yup.string().defined())
          .defined()
          .test('hosts', (value, context) => {
            const problem = hostsProblem(value, t)
            return problem === undefined || context.createError({ message: problem })
          }),
        ignored_fields: yup
          .array()
          .of(yup.string().defined())
          .defined()
          .test('ignored_fields', (value, context) => {
            const problem = fieldsProblem(value, t)
            return problem === undefined || context.createError({ message: problem })
          }),
      }),
    [t, tCommon],
  )

  const methods = useForm<ProjectFormValues>({
    resolver: yupResolver(schema),
    defaultValues: EMPTY_VALUES,
  })
  const { formState } = methods

  // The caret starts in the first field once the dialog has entered (an
  // `autoFocus` lost to the dialog's own focus trap).
  const focusFirstField = () => methods.setFocus('name')

  // Esc and the backdrop ask before a typed form is lost; cancel and × do not.
  const guard = useDiscardGuard(formState.isDirty, onClose, open)

  useEffect(() => {
    if (!open) return
    methods.reset(EMPTY_VALUES)
  }, [open, methods])

  const onSubmit = async (values: ProjectFormValues) => {
    try {
      const project = await createMutation.mutateAsync({
        name: values.name.trim(),
        description: values.description,
        hosts: values.hosts,
        ignored_fields: values.ignored_fields,
      })
      toast.success(tCommon('messages.created'))
      onClose()
      onCreated(project.id)
    } catch (error) {
      setTakenHost(toApiError(error).host)
      applyServerError(error, {
        t: tCommon,
        setError: methods.setError,
        toastError: toast.error,
        // The one unique value a reader types is a host.
        fieldByCode: { host_taken: 'hosts' },
      })
    }
  }

  return (
    <Dialog
      open={open}
      onClose={guard.request}
      fullWidth
      maxWidth="sm"
      slotProps={{ transition: { onEntered: focusFirstField } }}
    >
      <FormProvider methods={methods} onSubmit={methods.handleSubmit(onSubmit)}>
        <FormDialogHeader name="add" title={t('create_title')} onClose={onClose} />

        <DialogContent sx={{ p: 2 }}>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <RHFTextField name="name" label={t('form.name')} />
            <Controller
              name="hosts"
              control={methods.control}
              render={({ field: { ref, value, onChange, onBlur } }) => (
                <ChipsInput
                  value={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  rules={hostChipRules(t)}
                  inputRef={ref}
                  label={t('form.hosts')}
                  placeholder={t('form.hosts_placeholder')}
                  helperText={t('form.hosts_helper')}
                  error={formState.errors.hosts?.message}
                  takenItem={formState.errors.hosts?.type === 'server' ? takenHost : null}
                />
              )}
            />
            <Controller
              name="ignored_fields"
              control={methods.control}
              render={({ field: { ref, value, onChange, onBlur } }) => (
                <ChipsInput
                  value={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  rules={fieldChipRules(t)}
                  inputRef={ref}
                  label={t('form.ignored_fields')}
                  placeholder={t('form.ignored_fields_placeholder')}
                  helperText={t('form.ignored_fields_helper')}
                  error={formState.errors.ignored_fields?.message}
                />
              )}
            />
            <RHFTextField name="description" label={t('form.description')} multiline minRows={2} />
          </Stack>
        </DialogContent>

        <FormDialogActions pending={createMutation.isPending} onCancel={onClose} guard={guard} />
      </FormProvider>
    </Dialog>
  )
}
