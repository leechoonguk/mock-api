/**
 * One project, read and worked on inside one dialog (`?detail=<id>`).
 *
 * The stack is project dialog → panel, never project dialog → second modal: a
 * confirm dialog on top of this one hides the record it is asking about. So a
 * panel *replaces* the body while the project header stays on screen — the
 * endpoint editor, its test console, a logged request, and the two delete
 * confirmations — and "back" is a button in the panel's pinned strip.
 *
 * The header carries what a reader copies out of a project: the base URL its
 * endpoints answer at. The description is edited in place there; the name is
 * edited in the list row and the slug never.
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
  Stack,
  Tab,
  Tabs,
  TextField,
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
import { serverErrorMessage } from '@/lib/api/formErrors'
import { useDeleteEndpoint, useEndpoint, useEndpointList, useUpdateEndpoint } from '@/lib/api/hooks/useEndpoint'
import { useDeleteLog } from '@/lib/api/hooks/useLog'
import { useMockBaseUrl } from '@/lib/api/hooks/useMock'
import { useProject, useUpdateProject } from '@/lib/api/hooks/useProject'
import EndpointPanel from '@/sections/project/EndpointPanel'
import EndpointTestPanel from '@/sections/project/EndpointTestPanel'
import LogPanel from '@/sections/project/LogPanel'
import { DESCRIPTION_MAX_LENGTH } from '@/sections/project/ProjectFormDialog'
import ProjectEndpointsTab from '@/sections/project/detail/ProjectEndpointsTab'
import ProjectLogsTab from '@/sections/project/detail/ProjectLogsTab'
import { METHOD_COLORS } from '@/sections/project/methodColors'
import { formatCount } from '@/utils/formatNumber'
import type { Endpoint } from '@/types/endpoint'
import type { Project } from '@/types/project'

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
  | { kind: 'endpointTest'; id: string }
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
              onTest={(endpoint) => setMode({ kind: 'endpointTest', id: endpoint.id })}
              onDelete={(endpoint) => setMode({ kind: 'endpointDelete', id: endpoint.id })}
              onToggle={(endpoint, enabled) => void toggle(endpoint, enabled)}
            />
          )}

          {project !== undefined && showsTabs && tab === 'logs' && (
            <ProjectLogsTab
              projectId={project.id}
              onSelect={(log) => setMode({ kind: 'log', id: log.id })}
              onClear={() => setMode({ kind: 'clearLogs' })}
            />
          )}

          {project !== undefined && mode.kind === 'endpointCreate' && (
            <EndpointPanel
              projectId={project.id}
              endpoint={null}
              onCreated={(endpoint) => setMode({ kind: 'endpoint', id: endpoint.id })}
              onTest={() => undefined}
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
              onTest={() => setMode({ kind: 'endpointTest', id: selected.id })}
              onBack={() => setMode(TABS)}
            />
          )}

          {project !== undefined && mode.kind === 'endpointTest' && selected !== undefined && (
            <EndpointTestPanel
              key={selected.id}
              slug={project.slug}
              endpoint={selected}
              onBack={() => setMode({ kind: 'endpoint', id: selected.id })}
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
            <LogPanel projectId={project.id} logId={mode.id} onBack={() => setMode(TABS)} />
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
 * The project's identity: its name and slug, the base URL with a copy button,
 * and the description, edited in place.
 */
function ProjectHeader({ project }: { project: Project }) {
  const { t } = useTranslation('project')
  const { t: tCommon } = useTranslation('common')
  const toast = useToast()
  const baseUrl = useMockBaseUrl(project.slug)
  const update = useUpdateProject()
  // `null` while reading; the draft while the description is being edited.
  const [draft, setDraft] = useState<string | null>(null)
  const tooLong = draft !== null && draft.length > DESCRIPTION_MAX_LENGTH

  // The clipboard refusing is the browser's answer, not the server's: there is
  // no code to map, so its sentence is this screen's own.
  const copy = () =>
    navigator.clipboard.writeText(baseUrl).then(
      () => toast.success(t('detail.copied')),
      () => toast.error(t('detail.copy_failed')),
    )

  const save = async () => {
    if (draft === null || tooLong) return
    try {
      await update.mutateAsync({ id: project.id, data: { description: draft } })
      toast.success(tCommon('messages.saved'))
      setDraft(null)
    } catch (error) {
      toast.error(serverErrorMessage(toApiError(error).code, tCommon))
    }
  }

  return (
    <Stack spacing={1}>
      <Box>
        <Typography variant="h6">{project.name}</Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <Label color="info">{project.slug}</Label>
          <Typography variant="caption" color="text.secondary">
            {t('detail.endpoint_count', { total: formatCount(project.endpoint_count) })}
          </Typography>
        </Stack>
      </Box>

      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }} noWrap title={baseUrl}>
          {baseUrl}
        </Typography>
        <Tooltip title={t('detail.copy_url')}>
          <IconButton size="small" aria-label={t('detail.copy_url')} onClick={() => void copy()}>
            <Iconify name="copy" />
          </IconButton>
        </Tooltip>
      </Stack>

      {draft === null ? (
        <Stack direction="row" spacing={0.5} alignItems="center">
          <Typography variant="body2" color="text.secondary">
            {project.description === '' ? t('detail.no_description') : project.description}
          </Typography>
          <Tooltip title={t('detail.edit_description')}>
            <IconButton
              size="small"
              aria-label={t('detail.edit_description')}
              onClick={() => setDraft(project.description)}
            >
              <Iconify name="edit" />
            </IconButton>
          </Tooltip>
        </Stack>
      ) : (
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            size="small"
            label={t('form.description')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            error={tooLong}
            helperText={tooLong ? tCommon('validation.max_length', { count: DESCRIPTION_MAX_LENGTH }) : undefined}
            multiline
            fullWidth
            autoFocus
          />
          <IconButton
            size="small"
            aria-label={tCommon('actions.save')}
            onClick={() => void save()}
            disabled={update.isPending || tooLong}
          >
            <Iconify name="check" />
          </IconButton>
          <IconButton size="small" aria-label={tCommon('actions.cancel')} onClick={() => setDraft(null)}>
            <Iconify name="close" />
          </IconButton>
        </Stack>
      )}
    </Stack>
  )
}
