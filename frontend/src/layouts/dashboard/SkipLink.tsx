/**
 * "Skip to main content" — the shell's first focusable element.
 *
 * Measured before it: the first Tab on a screen went through the header's
 * buttons and every nav link (18 stops on /food/business) before reaching
 * anything on the screen itself. It sits off screen until it takes focus,
 * then drops in at the top-left over the header; Enter moves focus to `main`,
 * so the next Tab is the screen's first control.
 */

import { Box } from '@mui/material'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'

const OFFSET = 8

export default function SkipLink({ target }: { target: string }) {
  const { t } = useTranslation('nav')

  // The hash would also scroll, but focus would stay on the link in some
  // browsers and the router would see a URL change; moving focus is the point.
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    document.getElementById(target)?.focus()
  }

  return (
    <Box
      component="a"
      href={`#${target}`}
      onClick={skip}
      sx={(theme) => ({
        position: 'fixed',
        top: OFFSET,
        left: OFFSET,
        zIndex: theme.zIndex.tooltip + 1,
        px: 2,
        py: 1,
        borderRadius: 1,
        typography: 'subtitle2',
        color: 'primary.contrastText',
        bgcolor: 'primary.main',
        textDecoration: 'none',
        boxShadow: theme.shadows[8],
        transform: 'translateY(-200%)',
        '&:focus': { transform: 'none' },
      })}
    >
      {t('skip_to_content')}
    </Box>
  )
}
