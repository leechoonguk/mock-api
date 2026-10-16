/**
 * Everything a reader does once to put a browser behind the proxy, and the
 * one thing they come back for: the hosts it let through.
 *
 * Four cards, in the order the setup happens: whether the proxy listens and
 * where; the CA certificate and how Windows trusts it; how Windows (or one
 * browser) is pointed at the proxy; then the hosts that went through untouched
 * because no project intercepts them - each one a row that adds it to a
 * project. The status is polled while shown (`useProxyStatus`), so a host seen
 * a moment ago appears without a reload.
 *
 * A command a reader pastes is code, rendered from constants with a copy
 * button; the sentences around it come from the locale.
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Box, Button, CircularProgress, IconButton, Stack, TableCell, Tooltip, Typography } from '@mui/material'
import { Trans, useTranslation } from 'react-i18next'
import ClippedText from '@/components/clipped-text/ClippedText'
import DetailField from '@/components/detail/DetailField'
import DetailSection from '@/components/detail/DetailSection'
import PagedTableSection from '@/components/detail/PagedTableSection'
import type { TableColumn } from '@/components/detail/PagedTableSection'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import { useQueryErrorToast } from '@/hooks/useQueryErrorToast'
import { useTablePage } from '@/hooks/useTablePage'
import { useToast } from '@/hooks/useToast'
import { useProxyCaUrl, useProxyStatus } from '@/lib/api/hooks/useMock'
import AddHostDialog from '@/sections/project/proxy/AddHostDialog'
import { formatCount } from '@/utils/formatNumber'
import { formatDateTime } from '@/utils/formatTime'
import type { PassedHost, ProxyStatus } from '@/types/proxy'

/** What `GET /proxy/ca` names its download: Windows opens a `.crt` in its certificate installer. */
const CA_FILE = 'mock-api-ca.crt'

/** Trusts the CA for every user of the machine, from an administrator PowerShell. */
const CERTUTIL_COMMAND = `certutil -addstore -f Root ${CA_FILE}`

/** The `.wslconfig` lines that let Windows reach a port WSL2 listens on. */
const WSL_CONFIG = '[wsl2]\nlocalhostForwarding=true'

/** Percentages, beside the row's one action button. */
const PASSED_WIDTHS = ['50%', '18%', '32%'] as const

export default function ProxySetup() {
  const { t } = useTranslation('proxy')
  const { t: tCommon } = useTranslation('common')
  const query = useProxyStatus()
  const proxy = query.data

  useQueryErrorToast(query, tCommon('messages.load_failed'))

  if (proxy === undefined) {
    return (
      <Stack alignItems="center" sx={{ py: 6 }}>
        <CircularProgress aria-label={t('loading')} />
      </Stack>
    )
  }

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' } }}>
        <StatusCard proxy={proxy} />
        <CaCard ready={proxy.ca_ready} />
      </Box>
      <SettingsCard proxy={proxy} />
      <PassedHostsCard hosts={proxy.passed_hosts} />
    </Stack>
  )
}

/** Whether the proxy listens, at which address, and whether the server was told to run it. */
function StatusCard({ proxy }: { proxy: ProxyStatus }) {
  const { t } = useTranslation('proxy')
  const address = `${proxy.host}:${proxy.port}`

  return (
    <DetailSection name="server" title={t('status.title')}>
      <DetailField label={t('status.state')}>
        <Label color={proxy.listening ? 'success' : 'error'}>
          {proxy.listening ? t('status.listening') : t('status.not_listening')}
        </Label>
      </DetailField>
      <DetailField label={t('status.address')}>
        <CommandBlock code={address} />
      </DetailField>
      <DetailField label={t('status.enabled')}>
        {proxy.enabled ? t('status.enabled_yes') : t('status.enabled_no')}
      </DetailField>
    </DetailSection>
  )
}

/** The CA download, and the three ways Windows' browsers come to trust it. */
function CaCard({ ready }: { ready: boolean }) {
  const { t } = useTranslation('proxy')
  const caUrl = useProxyCaUrl()

  return (
    <DetailSection
      name="shield"
      title={t('ca.title')}
      subtitle={t('ca.subtitle')}
      action={
        <Button
          size="small"
          variant="contained"
          startIcon={<Iconify name="download" />}
          disabled={!ready}
          href={caUrl}
          download={CA_FILE}
        >
          {t('ca.download')}
        </Button>
      }
    >
      {!ready && (
        <Typography variant="body2" color="text.secondary">
          {t('ca.not_ready')}
        </Typography>
      )}
      <Steps>
        <li>
          <Trans t={t} i18nKey="ca.step_install" values={{ file: CA_FILE }} components={{ b: <strong /> }} />
        </li>
        <li>
          {t('ca.step_certutil')}
          <CommandBlock code={CERTUTIL_COMMAND} />
        </li>
        <li>{t('ca.step_firefox')}</li>
      </Steps>
    </DetailSection>
  )
}

