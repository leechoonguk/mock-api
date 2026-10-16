/**
 * The badge colour of each mock method — one map for the endpoint table and
 * every panel that names an endpoint.
 *
 * Keyed by `MockMethod`, so the method vocabulary gaining a member fails the
 * build here instead of drawing a grey badge nobody reads. The colours follow
 * the convention API tools share: reads green, writes warm, deletes red.
 */

import type { ComponentProps } from 'react'
import type Label from '@/components/label/Label'
import type { MockMethod } from '@/types/endpoint'

type LabelColor = NonNullable<ComponentProps<typeof Label>['color']>

export const METHOD_COLORS: Record<MockMethod, LabelColor> = {
  GET: 'success',
  POST: 'warning',
  PUT: 'info',
  PATCH: 'secondary',
  DELETE: 'error',
  HEAD: 'default',
  OPTIONS: 'default',
  ANY: 'default',
}
