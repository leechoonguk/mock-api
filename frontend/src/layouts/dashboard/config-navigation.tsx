/**
 * The navigation model — grouped under subheaders, as in the reference
 * application.
 *
 * A subheader is not decoration: it is how a sidebar stays readable past four
 * entries, and it names the part of the product each screen belongs to. A route
 * that exists but is not listed is a screen nobody can reach, so
 * `check-frontend-routing` compares this list against the path registry in both
 * directions.
 */

import type { ParseKeys } from 'i18next'
import { PATHS } from '@/routes/paths'
import type { NavIcon } from '@/components/iconify/icons'

/**
 * A key the `nav` namespace really has.
 *
 * Typed rather than `string` because these keys are read at a distance: the
 * sidebar renders `t(item.titleKey)`, so a key that exists nowhere renders as
 * itself in the navigation and no test looks at a label.
 */
type NavKey = ParseKeys<'nav'>

export interface NavItem {
  /** Key inside the `nav` namespace. */
  titleKey: NavKey
  path: string
  /** Key into `NAV_ICONS` — a local SVG drawn through `SvgColor`. */
  icon: NavIcon
}

export interface NavGroup {
  /**
   * Key inside the `nav` namespace, rendered as the group's subheader. `null`
   * for an ungrouped head: a subheader over a single item is a label for a
   * group that does not exist.
   */
  subheaderKey: NavKey | null
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    subheaderKey: null,
    items: [
      { titleKey: 'project', path: PATHS.project, icon: 'project' },
      { titleKey: 'proxy', path: PATHS.proxy, icon: 'proxy' },
    ],
  },
]