/** Pointing Windows - or one browser - at the proxy, and the two things that surprise a reader. */
function SettingsCard({ proxy }: { proxy: ProxyStatus }) {
  const { t } = useTranslation('proxy')
  const address = `${proxy.host}:${proxy.port}`

  return (
    <DetailSection name="settings" title={t('settings.title')} subtitle={t('settings.subtitle')}>
      <Steps>
        <li>{t('settings.step_system', { host: proxy.host, port: String(proxy.port) })}</li>
        <li>
          {t('settings.step_wsl')}
          <CommandBlock code={WSL_CONFIG} />
        </li>
        <li>
          {t('settings.step_one_browser')}
          <CommandBlock code={`chrome.exe --proxy-server=${address}`} />
        </li>
      </Steps>
      <Typography variant="caption" color="text.secondary">
        {t('settings.http3_note')}
      </Typography>
    </DetailSection>
  )
}

/** The hosts no project intercepts, newest first, each one added to a project from its row. */
function PassedHostsCard({ hosts }: { hosts: PassedHost[] }) {
  const { t } = useTranslation('proxy')
  const paging = useTablePage(hosts)
  // The host being added; `null` while no dialog is open. The last one is kept
  // through the closing transition, so the dialog does not go blank as it fades.
  const [adding, setAdding] = useState<string | null>(null)
  const [lastAdding, setLastAdding] = useState('')

  const columns: TableColumn[] = [
    { key: 'host', width: PASSED_WIDTHS[0], label: t('passed.host') },
    { key: 'count', width: PASSED_WIDTHS[1], label: t('passed.count'), align: 'right' },
    { key: 'last_seen', width: PASSED_WIDTHS[2], label: t('passed.last_seen') },
  ]

  return (
    <>
      <PagedTableSection
        icon="link"
        title={t('passed.title')}
        subtitle={t('passed.subtitle')}
        empty={t('passed.empty')}
        columns={columns}
        paging={paging}
        rowKey={(passed) => passed.host}
        renderCells={(passed) => (
          <>
            <TableCell sx={{ fontFamily: 'monospace' }}>
              <ClippedText text={passed.host} />
            </TableCell>
            <TableCell align="right">
              <ClippedText text={formatCount(passed.count)} />
            </TableCell>
            <TableCell>
              <ClippedText text={formatDateTime(passed.last_seen)} />
            </TableCell>
          </>
        )}
        actions={(passed) => [
          {
            label: t('passed.add'),
            icon: 'add',
            tone: 'primary',
            onClick: () => {
              setAdding(passed.host)
              setLastAdding(passed.host)
            },
          },
        ]}
      />
      <AddHostDialog open={adding !== null} host={adding ?? lastAdding} onClose={() => setAdding(null)} />
    </>
  )
}

/** Numbered steps, spaced so a code block under one reads as that step's. */
function Steps({ children }: { children: ReactNode }) {
  return (
    <Box
      component="ol"
      sx={{ m: 0, pl: 2.5, typography: 'body2', '& > li + li': { mt: 1.5 }, '& > li > *': { mt: 0.75 } }}
    >
      {children}
    </Box>
  )
}

/** A line a reader pastes somewhere else, with the button that copies it. */
function CommandBlock({ code }: { code: string }) {
  const { t } = useTranslation('proxy')
  const toast = useToast()

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{ pl: 1.5, pr: 0.5, py: 0.5, bgcolor: 'action.hover', borderRadius: 1 }}
    >
      <Box
        component="pre"
        sx={{ m: 0, flexGrow: 1, minWidth: 0, typography: 'caption', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}
      >
        {code}
      </Box>
      <Tooltip title={t('copy')}>
        <IconButton
          size="small"
          aria-label={t('copy')}
          // Not a server call: the browser may refuse the clipboard (no secure
          // context, no permission), and the reader then copies by hand.
          onClick={() =>
            void navigator.clipboard.writeText(code).then(
              () => toast.success(t('copied')),
              () => toast.error(t('copy_failed')),
            )
          }
        >
          <Iconify name="copy" />
        </IconButton>
      </Tooltip>
    </Stack>
  )
}
