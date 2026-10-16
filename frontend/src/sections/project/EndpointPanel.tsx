/**
 * One endpoint, created or edited — a panel inside the project dialog.
 *
 * The same form serves both: a new endpoint starts from defaults, an existing
 * one from what the server holds. The strip pins the verbs, because the body
 * template grows the panel past the dialog and a save at the bottom of it is a
 * save nobody scrolled to.
 *
 * The headers are key/value rows (`useFieldArray`); a row whose name is empty
 * is dropped on save rather than refused, so an added-and-forgotten row costs
 * nothing. The template tokens are listed under the body from `TEMPLATE_TOKENS`
 * — code, not locale text, because `{{…}}` inside a translation is i18next's
 * own interpolation syntax and would be eaten by it.
 */

import { useState } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { yupResolver } from '@hookform/resolvers/yup'
import * as yup from 'yup'
import {
  Alert,
  Box,
  Button,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material'
import PanelStrip from '@/components/detail/PanelStrip'
import FormProvider from '@/components/hook-form/FormProvider'
import RHFSwitch from '@/components/hook-form/RHFSwitch'
import RHFTextField from '@/components/hook-form/RHFTextField'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import { RECORD_SURFACE } from '@/config'
import { useToast } from '@/hooks/useToast'
import { applyServerError } from '@/lib/api/formErrors'
import { useCreateEndpoint, useUpdateEndpoint } from '@/lib/api/hooks/useEndpoint'
import { METHOD_COLORS } from '@/sections/project/methodColors'
import { prettyJson } from '@/sections/project/prettyJson'
import { MOCK_METHODS } from '@/types/endpoint'
import type { Endpoint, EndpointCreateRequest, MockMethod } from '@/types/endpoint'

/** Bounds mirror `EndpointCreateRequest` on the server. */
const PATH_MAX_LENGTH = 500

const DESCRIPTION_MAX_LENGTH = 512

const STATUS_MIN = 100

const STATUS_MAX = 599

const DELAY_MAX_MS = 30000

/** A `{name}` parameter segment — `matcher.py`'s own pattern. */
const PARAM_SEGMENT = /^\{[A-Za-z_][A-Za-z0-9_]*\}$/

/** The tokens `app/engine/templating.py` fills, each with the locale key that explains it. */
const TEMPLATE_TOKENS = [
  { token: '{{path.<name>}}', key: 'template.path' },
  { token: '{{query.<name>}}', key: 'template.query' },
  { token: '{{headers.<name>}}', key: 'template.headers' },
  { token: '{{body.<a.b.0>}}', key: 'template.body' },
  { token: '{{now}}', key: 'template.now' },
  { token: '{{uuid}}', key: 'template.uuid' },
] as const

interface HeaderRow {
  name: string
  value: string
}

interface EndpointFormValues {
  method: MockMethod
  path: string
  status_code: number
  delay_ms: number
  enabled: boolean
  description: string
  headers: HeaderRow[]
  body: string
}

const DEFAULT_VALUES: EndpointFormValues = {
  method: 'GET',
  path: '/',
  status_code: 200,
  delay_ms: 0,
  enabled: true,
  description: '',
  headers: [],
  body: '',
}

interface EndpointPanelProps {
  projectId: string
  /** `null` creates; an endpoint edits that one. */
  endpoint: Endpoint | null
  /** A created endpoint: the dialog turns the panel into that endpoint's own. */
  onCreated: (endpoint: Endpoint) => void
  /** An existing endpoint can be exercised from its own panel. */
  onTest: () => void
  onBack: () => void
}

export default function EndpointPanel({
  projectId,
  endpoint,
  onCreated,
  onTest,
  onBack,
}: EndpointPanelProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()
  const create = useCreateEndpoint(projectId)
  const update = useUpdateEndpoint(projectId)
  const pending = create.isPending || update.isPending
  // The "format" button's verdict: the body it was asked to indent is no JSON.
  const [formatFailed, setFormatFailed] = useState(false)

  const schema = yup.object({
    method: yup.mixed<MockMethod>().oneOf(MOCK_METHODS).required(tCommon('validation.required')),
    path: yup
      .string()
      .trim()
      .required(tCommon('validation.required'))
      .max(PATH_MAX_LENGTH, tCommon('validation.max_length', { count: PATH_MAX_LENGTH }))
      .test('pattern', t('validation.path_invalid'), (value) => pathIsValid(value ?? '')),
    status_code: yup
      .number()
      .typeError(t('validation.status_range'))
      .integer(t('validation.status_range'))
      .min(STATUS_MIN, t('validation.status_range'))
      .max(STATUS_MAX, t('validation.status_range'))
      .required(tCommon('validation.required')),
    delay_ms: yup
      .number()
      .typeError(t('validation.delay_range', { max: DELAY_MAX_MS }))
      .integer(t('validation.delay_range', { max: DELAY_MAX_MS }))
      .min(0, t('validation.delay_range', { max: DELAY_MAX_MS }))
      .max(DELAY_MAX_MS, t('validation.delay_range', { max: DELAY_MAX_MS }))
      .required(tCommon('validation.required')),
    enabled: yup.boolean().required(),
    description: yup
      .string()
      .defined()
      .max(DESCRIPTION_MAX_LENGTH, tCommon('validation.max_length', { count: DESCRIPTION_MAX_LENGTH })),
    headers: yup
      .array(yup.object({ name: yup.string().defined(), value: yup.string().defined() }))
      .required(),
    body: yup.string().defined(),
  })

  const methods = useForm<EndpointFormValues>({
    resolver: yupResolver(schema),
    defaultValues: endpoint === null ? DEFAULT_VALUES : toFormValues(endpoint),
  })
  const headerRows = useFieldArray({ control: methods.control, name: 'headers' })

  const formatBody = () => {
    const formatted = prettyJson(methods.getValues('body'))
    setFormatFailed(formatted === null)
    if (formatted !== null) methods.setValue('body', formatted, { shouldDirty: true })
  }

  const onSubmit = async (values: EndpointFormValues) => {
    const data = toRequest(values)
    try {
      if (endpoint === null) {
        const created = await create.mutateAsync(data)
        toast.success(tCommon('messages.created'))
        onCreated(created)
        return
      }
      await update.mutateAsync({ id: endpoint.id, data })
      // The saved values are the form's new baseline: nothing is unsaved now.
      methods.reset(values)
      toast.success(tCommon('messages.saved'))
    } catch (error) {
      applyServerError(error, {
        t: tCommon,
        setError: methods.setError,
        toastError: toast.error,
        // The project already answers this method on this path.
        fieldByCode: { conflict: 'path' },
      })
    }
  }

  return (
    <FormProvider methods={methods} onSubmit={methods.handleSubmit(onSubmit)}>
      <Stack spacing={2}>
        <PanelStrip
          onBack={onBack}
          actions={
            <>
              {endpoint !== null && (
                <Button size="small" color="inherit" startIcon={<Iconify name="run" />} onClick={onTest}>
                  {t('test.run')}
                </Button>
              )}
              <Button size="small" variant="contained" type="submit" disabled={pending}>
                {tCommon('actions.save')}
              </Button>
            </>
          }
        >
          {endpoint !== null && (
            <Label color={METHOD_COLORS[endpoint.method]}>{endpoint.method}</Label>
          )}
          <Typography variant="subtitle2" noWrap>
            {endpoint === null ? t('endpoint.create_title') : endpoint.path}
          </Typography>
        </PanelStrip>

        <Divider sx={{ borderStyle: 'dashed' }} />

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <RHFTextField
            name="method"
            label={t('endpoint.method')}
            select
            fullWidth={false}
            sx={{ minWidth: RECORD_SURFACE.CHOICE_FIELD_WIDTH }}
          >
            {MOCK_METHODS.map((method) => (
              <MenuItem key={method} value={method}>
                {method}
              </MenuItem>
            ))}
          </RHFTextField>
          <RHFTextField name="path" label={t('endpoint.path')} helperText={t('endpoint.path_helper')} />
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems="flex-start">
          <RHFTextField name="status_code" label={t('endpoint.status_code')} type="number" />
          <RHFTextField name="delay_ms" label={t('endpoint.delay_ms')} type="number" />
          <Box sx={{ flexShrink: 0, pt: 1 }}>
            <RHFSwitch name="enabled" label={tCommon('status.enabled')} />
          </Box>
        </Stack>

        <RHFTextField name="description" label={t('endpoint.description')} />

        <Stack spacing={1}>
          <Stack direction="row" alignItems="center">
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              {t('endpoint.headers')}
            </Typography>
            <Button
              size="small"
              startIcon={<Iconify name="add" />}
              onClick={() => headerRows.append({ name: '', value: '' })}
            >
              {t('endpoint.add_header')}
            </Button>
          </Stack>
          {headerRows.fields.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              {t('endpoint.no_headers')}
            </Typography>
          )}
          {headerRows.fields.map((row, index) => (
            <Stack key={row.id} direction="row" spacing={1} alignItems="center">
              <RHFTextField name={`headers.${index}.name`} label={t('endpoint.header_name')} size="small" />
              <RHFTextField name={`headers.${index}.value`} label={t('endpoint.header_value')} size="small" />
              <IconButton aria-label={tCommon('actions.delete')} onClick={() => headerRows.remove(index)}>
                <Iconify name="close" />
              </IconButton>
            </Stack>
          ))}
        </Stack>

        <Stack spacing={1}>
          <Stack direction="row" alignItems="center">
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
              {t('endpoint.body')}
            </Typography>
            <Button size="small" startIcon={<Iconify name="code" />} onClick={formatBody}>
              {t('endpoint.format_json')}
            </Button>
          </Stack>
          {/* inline-error-ok: the verdict of the format button, beside the body it judged */}
          {formatFailed && <Alert severity="warning">{t('endpoint.format_failed')}</Alert>}
          <RHFTextField
            name="body"
            multiline
            minRows={6}
            slotProps={{ htmlInput: { style: { fontFamily: 'monospace' }, 'aria-label': t('endpoint.body') } }}
          />
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              {t('template.title')}
            </Typography>
            {TEMPLATE_TOKENS.map(({ token, key }) => (
              <Stack key={token} direction="row" spacing={1.5} alignItems="baseline">
                <Typography variant="caption" sx={{ fontFamily: 'monospace', flexShrink: 0 }}>
                  {token}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t(key)}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Stack>
      </Stack>
    </FormProvider>
  )
}

/** What the server holds, as the form edits it: headers as rows, in their stored order. */
function toFormValues(endpoint: Endpoint): EndpointFormValues {
  return {
    method: endpoint.method,
    path: endpoint.path,
    status_code: endpoint.status_code,
    delay_ms: endpoint.delay_ms,
    enabled: endpoint.enabled,
    description: endpoint.description,
    headers: Object.entries(endpoint.headers).map(([name, value]) => ({ name, value })),
    body: endpoint.body,
  }
}

/** The form as the request: nameless header rows dropped, the rest keyed by name. */
function toRequest(values: EndpointFormValues): EndpointCreateRequest {
  const headers: Record<string, string> = {}
  for (const row of values.headers) {
    const name = row.name.trim()
    if (name !== '') headers[name] = row.value
  }
  return {
    method: values.method,
    path: values.path.trim(),
    status_code: values.status_code,
    delay_ms: values.delay_ms,
    enabled: values.enabled,
    description: values.description,
    headers,
    body: values.body,
  }
}

/**
 * `pattern_problem` in `app/engine/matcher.py`, judged before the request: a
 * braced segment must be exactly `{name}`, and no name may appear twice.
 */
function pathIsValid(path: string): boolean {
  const names = new Set<string>()
  for (const segment of path.split('/')) {
    if (!segment.includes('{') && !segment.includes('}')) continue
    if (!PARAM_SEGMENT.test(segment)) return false
    if (names.has(segment)) return false
    names.add(segment)
  }
  return true
}
