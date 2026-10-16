/**
 * One project, read and worked on inside one dialog (`?detail=<id>`).
 *
 * The stack is project dialog → panel, never project dialog → second modal: a
 * confirm dialog on top of this one hides the record it is asking about. So a
 * panel *replaces* the body while the project header stays on screen — the
 * endpoint editor, a logged request, and the two delete confirmations — and
 * "back" is a button in the panel's pinned strip.
 *
 * The header carries what a project intercepts and how: its hosts, the fields
 * it ignores when comparing requests (with the ones its log suggests) and its
 * description, edited in place, and the mode — `mock` answers from the
 * endpoints, `record` lets the real server answer and logs the exchange, so the
 * logs tab can save the ones worth replaying. Under them sits where a client
 * points its proxy, and the CA certificate it must trust.
 *
 * The dialog owns the endpoint table's query and paging: opening an endpoint
 * unmounts the tab, and a page held there would return the reader to page 1.
 */

import { useState } from 'react'
import {
  Box,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Link,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material'
import { useTranslation } from 'react-i18next'
import RecordDeletePanel from '@/components/detail/RecordDeletePanel'
import Iconify from '@/components/iconify/Iconify'
import type { ActionIcon } from '@/components/iconify/icons'
import Label from '@/components/label/Label'
import { RECORD_SURFACE } from '@/config'
import { useMissingRecordCloses } from '@/hooks/useMissingRecordCloses'
import { useQueryErrorToast } from '@/hooks/useQueryErrorToast'
import { useServerTablePage } from '@/hooks/useServerTablePage'
import { useToast } from '@/hooks/useToast'
import { useUrlTab } from '@/hooks/useUrlTab'
import { toApiError } from '@/lib/api/errors'
import type { ApiError } from '@/lib/api/errors'
import { serverErrorMessage } from '@/lib/api/formErrors'
import { useDeleteEndpoint, useEndpoint, useEndpointList, useUpdateEndpoint } from '@/lib/api/hooks/useEndpoint'
import { useDeleteLog } from '@/lib/api/hooks/useLog'
import { useProxyCaUrl, useProxyStatus } from '@/lib/api/hooks/useMock'
import { useProject, useUpdateProject } from '@/lib/api/hooks/useProject'
import EndpointPanel from '@/sections/project/EndpointPanel'
import LogPanel from '@/sections/project/LogPanel'
import { DESCRIPTION_MAX_LENGTH } from '@/sections/project/ProjectFormDialog'
import ChipsEditField from '@/sections/project/ChipsEditField'
import IgnoredFieldSuggestions from '@/sections/project/IgnoredFieldSuggestions'
import { fieldChipRules, fieldsProblem } from '@/sections/project/fieldPattern'
import { hostChipRules, hostsProblem } from '@/sections/project/hostPattern'
import ProjectEndpointsTab from '@/sections/project/detail/ProjectEndpointsTab'
import ProjectLogsTab from '@/sections/project/detail/ProjectLogsTab'
import { NO_LOG_FILTERS, NO_LOG_SELECTION } from '@/sections/project/detail/ProjectLogsTab'
import type { LogFilterValues } from '@/sections/project/detail/ProjectLogsTab'
import { METHOD_COLORS } from '@/sections/project/methodColors'
import { formatCount } from '@/utils/formatNumber'
import type { Endpoint } from '@/types/endpoint'
import { PROJECT_MODES } from '@/types/project'
import type { Project, ProjectMode, ProjectUpdateRequest } from '@/types/project'
import type { RequestLog } from '@/types/log'

type DetailTab = 'endpoints' | 'logs'

/**
 * What the dialog body shows: the tabs, or the one panel that replaced them.
 * An endpoint is addressed by id and read fresh (`useEndpoint`), never held:
 * a held object is the row as it was when the panel opened.
 */
type PanelMode =
  | { kind: 'tabs' }
  | { kind: 'endpointCreate' }
  | { kind: 'endpoint'; id: string }
  | { kind: 'endpointDelete'; id: string }
  | { kind: 'log'; id: string }
  | { kind: 'clearLogs' }

/** Configuration first, then evidence: what the project answers, then what was called. */
const TAB_ORDER: DetailTab[] = ['endpoints', 'logs']

const TAB_ICONS: Record<DetailTab, ActionIcon> = {
  endpoints: 'link',
  logs: 'clock',
}

const TABS: PanelMode = { kind: 'tabs' }

interface ProjectDetailDialogProps {
  open: boolean
  projectId: string | null
  onClose: () => void
}

export default function ProjectDetailDialog({ open, projectId, onClose }: ProjectDetailDialogProps) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()
  const [tab, setTab] = useUrlTab(TAB_ORDER, 'endpoints', open)
  const [mode, setMode] = useState<PanelMode>(TABS)
  const query = useProject(open ? projectId : null)
  const project = query.data
  useMissingRecordCloses(query, onClose)
  useQueryErrorToast(query, tCommon('messages.load_failed'))

  const endpointPage = useServerTablePage<Endpoint>()
  const endpointQuery = useEndpointList(
    project === undefined ? null : { projectId: project.id, ...endpointPage.params },
  )
  const endpoints = endpointPage.resolve(endpointQuery.data)
  useQueryErrorToast(endpointQuery, tCommon('messages.load_failed'))

  // The log tab's page, filters and ticked rows: a row's panel unmounts the tab.
  const logPage = useServerTablePage<RequestLog>()
  const [logFilters, setLogFilters] = useState<LogFilterValues>(NO_LOG_FILTERS)
  const [logSelection, setLogSelection] = useState<ReadonlySet<string>>(NO_LOG_SELECTION)

  const projectKey = project?.id ?? ''
  const updateEndpoint = useUpdateEndpoint(projectKey)
  const deleteEndpoint = useDeleteEndpoint(projectKey)
  const clearLogs = useDeleteLog(projectKey)

  const panelEndpointId = 'id' in mode && mode.kind !== 'log' ? mode.id : null
  const selectedQuery = useEndpoint(project?.id ?? null, panelEndpointId)
  const selected = selectedQuery.data

  /**
   * The dialog stays mounted between openings, so its body is reset the way a
   * form dialog resets its fields — after the close transition, so the body does
   * not snap back to the tabs while the dialog is still fading out. The tab
   * needs no reset: it is the URL's.
   */
  const resetBody = () => {
    setMode(TABS)
    endpointPage.reset()
    logPage.reset()
    setLogFilters(NO_LOG_FILTERS)
    setLogSelection(NO_LOG_SELECTION)
  }

  const toggle = async (endpoint: Endpoint, enabled: boolean) => {
    try {
      await updateEndpoint.mutateAsync({ id: endpoint.id, data: { enabled } })
    } catch (error) {
      toast.error(serverErrorMessage(toApiError(error).code, tCommon))
    }
  }

  const removeEndpoint = async (id: string) => {
    try {
      await deleteEndpoint.mutateAsync(id)
      toast.success(tCommon('messages.deleted'))
      setMode(TABS)
    } catch (error) {
      toast.error(serverErrorMessage(toApiError(error).code, tCommon))
    }
  }

  const clear = async () => {
    try {
      await clearLogs.mutateAsync()
      toast.success(t('log.cleared'))
      // The ticked rows are gone with the log.
      setLogSelection(NO_LOG_SELECTION)
      logPage.reset()
      setMode(TABS)
    } catch (error) {
      toast.error(serverErrorMessage(toApiError(error).code, tCommon))
    }
  }

  /**
   * An endpoint panel whose endpoint no longer resolves — deleted under it —
   * falls back to the tabs, and the strip has to come back with it.
   */
  const endpointGone = panelEndpointId !== null && selectedQuery.isError
  const showsTabs = mode.kind === 'tabs' || endpointGone

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={RECORD_SURFACE.DIALOG_MAX_WIDTH}
      fullWidth
      slotProps={{ transition: { onExited: resetBody } }}
    >
      <Stack direction="row" alignItems="flex-start" sx={{ p: 3, pb: 2 }}>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          {project === undefined ? (
            <Typography variant="h6">{t('detail_title')}</Typography>
          ) : (
            <ProjectHeader project={project} />
          )}
        </Box>
        <IconButton onClick={onClose} size="small" aria-label={tCommon('actions.close')}>
          <Iconify name="close" />
        </IconButton>
      </Stack>

      {showsTabs && (
        <Tabs
          value={tab}
          onChange={(_event, value: DetailTab) => setTab(value)}
          sx={{ px: 3, borderBottom: 1, borderColor: 'divider' }}
        >
          {TAB_ORDER.map((name) => (
            <Tab key={name} value={name} label={t(`tabs.${name}`)} icon={<Iconify name={TAB_ICONS[name]} />} />
          ))}
        </Tabs>
      )}

      <DialogContent sx={{ minHeight: RECORD_SURFACE.BODY_MIN_HEIGHT, bgcolor: 'background.neutral', p: 3 }}>
        <Stack spacing={RECORD_SURFACE.SECTION_GAP}>
          {query.isLoading && (
            <Stack alignItems="center" sx={{ py: 6 }}>
              <CircularProgress />
            </Stack>
          )}

          {project !== undefined && showsTabs && tab === 'endpoints' && (
            <ProjectEndpointsTab
              paging={{
                visible: endpoints.rows,
                pagination: endpoints.pagination,
                count: endpoints.pagination.count,
                reset: endpointPage.reset,
              }}
              pendingId={updateEndpoint.isPending ? (updateEndpoint.variables?.id ?? null) : null}
              onCreate={() => setMode({ kind: 'endpointCreate' })}
              onSelect={(endpoint) => setMode({ kind: 'endpoint', id: endpoint.id })}
              onDelete={(endpoint) => setMode({ kind: 'endpointDelete', id: endpoint.id })}
              onToggle={(endpoint, enabled) => void toggle(endpoint, enabled)}
            />
          )}

          {project !== undefined && showsTabs && tab === 'logs' && (
            <ProjectLogsTab
              projectId={project.id}
              page={logPage}
              filters={logFilters}
              onFiltersChange={setLogFilters}
              selection={logSelection}
              onSelectionChange={setLogSelection}
              onSelect={(log) => setMode({ kind: 'log', id: log.id })}
              onClear={() => setMode({ kind: 'clearLogs' })}
            />
          )}

          {project !== undefined && mode.kind === 'endpointCreate' && (
            <EndpointPanel
              projectId={project.id}
              endpoint={null}
              onCreated={(endpoint) => setMode({ kind: 'endpoint', id: endpoint.id })}
              onBack={() => setMode(TABS)}
            />
          )}

          {project !== undefined && !endpointGone && panelEndpointId !== null && selected === undefined && (
            <Stack alignItems="center" sx={{ py: 6 }}>
              <CircularProgress />
            </Stack>
          )}

          {project !== undefined && mode.kind === 'endpoint' && selected !== undefined && (
            <EndpointPanel
              // A new record is a new form: its defaults are read once, at mount.
              key={selected.id}
              projectId={project.id}
              endpoint={selected}
              onCreated={() => undefined}
              onBack={() => setMode(TABS)}
            />
          )}

          {project !== undefined && mode.kind === 'endpointDelete' && selected !== undefined && (
            <RecordDeletePanel
              title={t('endpoint.delete_title')}
              summary={
                <>
                  <Label color={METHOD_COLORS[selected.method]}>{selected.method}</Label>
                  <Typography variant="body2">{selected.path}</Typography>
                </>
              }
              warning={
                <Typography variant="body2" color="text.secondary">
                  {t('endpoint.delete_warning')}
                </Typography>
              }
              pending={deleteEndpoint.isPending}
              onBack={() => setMode(TABS)}
              onConfirm={() => void removeEndpoint(selected.id)}
            />
          )}

          {project !== undefined && mode.kind === 'log' && (
            <LogPanel
              projectId={project.id}
              logId={mode.id}
              onBack={() => setMode(TABS)}
              onRecorded={(endpoint) => setMode({ kind: 'endpoint', id: endpoint.id })}
            />
          )}

          {project !== undefined && mode.kind === 'clearLogs' && (
            <RecordDeletePanel
              title={t('log.clear_title')}
              summary={<Typography variant="body2">{project.name}</Typography>}
              warning={
                <Typography variant="body2" color="text.secondary">
                  {t('log.clear_warning')}
                </Typography>
              }
              pending={clearLogs.isPending}
              onBack={() => setMode(TABS)}
              onConfirm={() => void clear()}
            />
          )}
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The project's identity: its name and endpoint count, the hosts it intercepts,
 * the fields it ignores and its description, each edited in place, the mode,
 * and the proxy to use.
 */
function ProjectHeader({ project }: { project: Project }) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()
  const update = useUpdateProject()

  /** Saves `data`: `null` once saved, the refusal (already toasted) when the server refuses it. */
  const send = async (data: ProjectUpdateRequest): Promise<ApiError | null> => {
    try {
      await update.mutateAsync({ id: project.id, data })
      toast.success(tCommon('messages.saved'))
      return null
    } catch (error) {
      const refusal = toApiError(error)
      toast.error(serverErrorMessage(refusal.code, tCommon))
      return refusal
    }
  }

  const save = async (data: ProjectUpdateRequest) => (await send(data)) === null

  return (
    <Stack spacing={1}>
      <Box>
        <Typography variant="h6">{project.name}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t('detail.endpoint_count', { total: formatCount(project.endpoint_count) })}
        </Typography>
      </Box>

      <ChipsEditField
        items={project.hosts}
        text={{
          label: t('detail.hosts_label'),
          empty: t('detail.no_hosts'),
          edit: t('detail.edit_hosts'),
          inputLabel: t('form.hosts'),
          placeholder: t('form.hosts_placeholder'),
          helper: t('form.hosts_helper'),
        }}
        rules={hostChipRules(t)}
        problem={(hosts) => hostsProblem(hosts, t)}
        pending={update.isPending}
        onSave={(hosts) => send({ hosts })}
        takenBy={(refusal) => (refusal.code === 'host_taken' ? refusal.host : null)}
        takenMessage={tCommon('errors.host_taken')}
      />

      <ChipsEditField
        items={project.ignored_fields}
        text={{
          label: t('detail.ignored_fields_label'),
          empty: t('detail.no_ignored_fields'),
          edit: t('detail.edit_ignored_fields'),
          inputLabel: t('form.ignored_fields'),
          placeholder: t('form.ignored_fields_placeholder'),
          helper: t('form.ignored_fields_helper'),
        }}
        rules={fieldChipRules(t)}
        problem={(fields) => fieldsProblem(fields, t)}
        pending={update.isPending}
        onSave={(fields) => send({ ignored_fields: fields })}
      />

      <IgnoredFieldSuggestions
        projectId={project.id}
        ignoredCount={project.ignored_fields.length}
        pending={update.isPending}
        onAdd={(name) => void send({ ignored_fields: [...project.ignored_fields, name] })}
      />

      <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={project.mode}
          disabled={update.isPending}
          aria-label={t('detail.mode')}
          onChange={(_event, next: ProjectMode | null) => {
            // Clicking the pressed button deselects it - a click, not a mode.
            if (next !== null && next !== project.mode) void save({ mode: next })
          }}
        >
          {PROJECT_MODES.map((mode) => (
            <ToggleButton
              key={mode}
              value={mode}
              // Record logs what the hosts' real servers answer, so there is nothing to record without one.
              disabled={update.isPending || (mode === 'record' && project.hosts.length === 0)}
              sx={{ px: 1.5, py: 0.25 }}
            >
              {t(`mode.${mode}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Typography variant="caption" color="text.secondary">
          {t(`detail.mode_hint.${project.mode}`)}
        </Typography>
      </Stack>

      <ProxyHint />

      <InlineEditField
        value={project.description}
        empty={t('detail.no_description')}
        label={t('form.description')}
        editLabel={t('detail.edit_description')}
        multiline
        pending={update.isPending}
        problem={(draft) =>
          draft.length > DESCRIPTION_MAX_LENGTH
            ? tCommon('validation.max_length', { count: DESCRIPTION_MAX_LENGTH })
            : undefined
        }
        onSave={(draft) => save({ description: draft })}
      />
    </Stack>
  )
}

/**
 * Where a client points its HTTP(S) proxy to reach the project, the CA it must
 * trust once the proxy has made one, and a warning while nothing listens there.
 */
function ProxyHint() {
  const { t } = useTranslation('project')
  const { data: proxy } = useProxyStatus()
  const caUrl = useProxyCaUrl()

  if (proxy === undefined) return null
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
      <Typography variant="caption" color="text.secondary">
        {t('detail.proxy_label')}
      </Typography>
      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
        {`${proxy.host}:${proxy.port}`}
      </Typography>
      {!proxy.listening && <Label color="warning">{t('detail.proxy_not_listening')}</Label>}
      {proxy.ca_ready && (
        <Link href={caUrl} download variant="caption">
          {t('detail.proxy_ca')}
        </Link>
      )}
    </Stack>
  )
}

interface InlineEditFieldProps {
  value: string
  /** Shown in place of an empty value. */
  empty: string
  label: string
  editLabel: string
  multiline?: boolean
  pending: boolean
  /** Why the draft cannot be saved, or `undefined` when it can. */
  problem: (draft: string) => string | undefined
  /** Resolves `true` once saved, which closes the editor; `false` keeps the draft. */
  onSave: (draft: string) => Promise<boolean>
}

/** One header value that reads as text and turns into a field with save and cancel. */
function InlineEditField({
  value,
  empty,
  label,
  editLabel,
  multiline = false,
  pending,
  problem,
  onSave,
}: InlineEditFieldProps) {
  const { t: tCommon } = useTranslation('common')
  // `null` while reading; the draft while the value is being edited.
  const [draft, setDraft] = useState<string | null>(null)
  const error = draft === null ? undefined : problem(draft)

  const save = async () => {
    if (draft === null || error !== undefined) return
    if (await onSave(draft)) setDraft(null)
  }

  if (draft === null) {
    return (
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
        <Typography variant="body2" color="text.secondary">
          {value === '' ? empty : value}
        </Typography>
        <Tooltip title={editLabel}>
          <IconButton size="small" aria-label={editLabel} onClick={() => setDraft(value)}>
            <Iconify name="edit" />
          </IconButton>
        </Tooltip>
      </Stack>
    )
  }

  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <TextField
        size="small"
        label={label}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        error={error !== undefined}
        helperText={error}
        multiline={multiline}
        fullWidth
        autoFocus
      />
      <IconButton
        size="small"
        aria-label={tCommon('actions.save')}
        onClick={() => void save()}
        disabled={pending || error !== undefined}
      >
        <Iconify name="check" />
      </IconButton>
      <IconButton size="small" aria-label={tCommon('actions.cancel')} onClick={() => setDraft(null)}>
        <Iconify name="close" />
      </IconButton>
    </Stack>
  )
}
