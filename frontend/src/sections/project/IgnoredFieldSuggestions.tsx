/**
 * The fields worth ignoring, mined from the project's log: names whose value
 * changed between calls to one route (`useVolatileFields`), most widespread
 * first. A click adds one to the project's ignored fields; the server leaves
 * ignored names out, so it drops from here once the suggestions are read again.
 * Nothing is drawn while there is nothing to suggest.
 */

import { Chip, Stack, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import Iconify from '@/components/iconify/Iconify'
import Label from '@/components/label/Label'
import { useVolatileFields } from '@/lib/api/hooks/useLog'
import { IGNORED_FIELDS_MAX } from '@/sections/project/fieldPattern'
import { formatCount } from '@/utils/formatNumber'

interface IgnoredFieldSuggestionsProps {
  projectId: string
  /** How many fields the project ignores already: a full list takes no more. */
  ignoredCount: number
  pending: boolean
  onAdd: (name: string) => void
}

export default function IgnoredFieldSuggestions({
  projectId,
  ignoredCount,
  pending,
  onAdd,
}: IgnoredFieldSuggestionsProps) {
  const { t } = useTranslation('project')
  const { data } = useVolatileFields(projectId)
  const full = ignoredCount >= IGNORED_FIELDS_MAX

  if (data === undefined || data.fields.length === 0) return null
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={0.5} alignItems="center" useFlexGap sx={{ minWidth: 0, flexWrap: 'wrap' }}>
        <Label color="info">{t('detail.suggestions_label')}</Label>
        {data.fields.map((field) => (
          <Chip
            key={field.name}
            size="small"
            variant="outlined"
            color="info"
            icon={<Iconify name="add" />}
            label={t('detail.suggestion', { name: field.name, routes: formatCount(field.routes) })}
            disabled={pending || full}
            onClick={() => onAdd(field.name)}
          />
        ))}
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {full
          ? t('validation.ignored_fields_max', { max: String(IGNORED_FIELDS_MAX) })
          : t('detail.suggestions_caption')}
      </Typography>
    </Stack>
  )
}
