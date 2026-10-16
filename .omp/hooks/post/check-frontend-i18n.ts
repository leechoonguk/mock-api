import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import {
  parseInterpolationUses,
  parseKeyReferences,
  parseLocaleKeys,
  parseLocaleValues,
  placeholdersOf,
} from "../lib/frontend-i18n.ts";
import {
  SRC_DIRECTORIES,
  frontendSrc,
  projectRoot,
  readIfPresent,
  readSources,
  stripComments,
} from "../lib/frontend-source.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Frontend-I18n Post Hook
 *
 * Validates the translation contract from .omp/rules/frontend-i18n.md:
 *
 *   1. every language declares the same keys — i18next falls back silently, so
 *      a key added to `ko` and missed in `en` is only visible to an English user
 *   2. every verifiable `t('key')` resolves in its namespace — a missing key
 *      renders as the key itself, in production, with no error anywhere
 *   3. no user-visible Korean literal outside `locales/` — text that bypassed
 *      i18n cannot be translated at all
 *   4. every backend error code has a translated message, both ways — the UI
 *      reads `errors.<code>`, so a code with no key says nothing to the user
 *   5. no server string rendered as copy — `detail` is English for a log
 *   6. the language survives a reload and is the first painted — `lng` read
 *      from storage under the theme's own `app-settings` key
 *   7. dates follow the app's language, never a fixed or the browser's locale
 *   8. a text box acting on Enter skips the Enter that ends an IME composition
 *
 * This is a read-only check — it does NOT block tool calls.
 */

/**
 * The language files, discovered from `locales/` rather than listed.
 *
 * Measured as a list of two: adding `locales/ja.ts` with a single key passed
 * every check. Parity is this hook's whole job, and it was scoped to the two
 * languages that existed when it was written.
 */
const LOCALES = discoverLocales();

/** Hangul syllables and jamo — the alphabet a hardcoded string would use. */
const HANGUL = /[\uac00-\ud7a3\u3131-\u318e]/;

/** The one message with no server code: a request that never reached a handler. */
const FALLBACK_ERROR_KEY = "unknown";

/**
 * Reading a server sentence off an error: the anti-pattern the code map
 * replaces.
 *
 * The receiver may be an identifier (`apiError.message`) or a call result
 * (`toApiError(error).message`). The first version of this check only knew the
 * identifier shape and reported PASS on the call shape — found by falsification,
 * not by reading it again.
 *
 * `.detail(` is excluded: that is a query key or a service method, not a field.
 * A line mentioning `formState` is react-hook-form's own error, whose message a
 * locale file already produced.
 */
const SERVER_TEXT = /\b(?:\w*[Ee]rror|toApiError\([^)]*\))\??\.(?:message|detail)(?!\()/;

const RHF_STATE = /formState/;

/** `{query.error.message}` — the same string, rendered straight into JSX. */
const SERVER_TEXT_IN_JSX = /\{[^{}]*\.(?:message|detail)(?!\()[^{}]*\}/;

/** A translated literal: fine anywhere except as the answer to a failure. */
const LITERAL_MESSAGE = /\bt\w*\(\s*'[^']+'/;

export default function checkFrontendI18n(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-frontend-i18n", event, () => {
    if (!touchesPath(event, ["frontend/"])) return;
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkFrontendI18nSync();
    if (issues.length === 0) {
      resetSuppression("check-frontend-i18n");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-frontend-i18n",
      issues,
      "run make check-frontend-i18n for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-frontend-i18n") };
  }));
}

/**
 * The languages the app declares in `locales/i18n.ts` (`SUPPORTED_LANGUAGES`),
 * `ko` first because the report reads best against the source language.
 *
 * The app's own registry is the source, not a list here and not every `.ts` in
 * the directory: `i18n.ts` itself lives there, and reading filenames made the
 * config file a language whose "missing keys" filled the report.
 */
