/**
 * Project create dialog — names a project and fixes its slug.
 *
 * It creates and never edits: a row's name is edited in the row and its
 * description in the detail dialog, while the slug is the first segment of
 * every mocked URL and is chosen once. Until the reader types into the slug
 * field it follows the name (`Demo API` → `demo-api`), so the common case is
 * one field typed; a slug the server already holds comes back as `conflict`
 * and is shown on the slug field.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Dialog, DialogContent, Stack } from '@mui/material'
import FormProvider from '@/components/hook-form/FormProvider'
import FormDialogActions from '@/components/dialog/FormDialogActions'
import FormDialogHeader from '@/components/dialog/FormDialogHeader'
import RHFTextField from '@/components/hook-form/RHFTextField'
import { useCreateProject } from '@/lib/api/hooks/useProject'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useToast } from '@/hooks/useToast'
import { applyServerError } from '@/lib/api/formErrors'

/** Lengths mirror `ProjectCreateRequest` on the server. */
export const NAME_MAX_LENGTH = 120

export const SLUG_MAX_LENGTH = 64

export const DESCRIPTION_MAX_LENGTH = 512

/** The server's slug pattern: lowercase words joined by single hyphens. */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

interface ProjectFormValues {
  name: string
  slug: string
  description: string
}

const EMPTY_VALUES: ProjectFormValues = { name: '', slug: '', description: '' }

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
  // Set once the reader edits the slug themselves; from then on the name no longer writes it.
  const slugTouched = useRef(false)

  const schema = useMemo(
    () =>
      yup.object({
        name: yup
          .string()
          .trim()
          .required(tCommon('validation.required'))
          .max(NAME_MAX_LENGTH, tCommon('validation.max_length', { count: NAME_MAX_LENGTH })),
        slug: yup
          .string()
          .required(tCommon('validation.required'))
          .max(SLUG_MAX_LENGTH, tCommon('validation.max_length', { count: SLUG_MAX_LENGTH }))
          .matches(SLUG_PATTERN, t('validation.slug_invalid')),
        description: yup
          .string()
          .defined()
          .max(DESCRIPTION_MAX_LENGTH, tCommon('validation.max_length', { count: DESCRIPTION_MAX_LENGTH })),
      }),
    [t, tCommon],
  )

  const methods = useForm<ProjectFormValues>({
    resolver: yupResolver(schema),
    defaultValues: EMPTY_VALUES,
  })
  const { setValue, subscribe, formState } = methods

  // The caret starts in the first field once the dialog has entered (an
  // `autoFocus` lost to the dialog's own focus trap).
  const focusFirstField = () => methods.setFocus('name')

  // Esc and the backdrop ask before a typed form is lost; cancel and × do not.
  const guard = useDiscardGuard(formState.isDirty, onClose, open)

  useEffect(() => {
    if (!open) return
    slugTouched.current = false
    methods.reset(EMPTY_VALUES)
  }, [open, methods])

  /**
   * The slug follows the name until the reader types into the slug. A form
   * subscription rather than an `onChange` of either field: those belong to
   * the field binding, and replacing one dropped react-hook-form's own update.
   * A `change` on the slug is the reader's; a `setValue` carries no type.
   */
  useEffect(
    () =>
      subscribe({
        formState: { values: true },
        callback: ({ values, name, type }) => {
          if (name === 'slug' && type === 'change') slugTouched.current = true
          if (name !== 'name' || slugTouched.current) return
          setValue('slug', slugify(values.name), { shouldDirty: true })
        },
      }),
    [subscribe, setValue],
  )

  const onSubmit = async (values: ProjectFormValues) => {
    try {
      const project = await createMutation.mutateAsync({
        name: values.name.trim(),
        slug: values.slug,
        description: values.description,
      })
      toast.success(tCommon('messages.created'))
      onClose()
      onCreated(project.id)
    } catch (error) {
      applyServerError(error, {
        t: tCommon,
        setError: methods.setError,
        toastError: toast.error,
        // The one unique column a reader types is the slug.
        fieldByCode: { conflict: 'slug' },
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
            <RHFTextField name="slug" label={t('form.slug')} helperText={t('form.slug_helper')} />
            <RHFTextField name="description" label={t('form.description')} multiline minRows={2} />
          </Stack>
        </DialogContent>

        <FormDialogActions pending={createMutation.isPending} onCancel={onClose} guard={guard} />
      </FormProvider>
    </Dialog>
  )
}

/** A name as a slug: lowercase, every run of other characters one hyphen, none at the ends. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/, '')
}
