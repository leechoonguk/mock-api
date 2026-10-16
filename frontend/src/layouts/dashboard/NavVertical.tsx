/**
 * The sidebar, ported from the reference application's vertical nav section.
 *
 * Two layouts, and the reader picks between them with the button on the column's
 * own edge: **vertical** (280px, glyph beside label) and **mini** (88px, glyph
 * above a smaller label). Mini is not a hidden nav — folding a menu away costs
 * more than it saves — it is the same list at a width a wide table can use: a
 * list grid gets 193px back, measured at 1440.
 *
 * The design is specific and every part of it carries meaning: a 280px column
 * with a dashed right border, `overline`-styled subheaders, 48px items with an
 * 8px radius, and an active item tinted with 16%-alpha primary and primary text.
 * The active state comes from `NavLink`, never from comparing `useLocation` by
 * hand — that is how two items end up looking selected.
 */

import {
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
  useMediaQuery,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { alpha, styled } from '@mui/material/styles'
import type { ElementType } from 'react'
import { NavLink } from 'react-router-dom'
import Iconify from '@/components/iconify/Iconify'
import SvgColor from '@/components/svg-color/SvgColor'
import { BRAND_MARK, NAV_ICONS } from '@/components/iconify/icons'
import { useTranslation } from 'react-i18next'
import { ICON, NAV } from '@/config'
import { useSettings } from '@/theme/settings'
import { NAV_GROUPS } from '@/layouts/dashboard/config-navigation'

/** The smallest size a group label reads at on a phone: 11 measured below the floor. */
const SUBHEADER_FONT_SIZE = 12

/**
 * The fold button, at the reference's own size and place: a 26px circle centred
 * on the column's edge, half on the nav and half on the page.
 *
 * It is rendered **beside** the drawer rather than inside it. The paper clips its
 * overflow — without that, labels spill onto the page while the column animates —
 * and a button half outside a clipped box is half a hit area: measured, the first
 * version's click landed on nothing and the layout never changed.
 */
const FOLD_SIZE = 26

const FOLD_GLYPH = 16

/** Level with the brand mark, so the edge reads as one row. */
const FOLD_TOP = 23

const StyledItem = styled(ListItemButton, {
  shouldForwardProp: (prop) => prop !== 'mini',
})<{ component?: ElementType; to?: string; end?: boolean; mini?: boolean }>(({ theme, mini }) => ({
  height: mini === true ? NAV.H_ITEM_MINI : NAV.H_ITEM,
  marginBottom: theme.spacing(0.5),
  paddingLeft: mini === true ? theme.spacing(0.5) : theme.spacing(2),
  paddingRight: mini === true ? theme.spacing(0.5) : theme.spacing(1.5),
  ...(mini === true && { flexDirection: 'column', justifyContent: 'center' }),
  borderRadius: theme.shape.borderRadius,
  color: theme.palette.text.secondary,
  '&.active': {
    color: theme.palette.primary.main,
    backgroundColor: alpha(theme.palette.primary.main, 0.16),
    '& .MuiListItemText-primary': { fontWeight: theme.typography.fontWeightBold },
    '&:hover': { backgroundColor: alpha(theme.palette.primary.main, 0.16) },
  },
}))

export default function NavVertical({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation('nav')
  const theme = useTheme()
  // The header's breakpoint: from here up it leaves the nav's width free.
  const docked = useMediaQuery(theme.breakpoints.up('lg'))
  /**
   * Folded only where the column is docked. Below `lg` the nav is a temporary
   * drawer the reader opened on purpose, and an 88px sheet over the page would
   * be a menu that is neither open nor closed.
   */
  const { navLayout, setNavLayout } = useSettings()
  const mini = docked && navLayout === 'mini'
  const width = mini ? NAV.W_MINI : NAV.W_DASHBOARD

  return (
    <>
      <Drawer
      variant={docked ? 'permanent' : 'temporary'}
      open={docked || open}
      onClose={onClose}
      // Kept mounted so the phone's first open does not build the list on the tap.
      ModalProps={{ keepMounted: true }}
      sx={{
        width: { lg: width },
        flexShrink: 0,
        // The width is animated on both the paper and the space it reserves, or
        // the page's content jumps to its new column while the sidebar slides.
        transition: theme.transitions.create('width', {
          duration: theme.transitions.duration.shorter,
        }),
        '& .MuiDrawer-paper': {
          width,
          bgcolor: 'background.default',
          overflowX: 'hidden',
          // MUI's own paper value, said here: the nav is the one vertical
          // scroller of the drawer, and the hidden x axis is not deciding it.
          overflowY: 'auto',
          transition: theme.transitions.create('width', {
            duration: theme.transitions.duration.shorter,
          }),
        },
      }}
    >
      <Stack
        sx={{ px: mini ? 1 : 2, py: 3 }}
        direction="row"
        alignItems="center"
        justifyContent={mini ? 'center' : 'flex-start'}
        spacing={1}
      >
        <SvgColor src={BRAND_MARK} sx={{ width: 32, height: 32, color: 'primary.main' }} />
        {!mini && (
          <Typography variant="subtitle1" component="span">
            {t('brand')}
          </Typography>
        )}
      </Stack>

      {/*
        A landmark, so a screen reader's region list reaches the menu in one
        step; measured before, the links stood in no landmark at all. Named,
        because the page's breadcrumb trail is a second `<nav>`.
      */}
      <Box component="nav" aria-label={t('landmark')} sx={{ px: mini ? 1 : 2 }}>
        {NAV_GROUPS.map((group) => (
          <List key={group.subheaderKey ?? 'head'} disablePadding>
            {/*
              A group's name does not fit 88px, and truncating it would put
              three characters of a word where the word was. Folded, the groups
              are separated by the gap the list already keeps. The ungrouped head
              carries no subheader at all: the dashboard is an overview of every
              area, so a label over it would name a group that does not exist.
            */}
            {!mini && group.subheaderKey !== null && (
              <Typography
                variant="overline"
                sx={{
                  display: 'block',
                  fontSize: SUBHEADER_FONT_SIZE,
                  color: 'text.secondary',
                  pt: 3,
                  pb: 1,
                }}
              >
                {t(group.subheaderKey)}
              </Typography>
            )}

            {group.items.map((item) => (
              <Box key={item.path}>
                <StyledItem
                  component={NavLink}
                  to={item.path}
                  // Exact: a path that prefixes another would light both items.
                  end
                  disableGutters
                  mini={mini}
                  // A drawer closes on the choice it was opened for; a docked nav has nothing to close.
                  onClick={docked ? undefined : onClose}
                >
                  <Box
                    sx={{
                      width: ICON.NAV_ITEM,
                      height: ICON.NAV_ITEM,
                      mr: mini ? 0 : 2,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      position: 'relative',
                    }}
                  >
                    <SvgColor src={NAV_ICONS[item.icon]} />
                  </Box>
                  {/*
                    The label survives the fold, at caption size and centred: a
                    column of unlabelled glyphs is a menu the reader has to
                    learn, which is what the reference avoids by keeping it.
                  */}
                  <ListItemText
                    primary={t(item.titleKey)}
                    slotProps={{
                      primary: {
                        noWrap: true,
                        variant: mini ? 'caption' : 'body2',
                        textAlign: mini ? 'center' : 'left',
                      },
                    }}
                    sx={mini ? { m: 0, width: 1 } : undefined}
                  />
                </StyledItem>
              </Box>
            ))}
          </List>
        ))}
      </Box>
      </Drawer>

      {/*
        The fold stands on the column's edge, as the reference draws it: a small
        circle on the page's own surface, half over the nav. It is the only thing
        that changes the layout — no screen folds the nav for the reader.
      */}
      {docked && (
        <IconButton
          size="small"
          aria-label={t(mini ? 'nav_expand' : 'nav_collapse')}
          onClick={() => setNavLayout(mini ? 'vertical' : 'mini')}
          sx={{
            position: 'fixed',
            top: FOLD_TOP,
            left: width - FOLD_SIZE / 2,
            width: FOLD_SIZE,
            height: FOLD_SIZE,
            zIndex: (styles) => styles.zIndex.drawer + 1,
            color: 'text.secondary',
            bgcolor: 'background.default',
            border: (styles) => `1px solid ${alpha(styles.palette.grey[500], 0.12)}`,
            transition: theme.transitions.create('left', {
              duration: theme.transitions.duration.shorter,
            }),
            '&:hover': { bgcolor: 'background.neutral' },
          }}
        >
          <Iconify name={mini ? 'unfold' : 'fold'} width={FOLD_GLYPH} />
        </IconButton>
      )}
    </>
  )
}
