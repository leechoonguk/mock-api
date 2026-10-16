/**
 * One logged request — what a client sent through the proxy and how it was answered.
 *
 * The log table leaves headers and the body out (`RequestLogReadResponse`);
 * this panel reads the detail for them. A row never changes once written, so
 * there is nothing to edit and the strip carries only the way back. A recorded
 * row also shows the real server's answer and, when the server judged it
 * recordable, saves it as an endpoint — at the logged path or a generalized one.
 * An answer too large or not text for the log was stored whole as a file: the
 * panel says the shown body is a preview, and every answer downloads in full.
 */

import { useState } from 'react'
import { Alert, Button, CircularProgress, Divider, Stack, TextField, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import DetailField from '@/components/detail/DetailField'
import PanelStrip from '@/components/detail/PanelStrip'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import { useMissingRecordCloses } from '@/hooks/useMissingRecordCloses'
import { useQueryErrorToast } from '@/hooks/useQueryErrorToast'
import { useToast } from '@/hooks/useToast'
import { toApiError } from '@/lib/api/errors'
import { serverErrorMessage } from '@/lib/api/formErrors'
import { useRecordEndpoint } from '@/lib/api/hooks/useEndpoint'
import { useLog, useLogResponseBodyUrl } from '@/lib/api/hooks/useLog'
import BodyBlock from '@/sections/project/BodyBlock'
import { PATH_MAX_LENGTH, pathIsValid } from '@/sections/project/endpointPath'
import HeadersTable from '@/sections/project/HeadersTable'
import { OUTCOME_COLORS, OUTCOME_LABEL_KEYS, logOutcome } from '@/sections/project/logOutcome'
import type { Endpoint } from '@/types/endpoint'
import type { RequestLogDetail } from '@/types/log'
import { formatBytes } from '@/utils/formatNumber'
import { formatDateTime } from '@/utils/formatTime'

interface LogPanelProps {
  projectId: string
  logId: string
  onBack: () => void
  /** The endpoint saved from this row's recorded answer. */
  onRecorded: (endpoint: Endpoint) => void
}

export default function LogPanel({ projectId, logId, onBack, onRecorded }: LogPanelProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const query = useLog(projectId, logId)
  const responseBodyUrl = useLogResponseBodyUrl(projectId, logId)
  const log = query.data

  useQueryErrorToast(query, tCommon('messages.load_failed'))
  // Cleared while open: the row is gone, so the panel returns to the log.
  useMissingRecordCloses(query, onBack)

  return (
    <Stack spacing={2}>
      <PanelStrip onBack={onBack}>
        {log !== undefined && <Label color={OUTCOME_COLORS[logOutcome(log)]}>{log.method}</Label>}
        <Typography variant="subtitle2" noWrap>
          {log === undefined ? t('log.request_title') : `${log.host}${log.path}`}
        </Typography>
      </PanelStrip>

      <Divider sx={{ borderStyle: 'dashed' }} />

      {log === undefined ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : (
        <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3}>
            <DetailField label={t('log.created_at')}>{formatDateTime(log.created_at)}</DetailField>
            <DetailField label={t('log.status')}>{String(log.response_status)}</DetailField>
            <DetailField label={t('log.matched')}>
              <Label color={OUTCOME_COLORS[logOutcome(log)]}>{t(OUTCOME_LABEL_KEYS[logOutcome(log)])}</Label>
            </DetailField>
            <DetailField label={t('log.duration')}>
              {t('endpoint.delay_value', { ms: log.duration_ms })}
            </DetailField>
          </Stack>
          <DetailField label={t('log.origin')}>{`${log.scheme}://${log.host}`}</DetailField>
          <DetailField label={t('log.query_string')}>
            {log.query_string === '' ? '—' : log.query_string}
          </DetailField>
          <HeadersTable
            title={t('log.request_headers')}
            headers={log.request_headers}
            empty={t('endpoint.no_headers')}
          />
          <BodyBlock title={t('log.request_body')} body={log.request_body} empty={t('log.empty_body')} />
          {log.response_headers !== null && (
            <>
              <Divider sx={{ borderStyle: 'dashed' }} />
              <Stack direction="row" spacing={2} alignItems="center">
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
                  {t('log.server_response')}
                </Typography>
                <Button
                  size="small"
                  startIcon={<Iconify name="download" />}
                  href={responseBodyUrl}
                  download
                >
                  {t('log.response_download')}
                </Button>
              </Stack>
              {log.response_size !== null && (
                <DetailField label={t('log.response_size')}>{formatBytes(log.response_size)}</DetailField>
              )}
              {log.response_body_ref !== null && (
                <Alert severity="info">{t('log.response_stored')}</Alert>
              )}
              <HeadersTable
                title={t('log.response_headers')}
                headers={log.response_headers}
                empty={t('endpoint.no_headers')}
              />
              {log.response_body_ref !== null && (log.response_body ?? '').includes('\uFFFD') ? (
                <DetailField label={t('log.response_body')}>{t('log.response_binary')}</DetailField>
              ) : (
                <BodyBlock
                  title={t('log.response_body')}
                  body={log.response_body ?? ''}
                  empty={t('log.empty_body')}
                />
              )}
            </>
          )}
          {log.recordable && (
            <RecordForm key={log.id} projectId={projectId} log={log} onRecorded={onRecorded} />
          )}
          {log.proxied && !log.recordable && (
            <Typography variant="caption" color="text.secondary">
              {t('log.not_recordable')}
            </Typography>
          )}
        </>
      )}
    </Stack>
  )
}

interface RecordFormProps {
  projectId: string
  log: RequestLogDetail
  onRecorded: (endpoint: Endpoint) => void
}

/** The path to save the recorded answer at — the logged one until edited — and the save. */
function RecordForm({ projectId, log, onRecorded }: RecordFormProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()
  const record = useRecordEndpoint(projectId)
  const [draft, setDraft] = useState(log.path)
  const invalid = draft.length === 0 || draft.length > PATH_MAX_LENGTH || !pathIsValid(draft)

  const save = async () => {
    try {
      const endpoint = await record.mutateAsync({
        logId: log.id,
        data: { path: draft === log.path ? null : draft },
      })
      toast.success(t('log.record_saved'))
      onRecorded(endpoint)
    } catch (error) {
      // 409 `conflict`: the project already answers this method on this path.
      toast.error(serverErrorMessage(toApiError(error).code, tCommon))
    }
  }

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <TextField
          size="small"
          fullWidth
          label={t('log.record_path')}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          error={invalid}
          helperText={invalid ? t('validation.path_invalid') : t('log.record_path_helper')}
          sx={{ '& input': { fontFamily: 'monospace' } }}
        />
        <Button
          variant="contained"
          startIcon={<Iconify name="add" />}
          disabled={invalid || record.isPending}
          onClick={() => void save()}
          sx={{ flexShrink: 0 }}
        >
          {t('log.record')}
        </Button>
      </Stack>
      {/* The server saves the logged query and body as the endpoint's conditions. */}
      <Typography variant="caption" color="text.secondary">
        {t('log.record_conditions')}
      </Typography>
    </Stack>
  )
}
