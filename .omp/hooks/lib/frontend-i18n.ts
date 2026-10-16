/**
 * Translation key extraction — the data behind `check-frontend-i18n`.
 *
 * A missing key does not fail a build: i18next renders the key itself, so
 * `user.table.username` ships to a user. This module reads the locale objects
 * and every `t('...')` call site so the two can be compared mechanically.
 *
 * Namespace resolution is the part that cannot be done with a regex alone: `t`
 * means whatever namespace the file's `useTranslation(...)` gave it, and a file
 * commonly holds two or three aliases (`t`, `tCommon`, `tNav`).
 */

/** `export const ko = {` … the resource object's opening line. */
const RESOURCE_OPEN = /^export const (\w+) = \{$/;

/** `useTranslation('user')` with any destructured members, not just `t`. */
const USE_TRANSLATION = /const\s*\{([^}]*)\}\s*=\s*useTranslation\(\s*(?:['"](\w+)['"])?\s*\)/g;

/** One destructured member: `t` or `t: tCommon`. */
const T_BINDING = /^t(?:\s*:\s*(\w+))?$/;

/** A call with a single quoted literal: the only form that can be verified. */
const T_CALL = /\b(\w+)\(\s*['"]([\w.]+)['"]/g;

/** i18next's default namespace in this app (`defaultNS` in locales/i18n.ts). */
const DEFAULT_NAMESPACE = "common";

export interface KeyReference {
  namespace: string;
  key: string;
  line: number;
}

/**
 * Flattens a locale module into `namespace.dotted.key` strings.
 *
 * The resource files are plain nested object literals with one key per line
 * (`code-layout.md` keeps them that way), so indentation is the structure: a
 * line ending in `{` opens a level, `}` closes one, and anything with a value
 * is a leaf.
 */
export function parseLocaleKeys(source: string): Set<string> {
  const keys = new Set<string>();
  const stack: string[] = [];
  let started = false;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!started) {
      if (RESOURCE_OPEN.test(line)) started = true;
      continue;
    }
    if (line === "" || line.startsWith("//") || line.startsWith("*")) continue;

    const open = /^(\w+):\s*\{$/.exec(line);
    if (open !== null) {
      stack.push(open[1]);
      continue;
    }
    if (line.startsWith("}")) {
      if (stack.length === 0) break;
      stack.pop();
      continue;
    }
    const leaf = /^(\w+):\s*['"`]/.exec(line);
    if (leaf !== null) {
      keys.add([...stack, leaf[1]].join("."));
    }
  }
  return keys;
}

/**
 * Every verifiable `t('key')` in one file, resolved to a namespace.
 *
 * A dynamic key (`t(item.titleKey)`, a template literal) is skipped rather than
 * guessed at: reporting it as missing would be a false positive on correct code.
 */
export function parseKeyReferences(source: string): KeyReference[] {
  const namespaceByAlias = new Map<string, string>();
  for (const match of source.matchAll(USE_TRANSLATION)) {
    const namespace = match[2] ?? DEFAULT_NAMESPACE;
    for (const member of match[1].split(",")) {
      const binding = T_BINDING.exec(member.trim());
      if (binding !== null) namespaceByAlias.set(binding[1] ?? "t", namespace);
    }
  }
  if (namespaceByAlias.size === 0) return [];

  const references: KeyReference[] = [];
  source.split("\n").forEach((line: string, index: number) => {
    for (const match of line.matchAll(T_CALL)) {
      const namespace = namespaceByAlias.get(match[1]);
      if (namespace === undefined) continue;
      references.push({ namespace, key: match[2], line: index + 1 });
    }
  });
  return references;
}

/**
 * A locale string's placeholders and the names its call site passes.
 *
 * i18next leaves an unmatched placeholder in the output: `'{{user}}가 {{at}}에 수정'`
 * called with `{ actor, at }` renders the literal `{{user}}` on the screen, and
 * every existing check stays green because the key exists and is translated. That
 * is exactly what shipped in the record dialog's audit line — caught by eye, not
 * by a check, which is the whole reason this comparison exists.
 *
 * Only literal option objects are read. `t(key, values)` where `values` is a
 * variable is skipped rather than guessed at.
 */
export interface InterpolationUse {
  namespace: string;
  key: string;
  names: Set<string>;
  line: number;
}

/** `t('key', { a, b: c })` — the option object as written, one line or many. */
const T_CALL_WITH_VALUES = /\b(\w+)\(\s*['"]([\w.]+)['"]\s*,\s*\{([^{}]*)\}/g;

export function parseInterpolationUses(source: string): InterpolationUse[] {
  const namespaceByAlias = new Map<string, string>();
  for (const match of source.matchAll(USE_TRANSLATION)) {
    const namespace = match[2] ?? DEFAULT_NAMESPACE;
    for (const member of match[1].split(",")) {
      const binding = T_BINDING.exec(member.trim());
      if (binding !== null) namespaceByAlias.set(binding[1] ?? "t", namespace);
    }
  }
  if (namespaceByAlias.size === 0) return [];

  const uses: InterpolationUse[] = [];
  const flattened = source.replace(/\n\s*/g, " ");
  for (const match of flattened.matchAll(T_CALL_WITH_VALUES)) {
    const namespace = namespaceByAlias.get(match[1]);
    if (namespace === undefined) continue;
    const names = new Set(
      match[3]
        .split(",")
        .map((entry: string) => entry.split(":")[0].trim())
        .filter((name: string) => /^\w+$/.test(name)),
    );
    if (names.size === 0) continue;
    const at = source.split("\n").findIndex((line: string) => line.includes(`'${match[2]}'`));
    uses.push({ namespace, key: match[2], names, line: at + 1 });
  }
  return uses;
}

/** `{{name}}` placeholders in one locale string, in the order they appear. */
export function placeholdersOf(value: string): Set<string> {
  return new Set([...value.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]));
}

/** Flattens a locale module to `namespace.dotted.key` → the string it holds. */
export function parseLocaleValues(source: string): Map<string, string> {
  const values = new Map<string, string>();
  const stack: string[] = [];
  let started = false;

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim();
    if (!started) {
      if (RESOURCE_OPEN.test(line)) started = true;
      continue;
    }
    if (line === "" || line.startsWith("//") || line.startsWith("*")) continue;

    const open = /^(\w+):\s*\{$/.exec(line);
    if (open !== null) {
      stack.push(open[1]);
      continue;
    }
    // Any line opening with a brace closes a level — `},` is the common form, and
    // matching only a bare `}` left the stack full and every key mis-nested.
    if (line.startsWith("}")) {
      if (stack.length === 0) break;
      stack.pop();
      continue;
    }
    const leaf = /^(\w+):\s*(['"`])([\s\S]*?)\2/.exec(line);
    if (leaf !== null) values.set([...stack, leaf[1]].join("."), leaf[3]);
  }
  return values;
}
