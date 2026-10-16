/**
 * Language switch, ported from the reference application's header.
 *
 * A 40x40 icon button showing the current flag, opening a list of flags — not a
 * bordered select. A boxed input in a transparent blurred bar reads as a form
 * field on a page that has none, which is exactly what looked wrong here.
 */

import { useState } from 'react'
import { Box, IconButton, MenuItem, Stack } from '@mui/material'
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import MenuPopover from '@/components/menu-popover/MenuPopover'
import { FLAG_ICONS } from '@/components/iconify/icons'
import { SUPPORTED_LANGUAGES } from '@/locales/i18n'

const BUTTON_SIZE = 40

const FLAG_WIDTH = 28

const MENU_WIDTH = 180

export default function LanguagePopover() {
  const { t, i18n } = useTranslation('nav')
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)

  const select = (language: string) => {
    void i18n.changeLanguage(language)
    setAnchor(null)
  }

  return (
    <>
      <IconButton
        onClick={(event: MouseEvent<HTMLElement>) => setAnchor(event.currentTarget)}
        aria-label={t('language.label')}
        sx={{
          width: BUTTON_SIZE,
          height: BUTTON_SIZE,
          ...(anchor !== null && { bgcolor: 'action.selected' }),
        }}
      >
        <Box
          component="img"
          alt={i18n.language}
          src={FLAG_ICONS[i18n.language] ?? FLAG_ICONS.ko}
          sx={{ width: FLAG_WIDTH }}
        />
      </IconButton>

      <MenuPopover
        open={anchor}
        onClose={() => setAnchor(null)}
        sx={{ width: MENU_WIDTH }}
      >
        <Stack spacing={0.75}>
          {SUPPORTED_LANGUAGES.map((language) => (
            <MenuItem
              key={language}
              selected={language === i18n.language}
              onClick={() => select(language)}
            >
              <Box
                component="img"
                alt={language}
                src={FLAG_ICONS[language]}
                sx={{ width: FLAG_WIDTH, mr: 2 }}
              />
              {t(`language.${language}`)}
            </MenuItem>
          ))}
        </Stack>
      </MenuPopover>
    </>
  )
}
