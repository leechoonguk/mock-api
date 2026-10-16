/**
 * Typed translation keys.
 *
 * Without this declaration `t()` takes any string, so a key that exists in no
 * locale type-checks and ships — it renders as the key itself, in the UI, in
 * production. Measured on the run-history screen: three step columns printed
 * `runs.steps_table.duration` as their header because the key was composed
 * (`t(`runs.steps_table.${column.key}`)`) and pointed at nothing.
 *
 * Declaring the resources makes the compiler own that class of bug, including
 * the composed form: a template key type-checks only when **every** value its
 * interpolation can take forms a real key. That is why the closed vocabularies
 * are unions (`BatchRunStatus`, `BatchTrigger`) rather than `string` — a
 * `string` interpolation can produce a key that does not exist, and now says so.
 *
 * `ko` is the source of truth because it is the default *and* the fallback
 * language; `check-frontend-i18n` proves `en` carries the same key set, so one
 * of them is enough to type against.
 */

import type { ko } from '@/locales/ko'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: typeof ko
  }
}
