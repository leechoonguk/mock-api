/**
 * One logged request — what a client sent and how the mock server answered.
 *
 * The log table leaves headers and the body out (`RequestLogReadResponse`);
 * this panel reads the detail for them. A row never changes once written, so
 * there is nothing to edit and the strip carries only the way back.
 */

import { CircularProgress, Divider, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import DetailField from '@/components/detail/DetailField'
import PanelStrip from '@/components/detail/PanelStrip'
import Label from '@/components/label/Label'
import { useMissingRecordCloses } from '@/hooks/useMissingRecordCloses'
import { useQueryErrorToast } from '@/hooks/useQueryErrorToast'
import { useLog } from '@/lib/api/hooks/useLog'
import BodyBlock from '@/sections/project/BodyBlock'
import HeadersTable from '@/sections/project/HeadersTable'
import { formatDateTime } from '@/utils/formatTime'

interface LogPanelProps {
  projectId: string
  logId: string
  onBack: () => void
}

export default function LogPanel({ projectId, logId, onBack }: LogPanelProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const query = useLog(projectId, logId)
  const log = query.data

  useQueryErrorToast(query, tCommon('messages.load_failed'))
  // Cleared while open: the row is gone, so the panel returns to the log.
  useMissingRecordCloses(query, onBack)

  return (
    <Stack spacing={2}>
      <PanelStrip onBack={onBack}>
        {log !== undefined && <Label color={log.matched ? 'success' : 'error'}>{log.method}</Label>}
        <Typography variant="subtitle2" noWrap>
          {log === undefined ? t('log.request_title') : log.path}
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
              <Label color={log.matched ? 'success' : 'error'}>
                {log.matched ? t('log.matched_yes') : t('log.matched_no')}
              </Label>
            </DetailField>
            <DetailField label={t('log.duration')}>
              {t('endpoint.delay_value', { ms: log.duration_ms })}
            </DetailField>
          </Stack>
          <DetailField label={t('log.query_string')}>
            {log.query_string === '' ? '—' : log.query_string}
          </DetailField>
          <HeadersTable
            title={t('log.request_headers')}
            headers={log.request_headers}
            empty={t('endpoint.no_headers')}
          />
          <BodyBlock title={t('log.request_body')} body={log.request_body} empty={t('test.empty_body')} />
        </>
      )}
    </Stack>
  )
}
