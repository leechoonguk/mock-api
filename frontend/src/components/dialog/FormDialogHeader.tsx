/**
 * The head of a dialog, ported from the reference application.
 *
 * Tight padding, a tinted icon, a bold `subtitle1` title, the record's identity
 * as a caption under it, a close button, and a dashed divider. The reference
 * application repeats this block in every dialog; here it is one component, so
 * "what a dialog looks like" is a single definition.
 *
 * `tone` is the icon's colour and nothing else: a confirm dialog that destroys a
 * row wears the same head as the form that edits it, in the palette's error
 * colour. A second header component for "the scary one" is how two dialogs of
 * one app end up with two title sizes.
 *
 * The caption is what tells the user *which* row they are editing — a dialog
 * titled only "Edit user" is the same dialog for every row.
 */

import { useTranslation } from 'react-i18next'
import { DialogTitle, Divider, IconButton, Stack, Typography } from '@mui/material'
import Iconify from '@/components/iconify/Iconify'
import type { ActionIcon } from '@/components/iconify/icons'

const ICON_SIZE = 20

const CAPTION_INDENT = 3.5

interface FormDialogHeaderProps {
  name: ActionIcon
  title: string
  /** The row being edited, shown under the title. Absent when creating. */
  caption?: string
  /** `error` for a head above a destructive question; `primary` otherwise. */
  tone?: 'primary' | 'error'
  onClose: () => void
}

export default function FormDialogHeader({
  name,
  title,
  caption,
  tone = 'primary',
  onClose,
}: FormDialogHeaderProps) {
  const { t: tCommon } = useTranslation('common')
  return (
    <>
      <DialogTitle sx={{ py: 1.5, px: 2 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Iconify name={name} width={ICON_SIZE} sx={{ color: `${tone}.main` }} />
              <Typography variant="subtitle1" fontWeight="bold">
                {title}
              </Typography>
            </Stack>

            {caption !== undefined && (
              <Typography variant="caption" color="text.secondary" sx={{ pl: CAPTION_INDENT }}>
                {caption}
              </Typography>
            )}
          </Stack>

          <IconButton onClick={onClose} size="small" aria-label={tCommon('actions.close')}>
            <Iconify name="close" />
          </IconButton>
        </Stack>
      </DialogTitle>

      <Divider sx={{ borderStyle: 'dashed' }} />
    </>
  )
}
