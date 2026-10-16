/**
 * The catch-all route.
 *
 * A URL that matches nothing must say so and offer the way back; a silent blank
 * page is indistinguishable from a crash.
 *
 * It is routed inside `DashboardLayout`, so the reader keeps the header and the
 * nav, with the address they typed still on screen. The address is shown
 * because a mistyped one is the usual cause and the reader can only fix what
 * they see.
 */

import { Button, Card, Stack, Typography } from '@mui/material'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import PageHeader from '@/components/page-header/PageHeader'
import { PATHS } from '@/routes/paths'

/** react-router's key for the entry a tab opened on: nothing of this app is behind it. */
const FIRST_ENTRY_KEY = 'default'

export default function NotFoundPage() {
  const { t } = useTranslation('common')
  const location = useLocation()
  const navigate = useNavigate()
  // Back from the first entry would leave the app (or close nothing), so the
  // button is offered only when an earlier screen of ours is there to return to.
  const canGoBack = location.key !== FIRST_ENTRY_KEY

  return (
    <>
      <PageHeader heading={t('not_found.title')} description={t('not_found.description')} links={[]} />
      <Card sx={{ p: 3 }}>
        <Stack spacing={2.5} alignItems="flex-start">
          <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-all' }}>
            {t('not_found.requested', { path: `${location.pathname}${location.search}` })}
          </Typography>
          <Stack direction="row" spacing={1.5} useFlexGap flexWrap="wrap">
            <Button component={RouterLink} to={PATHS.project} variant="contained">
              {t('not_found.home')}
            </Button>
            {canGoBack && (
              <Button variant="outlined" onClick={() => void navigate(-1)}>
                {t('not_found.back')}
              </Button>
            )}
          </Stack>
        </Stack>
      </Card>
    </>
  )
}
