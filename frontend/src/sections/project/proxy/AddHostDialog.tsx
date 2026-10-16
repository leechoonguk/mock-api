/**
 * Puts one passed-through host into a project's hosts, so the proxy intercepts
 * it from the next connection on.
 *
 * The reader picks an existing project and, with "every subdomain", adds the
 * parent's wildcard instead (`i.ytimg.com` → `*.ytimg.com`) - a site spreads
 * over numbered hosts, and one pattern catches the ones not seen yet. The
 * project's whole list is sent with the host appended (`PATCH hosts`); a host
 * another project already intercepts comes back `host_taken` and is toasted.
 */

import { useEffect, useMemo } from 'react'
import { Controller, useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import { Autocomplete, Dialog, DialogContent, Stack, TextField, Typography } from '@mui/material'
import FormDialogActions from '@/components/dialog/FormDialogActions'
import FormDialogHeader from '@/components/dialog/FormDialogHeader'
import FormProvider from '@/components/hook-form/FormProvider'
import RHFSwitch from '@/components/hook-form/RHFSwitch'
import { PAGE_SIZE_OPTIONS } from '@/config'
import { useDiscardGuard } from '@/hooks/useDiscardGuard'
import { useQueryErrorToast } from '@/hooks/useQueryErrorToast'
import { useToast } from '@/hooks/useToast'
import { toApiError } from '@/lib/api/errors'
import { serverErrorMessage } from '@/lib/api/formErrors'
import { useProjectList, useUpdateProject } from '@/lib/api/hooks/useProject'
import { HOSTS_MAX } from '@/sections/project/hostPattern'
import type { Project, ProjectListParams } from '@/types/project'

/** Every project a local tool holds, by name: one page at the router's cap. */
const PROJECT_PARAMS: ProjectListParams = {
  offset: 0,
  limit: Math.max(...PAGE_SIZE_OPTIONS),
  sort: 'name',
  order: 'asc',
}

/** An address rather than a name: it has no parent domain to widen to. */
const IP_ADDRESS = /^(\d+\.){3}\d+$|:/

interface AddHostValues {
  projectId: string
  subdomains: boolean
}

const EMPTY_VALUES: AddHostValues = { projectId: '', subdomains: false }

interface AddHostDialogProps {
  open: boolean
  /** The passed-through host being added. */
  host: string
  onClose: () => void
}

export default function AddHostDialog({ open, host, onClose }: AddHostDialogProps) {
  const { t } = useTranslation('proxy')
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()
  const projects = useProjectList(PROJECT_PARAMS)
  const update = useUpdateProject()

  useQueryErrorToast(projects, tCommon('messages.load_failed'))

  const schema = useMemo(
    () =>
      yup.object({
        projectId: yup.string().required(tCommon('validation.required')),
        subdomains: yup.boolean().defined(),
      }),
    [tCommon],
  )

  const methods = useForm<AddHostValues>({ resolver: yupResolver(schema), defaultValues: EMPTY_VALUES })
  const guard = useDiscardGuard(methods.formState.isDirty, onClose, open)

  useEffect(() => {
    if (!open) return
    methods.reset(EMPTY_VALUES)
  }, [open, methods])

  const widenable = !IP_ADDRESS.test(host)
  const subdomains = useWatch({ control: methods.control, name: 'subdomains' })
  const pattern = subdomains && widenable ? wildcardOf(host) : host
  const options = projects.data?.items ?? []

  const onSubmit = async (values: AddHostValues) => {
    const project = options.find((option) => option.id === values.projectId)
    if (project === undefined) return
    if (project.hosts.includes(pattern)) {
      toast.error(t('add.already', { host: pattern, project: project.name }))
      return
    }
    if (project.hosts.length >= HOSTS_MAX) {
      toast.error(t('add.full', { max: String(HOSTS_MAX) }))
      return
    }
    try {
      await update.mutateAsync({ id: project.id, data: { hosts: [...project.hosts, pattern] } })
      toast.success(t('add.added', { host: pattern, project: project.name }))
      onClose()
    } catch (error) {
      toast.error(serverErrorMessage(toApiError(error).code, tCommon))
    }
  }

  return (
    <Dialog open={open} onClose={guard.request} fullWidth maxWidth="xs">
      <FormProvider methods={methods} onSubmit={methods.handleSubmit(onSubmit)}>
        <FormDialogHeader name="add" title={t('add.title')} caption={host} onClose={onClose} />

        <DialogContent sx={{ p: 2 }}>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Controller
              name="projectId"
              control={methods.control}
              render={({ field: { ref, value, onChange, onBlur } }) => (
                <Autocomplete<Project>
                  size="small"
                  fullWidth
                  options={options}
                  loading={projects.isFetching}
                  value={options.find((option) => option.id === value) ?? null}
                  onChange={(_event, next) => onChange(next?.id ?? '')}
                  onBlur={onBlur}
                  getOptionLabel={(option) => option.name}
                  isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
                  noOptionsText={t('add.no_projects')}
                  clearText={tCommon('filters.clear')}
                  openText={tCommon('filters.open')}
                  closeText={tCommon('filters.close')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={t('add.project')}
                      inputRef={ref}
                      error={methods.formState.errors.projectId !== undefined}
                      helperText={methods.formState.errors.projectId?.message}
                    />
                  )}
                />
              )}
            />
            {widenable && <RHFSwitch name="subdomains" label={t('add.subdomains')} />}
            <Typography variant="body2" color="text.secondary">
              {t('add.preview')}{' '}
              <Typography component="span" variant="body2" color="text.primary" sx={{ fontFamily: 'monospace' }}>
                {pattern}
              </Typography>
            </Typography>
          </Stack>
        </DialogContent>

        <FormDialogActions
          pending={update.isPending}
          onCancel={onClose}
          guard={guard}
          submitLabel={tCommon('actions.add')}
        />
      </FormProvider>
    </Dialog>
  )
}

/** The pattern that names every subdomain of `host`'s parent: `a.b.com` → `*.b.com`, `b.com` → `*.b.com`. */
function wildcardOf(host: string): string {
  const labels = host.split('.')
  return `*.${labels.length > 2 ? labels.slice(1).join('.') : host}`
}
