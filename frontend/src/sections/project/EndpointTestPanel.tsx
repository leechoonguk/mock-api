/**
 * The endpoint console — sends one real request to the mock server and shows
 * what it answered. A panel inside the project dialog, not a dialog.
 *
 * It calls the mocked URL itself (the project's base URL plus a path), the same way any
 * client would, so the answer is the matcher's and the templating's, and the
 * call lands in the request log like every other. That also means it exercises
 * what is **saved**: an edit still open in the endpoint panel is not sent.
 *
 * The method starts at the endpoint's own (`GET` for `ANY`), the path at the
 * pattern with every `{param}` filled with `1`; both stay editable, because
 * trying a second id or a near-miss path is the point of a console.
 */

import { useState } from 'react'
import {
  Alert,
  Button,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import PanelStrip from '@/components/detail/PanelStrip'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import { RECORD_SURFACE } from '@/config'
import { useMockBaseUrl, useSendMock } from '@/lib/api/hooks/useMock'
import BodyBlock from '@/sections/project/BodyBlock'
import HeadersTable from '@/sections/project/HeadersTable'
import { METHOD_COLORS } from '@/sections/project/methodColors'
import { MOCK_METHODS } from '@/types/endpoint'
import type { RawResponse } from '@/types/api'
import type { Endpoint, MockMethod } from '@/types/endpoint'

/** Every method a request can carry: `ANY` is a pattern's, never a request's. */
const SEND_METHODS = MOCK_METHODS.filter((method) => method !== 'ANY')

/** Methods whose request carries no body: the body box is hidden for them. */
const BODYLESS: Partial<Record<MockMethod, true>> = { GET: true, HEAD: true }

/** What a `{param}` segment is filled with until the reader types another value. */
const SAMPLE_PARAM = '1'

/** The status classes, coloured as the request log colours a match. */
const STATUS_COLORS = { success: 'success', redirect: 'info', client: 'warning', server: 'error' } as const

/**
 * What one send ended as: the server answered (whatever the status), or the
 * request never reached it. One value, so a failed re-send cannot leave the
 * previous answer on screen beneath its error.
 */
type SendOutcome = { ok: true; response: RawResponse } | { ok: false }

interface HeaderRow {
  id: number
  name: string
  value: string
}

interface EndpointTestPanelProps {
  slug: string
  endpoint: Endpoint
  onBack: () => void
}

export default function EndpointTestPanel({ slug, endpoint, onBack }: EndpointTestPanelProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const send = useSendMock()
  const baseUrl = useMockBaseUrl(slug)
  const [method, setMethod] = useState<MockMethod>(endpoint.method === 'ANY' ? 'GET' : endpoint.method)
  const [path, setPath] = useState(() => samplePath(endpoint.path))
  const [headers, setHeaders] = useState<HeaderRow[]>([])
  const [body, setBody] = useState('')
  const [outcome, setOutcome] = useState<SendOutcome | null>(null)
  const withBody = BODYLESS[method] !== true

  const run = async () => {
    setOutcome(null)
    const sent: Record<string, string> = {}
    for (const row of headers) {
      if (row.name.trim() !== '') sent[row.name.trim()] = row.value
    }
    try {
      const response = await send.mutateAsync({
        slug,
        method,
        path,
        headers: sent,
        body: withBody ? body : '',
      })
      setOutcome({ ok: true, response })
    } catch {
      setOutcome({ ok: false })
    }
  }

  const editHeader = (id: number, change: Partial<HeaderRow>) =>
    setHeaders((rows) => rows.map((row) => (row.id === id ? { ...row, ...change } : row)))

  return (
    <Stack spacing={2}>
      <PanelStrip
        onBack={onBack}
        actions={
          <Button
            size="small"
            variant="contained"
            startIcon={<Iconify name="run" />}
            onClick={() => void run()}
            disabled={send.isPending || path.trim() === ''}
          >
            {t('test.send')}
          </Button>
        }
      >
        <Label color={METHOD_COLORS[endpoint.method]}>{endpoint.method}</Label>
        <Typography variant="body2" color="text.secondary" noWrap>
          {endpoint.path}
        </Typography>
      </PanelStrip>

      <Alert severity="info">{t('test.saved_only')}</Alert>
      {/* inline-error-ok: the console's own result - a request that never got an answer */}
      {outcome !== null && !outcome.ok && <Alert severity="error">{t('test.network_failed')}</Alert>}

      <Divider sx={{ borderStyle: 'dashed' }} />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <TextField
          select
          label={t('endpoint.method')}
          value={method}
          onChange={(event) => setMethod(event.target.value as MockMethod)}
          sx={{ minWidth: RECORD_SURFACE.CHOICE_FIELD_WIDTH }}
        >
          {SEND_METHODS.map((choice) => (
            <MenuItem key={choice} value={choice}>
              {choice}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={t('test.path')}
          value={path}
          onChange={(event) => setPath(event.target.value)}
          helperText={t('test.path_helper', { base: baseUrl })}
          fullWidth
        />
      </Stack>

      <Stack spacing={1}>
        <Stack direction="row" alignItems="center">
          <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>
            {t('test.request_headers')}
          </Typography>
          <Button
            size="small"
            startIcon={<Iconify name="add" />}
            onClick={() => setHeaders((rows) => [...rows, { id: nextRowId(rows), name: '', value: '' }])}
          >
            {t('endpoint.add_header')}
          </Button>
        </Stack>
        {headers.map((row) => (
          <Stack key={row.id} direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              label={t('endpoint.header_name')}
              value={row.name}
              onChange={(event) => editHeader(row.id, { name: event.target.value })}
              fullWidth
            />
            <TextField
              size="small"
              label={t('endpoint.header_value')}
              value={row.value}
              onChange={(event) => editHeader(row.id, { value: event.target.value })}
              fullWidth
            />
            <IconButton
              aria-label={tCommon('actions.delete')}
              onClick={() => setHeaders((rows) => rows.filter((other) => other.id !== row.id))}
            >
              <Iconify name="close" />
            </IconButton>
          </Stack>
        ))}
      </Stack>

      {withBody && (
        <TextField
          label={t('test.request_body')}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          multiline
          minRows={4}
          fullWidth
          slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
        />
      )}

      {outcome !== null && outcome.ok && (
        <Stack spacing={1.5}>
          <Divider sx={{ borderStyle: 'dashed' }} />
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Typography variant="subtitle2">{t('test.result')}</Typography>
            <Label color={STATUS_COLORS[statusClass(outcome.response.status)]}>
              {String(outcome.response.status)}
            </Label>
            <Typography variant="body2" color="text.secondary">
              {t('endpoint.delay_value', { ms: outcome.response.ms })}
            </Typography>
          </Stack>
          <HeadersTable
            title={t('test.response_headers')}
            headers={outcome.response.headers}
            empty={t('endpoint.no_headers')}
          />
          <BodyBlock title={t('test.response_body')} body={outcome.response.body} empty={t('test.empty_body')} />
        </Stack>
      )}
    </Stack>
  )
}

/** The pattern as a path a request can take: every `{param}` segment filled with a sample. */
function samplePath(pattern: string): string {
  return pattern
    .split('/')
    .map((segment) => (segment.startsWith('{') && segment.endsWith('}') ? SAMPLE_PARAM : segment))
    .join('/')
}

/** A status's class, which is all its colour says. */
function statusClass(status: number): keyof typeof STATUS_COLORS {
  if (status >= 500) return 'server'
  if (status >= 400) return 'client'
  if (status >= 300) return 'redirect'
  return 'success'
}

/** A header row's key: one past the largest, so a removed row's key is never reused while shown. */
function nextRowId(rows: HeaderRow[]): number {
  return rows.reduce((largest, row) => Math.max(largest, row.id), 0) + 1
}
