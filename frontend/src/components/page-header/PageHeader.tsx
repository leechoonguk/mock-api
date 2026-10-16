/**
 * The top of every page, ported from the reference application's
 * `CustomBreadcrumbs`.
 *
 * The order is the design: heading, then a one-line description of what the
 * screen is for, then the trail — and the trail's separator is a 4px dot, not a
 * slash. The action sits on the right of the heading row, so "what this screen
 * is" and "what I can do here" are read in one pass.
 */

import { Box, Breadcrumbs, Link, Stack, Typography } from '@mui/material'
import { Link as RouterLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { APP_NAME, SHORT_WINDOW_MEDIA } from '@/config'
import { TOUCH_REACH_SX } from '@/theme/overrides'

const SEPARATOR_SIZE = 4

/**
 * A crumb is a line of body text, 16px tall: under a finger its target grows to
 * the 44px every button reaches, the same `::after` the theme gives a button.
 * The trail stands alone under the heading, so the reach covers nothing else.
 */
const CRUMB_TOUCH_SX = TOUCH_REACH_SX

/**
 * On a short window the description leaves the screen but not the page: a
 * screen reader still reads it under the heading, and the heading steps down
 * one size. It is the line a returning reader no longer reads, and the 50px
 * it held are rows of the list under it (rule://frontend-design, The Screen
 * Fills The Window).
 */
const SHORT_HEADING_SX = { [SHORT_WINDOW_MEDIA]: { typography: 'h5', mb: 0.5 } } as const

const SHORT_DESCRIPTION_SX = {
  mb: 1,
  [SHORT_WINDOW_MEDIA]: {
    position: 'absolute',
    // Pixels, not `1`: MUI reads a bare 1 as 100%, and the hidden line was a
    // window-sized box that scrolled the document (measured: 319 x 113px at 1280x720).
    width: '1px',
    height: '1px',
    m: -0.125,
    p: 0,
    overflow: 'hidden',
    clip: 'rect(0 0 0 0)',
    whiteSpace: 'nowrap',
    border: 0,
  },
} as const

export interface BreadcrumbLink {
  label: string
  href?: string
}

interface PageHeaderProps {
  heading: string
  description?: string
  links: BreadcrumbLink[]
  action?: ReactNode
}

export default function PageHeader({ heading, description, links, action }: PageHeaderProps) {
  const { t } = useTranslation('nav')
  return (
    <Box sx={{ mb: 3, [SHORT_WINDOW_MEDIA]: { mb: 2 } }}>
      {/* React hoists it into <head>: without it every tab read the app's name alone. */}
      <title>{`${heading} · ${APP_NAME}`}</title>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={{ xs: 1.5, sm: 0 }}
      >
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4" component="h1" gutterBottom sx={SHORT_HEADING_SX}>
            {heading}
          </Typography>

          {description !== undefined && (
            <Typography variant="body2" color="text.secondary" sx={SHORT_DESCRIPTION_SX}>
              {description}
            </Typography>
          )}

          {/* A trail of one is the page's own name again, already in the heading. */}
          {links.length > 1 && (
          // Its own name: MUI draws a `<nav>`, and the sidebar is another one.
          <Breadcrumbs separator={<Separator />} aria-label={t('breadcrumb')}>
            {links.map((link) =>
              link.href === undefined ? (
                <Typography key={link.label} variant="body2" color="text.disabled">
                  {link.label}
                </Typography>
              ) : (
                <Link
                  key={link.label}
                  component={RouterLink}
                  to={link.href}
                  variant="body2"
                  color="inherit"
                  sx={CRUMB_TOUCH_SX}
                >
                  {link.label}
                </Link>
              ),
            )}
          </Breadcrumbs>
          )}
        </Box>

        {action !== undefined && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
      </Stack>
    </Box>
  )
}

function Separator() {
  return (
    <Box
      component="span"
      sx={{
        width: SEPARATOR_SIZE,
        height: SEPARATOR_SIZE,
        borderRadius: '50%',
        bgcolor: 'text.disabled',
      }}
    />
  )
}
