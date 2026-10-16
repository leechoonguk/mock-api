/**
 * A create dialog's foot: cancel and save, or - after an accidental close of a
 * dirty form - the one question about discarding it.
 *
 * The question replaces the buttons rather than opening a confirm over the
 * form (rule://frontend-screens, One modal, then panels): a third layer over a
 * half-filled form hides what is being discarded. Its first button keeps the
 * form and takes the focus, so a second Escape or Enter loses nothing.
 *
 * The two rows carry distinct keys: without them React reuses the one
 * <button> across the branches, so the "keep editing" button the pointer is
 * pressing becomes the save button (type=submit) mid-click and the click
 * submits the form it was meant to keep open.
 */

import { Button, DialogActions, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'
import type { DiscardGuard } from '@/hooks/useDiscardGuard'

interface FormDialogActionsProps {
  pending: boolean
  onCancel: () => void
  guard: DiscardGuard
  /** The form the save submits, when the actions stand outside it. */
  form?: string
  /** What the primary button says when saving is not the verb - a compose dialog sends. */
  submitLabel?: string
}

export default function FormDialogActions({
  pending,
  onCancel,
  guard,
  form,
  submitLabel,
}: FormDialogActionsProps) {
  const { t } = useTranslation('common')

  if (guard.asking) {
    return (
      <DialogActions key="asking" sx={{ py: 1.5, px: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant="body2" role="status" sx={{ flexGrow: 1, minWidth: 0 }}>
          {t('messages.discard_confirm')}
        </Typography>
        {/* The safe answer holds the focus, so the next key loses nothing. */}
        <Button color="inherit" onClick={guard.keep} autoFocus>
          {t('actions.keep_editing')}
        </Button>
        <Button variant="contained" color="error" onClick={guard.discard}>
          {t('actions.discard')}
        </Button>
      </DialogActions>
    )
  }

  return (
    <DialogActions key="actions" sx={{ py: 1.5, px: 2 }}>
      <Button color="inherit" onClick={onCancel}>
        {t('actions.cancel')}
      </Button>
      <Button type="submit" form={form} variant="contained" disabled={pending}>
        {submitLabel ?? t('actions.save')}
      </Button>
    </DialogActions>
  )
}
