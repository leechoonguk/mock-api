/**
 * The rules a host obeys — `app/engine/hosts.py` read before the request, one
 * reading for the project form, the header's hosts editor and the endpoint
 * form, so each refuses what the server would.
 */

import type { TFunction } from 'i18next'
import type { ChipRules } from '@/sections/project/ChipsInput'

/** `HOSTS_MAX` in `app/schemas/project.py`: how many hosts one project intercepts. */
export const HOSTS_MAX = 20

/** `HOST_MAX_LENGTH` in `app/engine/hosts.py`: the longest host name DNS allows. */
export const HOST_MAX_LENGTH = 253

/** One DNS label: letters, digits and inner hyphens, at most 63 characters. */
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/

/** The prefix of a pattern that names every subdomain of what follows it. */
const WILDCARD_PREFIX = '*.'

/** `normalize_host`: the one spelling of a host — trimmed, lower-case, no trailing dot. */
export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.+$/, '')
}

/** `host_problem`: whether `pattern` is a host name or, with `wildcard`, a `*.suffix` pattern. */
export function hostIsValid(pattern: string, wildcard: boolean): boolean {
  const name = wildcard && pattern.startsWith(WILDCARD_PREFIX) ? pattern.slice(WILDCARD_PREFIX.length) : pattern
  if (name === '' || name.length > HOST_MAX_LENGTH) return false
  return name.split('.').every((label) => LABEL.test(label))
}

/**
 * Every host typed into one box, as the server will store them: split on
 * commas and white space, normalized, blanks and repeats dropped.
 */
export function parseHosts(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map(normalizeHost))].filter((host) => host !== '')
}

/** Why the server would refuse `hosts` as a project's, or `undefined` when it takes them. */
export function hostsProblem(hosts: readonly string[], t: TFunction<'project'>): string | undefined {
  if (hosts.length > HOSTS_MAX) return t('validation.hosts_max', { max: String(HOSTS_MAX) })
  const invalid = hosts.find((host) => !hostIsValid(host, true))
  return invalid === undefined ? undefined : t('validation.host_invalid', { host: invalid })
}

/** A host joins the chips when it is one and the list has room. */
export function hostChipRules(t: TFunction<'project'>): ChipRules {
  return {
    parse: parseHosts,
    refusal: (host, count) => {
      if (!hostIsValid(host, true)) return t('validation.host_invalid', { host })
      return count >= HOSTS_MAX ? t('validation.hosts_max', { max: String(HOSTS_MAX) }) : undefined
    },
  }
}
