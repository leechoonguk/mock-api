/**
 * The rules an ignored field obeys — `IgnoredFields` in `app/schemas/project.py`
 * read before the request, one reading for the project form and the header's
 * editor, so each refuses what the server would.
 *
 * A field is a query parameter name or a JSON key, compared as written: trimmed,
 * never case-folded. The box splits on commas and white space, so a name holds
 * neither.
 */

import type { TFunction } from 'i18next'
import type { ChipRules } from '@/sections/project/ChipsInput'

/** `IGNORED_FIELDS_MAX` in `app/schemas/project.py`: how many fields one project ignores. */
export const IGNORED_FIELDS_MAX = 50

/** `IGNORED_FIELD_MAX_LENGTH` in `app/schemas/project.py`, in characters. */
export const IGNORED_FIELD_MAX_LENGTH = 100

/** Python counts characters, not UTF-16 units: an emoji is one. */
function characterCount(name: string): number {
  return [...name].length
}

/** Every field typed into one box: split on commas and white space, blanks and repeats dropped. */
export function parseFields(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/))].filter((name) => name !== '')
}

/** Why the server would refuse `fields` as a project's, or `undefined` when it takes them. */
export function fieldsProblem(fields: readonly string[], t: TFunction<'project'>): string | undefined {
  if (fields.length > IGNORED_FIELDS_MAX) {
    return t('validation.ignored_fields_max', { max: String(IGNORED_FIELDS_MAX) })
  }
  const long = fields.find((name) => characterCount(name) > IGNORED_FIELD_MAX_LENGTH)
  return long === undefined
    ? undefined
    : t('validation.ignored_field_long', { max: String(IGNORED_FIELD_MAX_LENGTH) })
}

/** A field joins the chips when it is short enough and the list has room. */
export function fieldChipRules(t: TFunction<'project'>): ChipRules {
  return {
    parse: parseFields,
    refusal: (name, count) => {
      if (characterCount(name) > IGNORED_FIELD_MAX_LENGTH) {
        return t('validation.ignored_field_long', { max: String(IGNORED_FIELD_MAX_LENGTH) })
      }
      return count >= IGNORED_FIELDS_MAX
        ? t('validation.ignored_fields_max', { max: String(IGNORED_FIELDS_MAX) })
        : undefined
    },
  }
}