function discoverLocales(): string[] {
  // existence-ok: an absent i18n.ts empties LOCALES, and the entry sentinel reports that.
  const config = readIfPresent(join(SRC_DIRECTORIES.locales, "i18n.ts"));
  if (config === null) return [];
  const declared = /SUPPORTED_LANGUAGES\s*=\s*\[([^\]]*)\]/.exec(config);
  if (declared === null) return [];
  const found = [...declared[1].matchAll(/['"`]([a-z-]+)['"`]/g)].map((m) => m[1]);
  return [...found.filter((l: string) => l === "ko"), ...found.filter((l: string) => l !== "ko")];
}

/**
 * A language file nobody registered is dead copy; a registered language with no
 * file breaks at import. Both directions, because the registry and the
 * directory drift independently.
 */
function checkLocaleRegistry(): string[] {
  const issues: string[] = [];
  const directory = SRC_DIRECTORIES.locales;
  if (!existsSync(directory)) return issues;
  // A `.d.ts` carries no resources — `i18next.d.ts` declares the *types* of the
  // ones beside it, so reading it as a language would demand a locale named
  // `i18next` and register nothing.
  const files = readdirSync(directory)
    .filter(
      (f: string) =>
        f.endsWith(".ts") && !f.endsWith(".d.ts") && f !== "i18n.ts" && f !== "index.ts",
    )
    .map((f: string) => f.replace(/\.ts$/, ""));
  // An empty locale set is never a clean state: the app initialises i18next
  // from SUPPORTED_LANGUAGES, so either `i18n.ts` moved or the constant was
  // renamed — and every check below would run against nothing while reporting
  // PASS (the CLI crashed instead, on `LOCALES[0]!`; the runtime guard would
  // have swallowed that crash and retired the check silently).
  if (LOCALES.length === 0) {
    return [
      "frontend/src/locales/i18n.ts: SUPPORTED_LANGUAGES not found — every locale " +
        "check runs against an empty set, so parity, error codes and referenced " +
        "keys are all unverified",
    ];
  }
  const registered = new Set(LOCALES);
  for (const name of files) {
    if (!registered.has(name)) {
      issues.push(
        `frontend/src/locales/${name}.ts: not in SUPPORTED_LANGUAGES — an unregistered ` +
          "language file is never loaded and never checked for parity",
      );
    }
  }
  for (const name of registered) {
    if (!files.includes(name)) {
      issues.push(
        `frontend/src/locales/i18n.ts: SUPPORTED_LANGUAGES names '${name}' with no ` +
          `${name}.ts — the import fails at startup`,
      );
    }
  }
  return issues;
}

/**
 * A locale string's placeholders and the names its call site passes.
 *
 * i18next leaves an unmatched placeholder in the output, so
 * `{{user}}가 {{at}}에 수정` called with `{ actor, at }` renders the literal
 * `{{user}}` — and every other check stays green, because the key exists and is
 * translated in both locales. That is what shipped in the record dialog's audit
 * line, caught by eye. This compares the two sets instead.
 */
function checkInterpolationNames(): string[] {
  const issues: string[] = [];
  const values = new Map<string, string>();
  for (const locale of LOCALES) {
    const source = readIfPresent(join(SRC_DIRECTORIES.locales, `${locale}.ts`));
    if (source === null) continue;
    for (const [key, value] of parseLocaleValues(source)) {
      if (!values.has(key)) values.set(key, value);
    }
  }

  const scanned = [
    SRC_DIRECTORIES.sections,
    SRC_DIRECTORIES.components,
    SRC_DIRECTORIES.pages,
    SRC_DIRECTORIES.layouts,
  ].flatMap((directory) => readSources(directory));
  for (const file of scanned) {
    for (const use of parseInterpolationUses(file.content)) {
      const value = values.get(`${use.namespace}.${use.key}`);
      if (value === undefined) continue;
      const declared = placeholdersOf(value);
      if (declared.size === 0) continue;
      const missing = [...declared].filter((name) => !use.names.has(name));
      if (missing.length > 0) {
        issues.push(
          `${file.label}:${use.line}: t('${use.key}') passes {${[...use.names].join(", ")}} but the ` +
            `string needs {{${missing.join("}}, {{")}}} — i18next renders the placeholder itself, ` +
            "so the screen shows the braces",
        );
      }
    }
  }
  return issues;
}

export function checkFrontendI18nSync(): string[] {
  const issues: string[] = [];
  if (!existsSync(frontendSrc)) return ["frontend/src/: directory not found"];

  // Before parity: the registry and the directory must name the same languages.
  // An unregistered file is reported even when parity cannot run, because that
  // file is exactly the one parity would have skipped.
  issues.push(...checkLocaleRegistry());
  // With no locales there is nothing below to compare — and `LOCALES[0]!`
  // further down would crash on it, which the runtime guard swallows.
  if (LOCALES.length === 0) return issues;

  const keysByLocale = new Map<string, Set<string>>();
  for (const locale of LOCALES) {
    const source = readIfPresent(join(SRC_DIRECTORIES.locales, `${locale}.ts`));
    if (source === null) {
      issues.push(`frontend/src/locales/${locale}.ts: missing — the app declares this language`);
      continue;
    }
    keysByLocale.set(locale, parseLocaleKeys(source));
  }
  if (keysByLocale.size < LOCALES.length) return issues;

  issues.push(...checkLocaleParity(keysByLocale));
  issues.push(...checkReferencedKeys(keysByLocale.get(LOCALES[0])!));
  issues.push(...checkHardcodedText());
  issues.push(...checkErrorCodeParity(keysByLocale));
  issues.push(...checkServerTextRendering());
  issues.push(...checkFailureMapping());
  issues.push(...checkInterpolationNames());
  issues.push(...checkLanguageIsRemembered());
  issues.push(...checkDatesFollowTheLanguage());
  issues.push(...checkCompositionIsNotEnter());
  return issues;
}

function checkLocaleParity(keysByLocale: Map<string, Set<string>>): string[] {
  const issues: string[] = [];
  for (const locale of LOCALES) {
    for (const other of LOCALES) {
      if (locale === other) continue;
      for (const key of keysByLocale.get(locale)!) {
        if (!keysByLocale.get(other)!.has(key)) {
          issues.push(
            `frontend/src/locales/${other}.ts: no ${key} — ${locale}.ts declares it, and ` +
              "i18next falls back without telling anyone",
          );
        }
      }
    }
  }
  return issues;
}

/**
 * Every failure code the backend can emit has a translated message, and every
 * `errors.*` key answers a code that exists.
 *
 * The server sends `{ detail, code, request_id }`; `detail` is English written
 * for a log. The user reads `t('errors.<code>')`, so a code without a key is a
 * screen that shows nothing useful, and a key without a code is copy nobody can
 * reach.
 */
function checkErrorCodeParity(keysByLocale: Map<string, Set<string>>): string[] {
  const issues: string[] = [];
  const codes = collectErrorCodes();
  if (codes.size === 0) {
    return ["backend/app/core/exceptions.py: no error codes found — the handler contract is the source of the locale keys"];
  }

  for (const locale of LOCALES) {
    const keys = keysByLocale.get(locale)!;
    for (const code of codes) {
      if (!keys.has(`common.errors.${code}`)) {
        issues.push(
          `frontend/src/locales/${locale}.ts: no errors.${code} — the backend answers with ` +
            "that code and the screen would have nothing to say",
        );
      }
    }
    for (const key of keys) {
      if (!key.startsWith("common.errors.")) continue;
      const code = key.slice("common.errors.".length);
      if (code !== FALLBACK_ERROR_KEY && !codes.has(code)) {
        issues.push(
          `frontend/src/locales/${locale}.ts: errors.${code} answers no backend code — ` +
            "dead copy, or the code was renamed on the server",
        );
      }
    }
    if (!keys.has(`common.errors.${FALLBACK_ERROR_KEY}`)) {
      issues.push(
        `frontend/src/locales/${locale}.ts: no errors.${FALLBACK_ERROR_KEY} — a transport ` +
          "failure never reaches a handler, so it has no server code",
      );
    }
  }
  return issues;
}

/**
 * The server's own sentence must not reach the screen.
 *
 * Measured: every dialog caught its failures into one generic toast, and the
 * alternative an author reaches for is `toast.error(apiError.message)` — which
 * ships English into a Korean screen and hard-codes copy the frontend cannot
 * change.
 */
function checkServerTextRendering(): string[] {
  const issues: string[] = [];
  const hookForm = join(SRC_DIRECTORIES.components, "hook-form");
  for (const file of readSources(frontendSrc)) {
    if (file.path.startsWith(SRC_DIRECTORIES.lib) || file.path.startsWith(hookForm)) continue;
    file.content.split("\n").forEach((line: string, index: number) => {
      if (RHF_STATE.test(line)) return;
      if (SERVER_TEXT.test(line) || SERVER_TEXT_IN_JSX.test(line)) {
        issues.push(
          `${file.label}:${index + 1}: renders a server string — map the code through ` +
            "`errors.<code>` in locales/ instead",
        );
      }
    });
  }
  return issues;
}

/**
 * A failed request must say *what* failed.
 *
 * The opposite of rendering the server's English is answering every failure
 * with one literal key: measured on the login screen, where a 401 carrying
 * `authentication_failed` produced "로그인에 실패했습니다" — the same sentence an
 * unreachable database would have produced. So inside a `catch`, the message
 * comes from the code (`serverErrorMessage` / `applyServerError`), never from a
 * literal `t('...')`.
 */
function checkFailureMapping(): string[] {
  const issues: string[] = [];
  for (const file of readSources(frontendSrc)) {
    if (!file.path.startsWith(SRC_DIRECTORIES.sections)) continue;
    for (const match of file.content.matchAll(/\}\s*catch[^{]*\{([\s\S]*?)\n {4}\}/g)) {
      const body = match[1];
      if (!LITERAL_MESSAGE.test(body)) continue;
      if (/serverErrorMessage\(|applyServerError\(/.test(body)) continue;
      const line = file.content.slice(0, match.index).split("\n").length;
      issues.push(
        `${file.label}:${line}: a catch answers with a literal message — map the server ` +
          "`code` through `errors.<code>` so two different failures do not read alike",
      );
    }
  }
  return issues;
}

/**
 * Codes the handler layer emits, plus any a raise site declares.
 *
 * Three spellings, because all three exist: a literal in a handler body, a
 * literal at a raise site, and a module constant named `<THING>_CODE` that a
 * raise site passes. Reading only literals reported live codes as missing keys
 * and their keys as dead copy — measured on `provider_code_invalid`.
 *
 * Read from the whole of `backend/app/`, not a list of three modules. That list
 * named `services/integration.py`, and when the service became
 * `services/integration/provider.py` the constants moved with it: the codes
 * went missing, and two live translations were reported as dead copy.
 */
function collectErrorCodes(): Set<string> {
  const codes = new Set<string>();
  for (const source of backendSources(join(projectRoot, "backend", "app"))) {
    for (const match of source.matchAll(/"code":\s*"([a-z_]+)"/g)) codes.add(match[1]);
    for (const match of source.matchAll(/\bcode="([a-z_]+)"/g)) codes.add(match[1]);
    // A trailing comment is part of a line, not part of the code: a `# noqa`
    // beside a constant used to hide that constant from this reader, and the
    // locale entry answering it was then reported as dead copy.
    for (const match of source.matchAll(/^[A-Z][A-Z0-9_]*_CODE\s*=\s*"([a-z_]+)"\s*(?:#.*)?$/gm)) {
      codes.add(match[1]);
    }
  }
  return codes;
}

/** Every Python module under a backend directory, recursively. */
function backendSources(directory: string): string[] {
  if (!existsSync(directory)) return [];
  const sources: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "__pycache__") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) sources.push(...backendSources(path));
    else if (entry.name.endsWith(".py")) sources.push(readFileSync(path, "utf-8"));
  }
  return sources;
}

/** A key used by a screen must exist, or the screen renders the key. */
function checkReferencedKeys(known: Set<string>): string[] {
  const issues: string[] = [];
  for (const file of readSources(frontendSrc)) {
    if (file.path.startsWith(SRC_DIRECTORIES.locales)) continue;
    for (const reference of parseKeyReferences(file.content)) {
      const full = `${reference.namespace}.${reference.key}`;
      if (!known.has(full)) {
        issues.push(
          `${file.label}:${reference.line}: t('${reference.key}') resolves to ${full}, which ` +
            "no locale declares",
        );
      }
    }
  }
  return issues;
}

/**
 * Korean in a component is text that bypassed i18n. Korean in a **comment** is
 * an explanation — quoting the string a check is about (the grid footer's
 * "페이지 당 행") is how the reason survives; flagging it would push authors to
 * write vaguer comments.
 */
function checkHardcodedText(): string[] {
  const issues: string[] = [];
  for (const file of readSources(frontendSrc)) {
    if (file.path.startsWith(SRC_DIRECTORIES.locales)) continue;
    file.content.split("\n").forEach((line: string, index: number) => {
      const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
      if (HANGUL.test(code)) {
        issues.push(
          `${file.label}:${index + 1}: Korean text outside locales/ — put it in ` +
            "frontend/src/locales/ and read it through t()",
        );
      }
    });
  }
  return issues;
}

/**
 * The chosen language survives a reload and is the first one painted.
 * `i18n.ts` initialises `lng` from what it stored (never the bare
 * `DEFAULT_LANGUAGE`, which painted Korean and then swapped every word), stores
 * on `languageChanged`, and stores under the same `app-settings` key the theme
 * keeps its mode in - two keys spelled apart are two objects that overwrite
 * nothing of each other's and one of them is never read.
 */
function checkLanguageIsRemembered(): string[] {
  const issues: string[] = [];
  // existence-ok: checkLocaleRegistry reports a missing i18n.ts.
  const i18n = readIfPresent(join(SRC_DIRECTORIES.locales, "i18n.ts"));
  if (i18n === null) return issues;
  if (/\blng:\s*DEFAULT_LANGUAGE\b/.test(i18n) || !/\blng:\s*\w+\(\)/.test(i18n)) {
    issues.push("frontend/src/locales/i18n.ts: lng is not read from storage before init — a reload paints the default language, then swaps");
  }
  if (!/on\('languageChanged'[\s\S]{0,300}?store\w*\(/.test(i18n)) {
    issues.push("frontend/src/locales/i18n.ts: a language switch is not stored — the choice is gone on the next reload");
  }
  const key = /SETTINGS_KEY\s*=\s*'([^']+)'/.exec(i18n)?.[1];
  const settings = readIfPresent(join(frontendSrc, "theme", "settings.tsx"));
  const themeKey = settings === null ? undefined : /STORAGE_KEY\s*=\s*'([^']+)'/.exec(settings)?.[1];
  if (key === undefined || themeKey === undefined) {
    issues.push("frontend/src/locales/i18n.ts, frontend/src/theme/settings.tsx: no SETTINGS_KEY / STORAGE_KEY read — the shared settings key compared nothing");
  } else if (key !== themeKey) {
    issues.push(`frontend/src/locales/i18n.ts: stores under '${key}' but the theme keeps '${themeKey}' — one settings object, one key`);
  }
  return issues;
}

/**
 * A date or time is spelled in the reader's language: `formatDateTime` builds
 * its `Intl.DateTimeFormat` from `i18next.language`. A fixed locale printed
 * `2026. 9. 15. 오전 10:36` in every grid of the English UI, and a
 * `toLocaleDateString()` speaks the browser's language instead of the app's.
 */
function checkDatesFollowTheLanguage(): string[] {
  const issues: string[] = [];
  for (const file of readSources(frontendSrc)) {
    if (file.label.startsWith("frontend/src/locales/")) continue;
    file.content.split("\n").forEach((line: string, index: number) => {
      if (/^\s*(\*|\/\/)/.test(line)) return;
      if (/Intl\.DateTimeFormat\(\s*['"]/.test(line) || /\.toLocale(?:Date|Time)String\(/.test(line)) {
        issues.push(`${file.label}:${index + 1}: a date spelled in a fixed or the browser's locale — format through formatDateTime, which follows the app's language`);
      }
    });
  }
  return issues;
}

/**
 * Enter that ends a Hangul composition is not a send. A text box that acts on
 * Enter returns while `isComposing` (or `keyCode` 229, which Safari sends for
 * the composing Enter); otherwise the last syllable is sent and then typed
 * again into the emptied box.
 */
function checkCompositionIsNotEnter(): string[] {
  const issues: string[] = [];
  for (const file of readSources(frontendSrc)) {
    if (!file.label.endsWith(".tsx")) continue;
    const code = file.content;
    const textBox = /<(?:TextField|InputBase|OutlinedInput|input|textarea)\b/.test(code);
    if (!textBox || !/key\s*[!=]==?\s*'Enter'/.test(code)) continue;
    const live = stripComments(code);
    if (/isComposing/.test(live) && /\b229\b|IME_PROCESS_KEY/.test(live)) continue;
    issues.push(`${file.label}: a text box acts on Enter without an isComposing / keyCode 229 guard — the Enter that ends a Hangul syllable sends the message`);
  }
  return issues;
}

// Direct execution (make check-frontend-i18n): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-frontend-i18n.ts")) {
  const issues = checkFrontendI18nSync();
  console.log("==> check-frontend-i18n");
  if (issues.length === 0) {
    console.log("    PASS: every locale and every referenced key agree");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-frontend-i18n");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
