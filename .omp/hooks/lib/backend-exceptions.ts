// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { resolveProjectRoot } from "./hook-project-root.ts";

/**
 * Core exception policy — cross-file half (backend-exceptions.md).
 *
 * The single-file half is AST rules (`ast-grep/rules/exceptions/`): no builtin raise,
 * no `HTTPException`, no stored instance. What a pattern cannot see is whether a
 * raised name is *defined in core* and whether it is *handled* — both need two
 * files at once, so they live here:
 *
 *   1. every `raise X(...)` in `backend/app/` names a class declared in
 *      `app/core/exceptions.py` (or the declared third-party allowlist)
 *   2. every core exception has exactly one handler in
 *      `setup_exception_handler`, and every handler maps a class that exists
 *   3. every handler returns the uniform error body (`detail`, `code`,
 *      `request_id`) so clients can branch on `code`, not on prose
 *   4. exception classes are named `*Error`
 *
 * Pure validation — no side effects.
 */

const projectRoot = resolveProjectRoot();
const appDir = join(projectRoot, "backend", "app");
const exceptionsModule = join(appDir, "core", "exceptions.py");

/**
 * Third-party exceptions the handler layer maps on purpose. Each entry states
 * why the class cannot be a core class: it is raised by a library, not by us.
 */
const EXTERNAL_HANDLED: Record<string, string> = {
  IntegrityError: "raised by the driver on a constraint violation; mapped to 409 rather than a 500",
  StaleDataError: "raised by SQLAlchemy's optimistic lock (version_id_col)",
};

/**
 * Names owned by `ast-grep/rules/exceptions/`. Reporting them here too would mean two
 * owners for one invariant — and the AST rules are the precise ones: they know a
 * `ValueError` inside a Pydantic validator is the framework's contract, which a
 * name scan cannot see.
 */
const AST_OWNED: Record<string, true> = {
  ValueError: true,
  RuntimeError: true,
  Exception: true,
  KeyError: true,
  TypeError: true,
  AssertionError: true,
  NotImplementedError: true,
  HTTPException: true,
};

const RAISE_CALL = /^\s*raise\s+([A-Z]\w*)\s*\(/gm;
const CLASS_DEF = /^class\s+(\w+)\s*\(([^)]*)\)\s*:/gm;
const HANDLER = /@app\.exception_handler\((\w+)\)/g;

/** One response shape for every failure: clients branch on `code`, not prose. */
const REQUIRED_BODY_KEYS = ["detail", "code", "REQUEST_ID_KEY"];

export function checkBackendExceptions(): string[] {
  const issues: string[] = [];
  if (!existsSync(exceptionsModule)) {
    return ["core/exceptions.py is missing — every raised exception is defined there"];
  }
  const source = readFileSync(exceptionsModule, "utf-8");
  const defined = new Set([...source.matchAll(CLASS_DEF)].map((match) => match[1]));

  issues.push(...checkNaming(defined));
  issues.push(...checkRaisedNames(defined));
  issues.push(...checkHandlers(source, defined));
  issues.push(...checkHandlerBodies(source));
  issues.push(...checkCodeShape(source));
  issues.push(...checkCodeCarriesTheCause(source));
  return issues;
}

/** A `*Error` suffix is what makes a raise site readable at a glance. */
function checkNaming(defined: Set<string>): string[] {
  const issues: string[] = [];
  for (const name of defined) {
    if (!name.endsWith("Error")) {
      issues.push(
        `core/exceptions.py: ${name} does not end in "Error" — the suffix is what marks a ` +
          "class as raisable at its use site",
      );
    }
  }
  return issues;
}

/** Every raised class is a core class: one vocabulary, one handler layer. */
function checkRaisedNames(defined: Set<string>): string[] {
  const issues: string[] = [];
  for (const path of walk(appDir)) {
    const source = readFileSync(path, "utf-8");
    const label = relative(path);
    for (const match of source.matchAll(RAISE_CALL)) {
      const name = match[1];
      if (AST_OWNED[name] === true) continue; // ast-grep/rules/exceptions/ owns these
      if (defined.has(name) || EXTERNAL_HANDLED[name] !== undefined) continue;
      const line = source.slice(0, match.index ?? 0).split("\n").length;
      issues.push(
        `${label}:${line}: raise ${name}() is not defined in app/core/exceptions.py — ` +
          "define it there with a handler, or raise an existing core exception",
      );
    }
  }
  return issues;
}

/** Class ↔ handler, both ways: an unhandled core exception answers 500. */
function checkHandlers(source: string, defined: Set<string>): string[] {
  const issues: string[] = [];
  const handled = [...source.matchAll(HANDLER)].map((match) => match[1]);
  const handledSet = new Set(handled);

  for (const name of defined) {
    if (handledSet.has(name)) continue;
    // A subclass may be answered by its parent's handler, but only if the parent
    // is handled — otherwise the whole branch is unmapped.
    const parents = parentsOf(source, name);
    if (parents.some((parent) => handledSet.has(parent))) continue;
    issues.push(
      `core/exceptions.py: ${name} has no @app.exception_handler — an unhandled exception ` +
        "escapes as 500 with a stack trace instead of the uniform error body",
    );
  }
  // The allowlist is not only permission, it is a requirement: `StaleDataError`
  // is what `version_id_col` raises on every table, and with no handler the
  // optimistic lock answers a stack-traced 500 instead of 409 `stale_version` -
  // the code the frontend maps to "reload". Measured: deleting the handler left
  // every gate green.
  for (const name of Object.keys(EXTERNAL_HANDLED)) {
    if (handledSet.has(name)) continue;
    issues.push(
      `core/exceptions.py: ${name} has no @app.exception_handler - it is ` +
        `${EXTERNAL_HANDLED[name]}, and unmapped it escapes as 500 on every concurrent write`,
    );
  }
  for (const name of handled) {
    if (defined.has(name) || EXTERNAL_HANDLED[name] !== undefined) continue;
    issues.push(
      `core/exceptions.py: handler registered for ${name}, which is not defined here — ` +
        "an intentional third-party mapping must be declared in the rule and the allowlist",
    );
  }
  for (const [name, count] of countBy(handled)) {
    if (count > 1) {
      issues.push(`core/exceptions.py: ${count} handlers registered for ${name} — the last wins`);
    }
  }
  return issues;
}

/** One response shape: clients branch on `code`, never on prose. */
function checkHandlerBodies(source: string): string[] {
  const issues: string[] = [];
  const blocks = source.split(/@app\.exception_handler\(/).slice(1);
  for (const block of blocks) {
    const name = /^(\w+)\)/.exec(block)?.[1] ?? "unknown";
    const body = block.split(/\n@app\.exception_handler\(/)[0];
    for (const key of REQUIRED_BODY_KEYS) {
      if (!body.includes(key)) {
        issues.push(
          `core/exceptions.py: ${name} handler response is missing ${key} — every error body ` +
            "carries detail, code and request_id",
        );
      }
    }
    if (!/status_code=\d{3}/.test(body)) {
      issues.push(`core/exceptions.py: ${name} handler declares no explicit status_code`);
    }
  }
  return issues;
}

/**
 * A code is an identifier the client can branch on, and a locale can key on.
 *
 * `errors.<code>` is how the sentence is found, so a code with a space, a
 * capital or a hyphen resolves to no key and the UI falls back to the generic
 * sentence — the failure still reaches the user, wearing the wrong words.
 */
function checkCodeShape(source: string): string[] {
  const issues: string[] = [];
  const shape = /^[a-z][a-z0-9_]*$/;
  for (const match of source.matchAll(/"code":\s*"([^"]*)"/g)) {
    if (shape.test(match[1])) continue;
    issues.push(
      `core/exceptions.py: code "${match[1]}" is not a snake_case identifier — it is ` +
        "the locale key (`errors.<code>`) and a client's branch label, not prose",
    );
  }
  for (const match of source.matchAll(/^(\w*_CODE)\s*=\s*"([^"]*)"/gm)) {
    if (shape.test(match[2])) continue;
    issues.push(
      `core/exceptions.py: ${match[1]} = "${match[2]}" is not a snake_case identifier`,
    );
  }
  return issues;
}

/**
 * A cause the client must tell apart is a **code**, never a sentence.
 *
 * The contract this repository states is that the backend composes codes and the
 * frontend translates them: `detail` is a log line, and no screen may render it
 * (`check-frontend-i18n` refuses `.detail` reaching a toast or JSX). So when one
 * exception class carries nothing but `detail` and is raised for two different
 * reasons, the difference exists **only** in the string nobody is allowed to
 * read, and every one of those failures reaches the user as one sentence.
 *
 * Measured before this fired: `ConflictError` had eight raise sites — a taken
 * username, a taken email, a taken provider code, a duplicate secret name, a
 * secret still referenced, a batch already running, an unregistered job, and a
 * missing scheduler — all arriving as `conflict`, all rendering
 * `이미 사용 중인 값입니다`. The form could not put "username taken" on the
 * username field, and `BatchFormDialog` had guessed `conflict: 'name'` for
 * failures that are not about a name at all.
 *
 * Exempt, by construction rather than by name:
 *
 * - a class with **no** `detail` (`NotFoundError` carries an id, and every raise
 *   means the same thing);
 * - a class that already takes a `code` (`IntegrationConfigurationError` — the
 *   form this check asks for);
 * - a class carrying structured fields beyond `detail` (`IntegrationError` hands
 *   back `envelope_key`/`envelope_value`, which is what a caller branches on);
 * - a class raised once, which has one cause by construction.
 */
function checkCodeCarriesTheCause(source: string): string[] {
  const issues: string[] = [];
  for (const [name, attributes] of exceptionAttributes(source)) {
    if (!attributes.has("detail")) continue;
    const raises = raiseArguments(name);

    // A class that takes a `code` is the shape this check asks for. What it does
    // **not** ask is that every raise name one: a default is the unnamed
    // remainder, and `IntegrationConfigurationError` legitimately answers 40
    // operator-facing misconfigurations with one category while two
    // form-facing causes (`provider_code_invalid`, `provider_base_url_invalid`)
    // name themselves. Demanding 40 codes would be a worse vocabulary, and
    // which causes a *user* must tell apart is judgement no check can make.
    //
    // What is mechanical: a `code` parameter that **no** raise site ever passes.
    // That is a signature added and never adopted — measured on this very change,
    // where `IntegrationInputError` gained the parameter and kept answering its
    // two causes with one default.
    if (attributes.has("code")) {
      if (raises.length < 2 || raises.some((argument: string) => /,/.test(argument))) continue;
      issues.push(
        `core/exceptions.py: ${name} takes a \`code\` that no raise site passes — ` +
          `${raises.length} causes still share the default, so the parameter changed ` +
          "the signature and nothing else",
      );
      continue;
    }


    if (attributes.size > 1) continue;
    const details = [...new Set(raises)];
    if (details.length < 2) continue;
    issues.push(
      `core/exceptions.py: ${name} carries only \`detail\` and is raised for ` +
        `${details.length} different reasons (${details.slice(0, 3).join(" / ")}…) — ` +
        "the client sees one code for all of them, so give it a `code` parameter and " +
        "name each cause",
    );
  }
  return issues;
}

/** Each exception class and the instance attributes its `__init__` assigns. */
function exceptionAttributes(source: string): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  const blocks = source.split(/^class /m).slice(1);
  for (const block of blocks) {
    const name = /^(\w+)\s*\(/.exec(block)?.[1];
    if (name === undefined) continue;
    const body = block.split(/\n@app\.exception_handler/)[0];
    const attributes = new Set<string>(
      [...body.matchAll(/^\s+self\.(\w+)\s*=/gm)].map((match) => match[1]),
    );
    found.set(name, attributes);
  }
  return found;
}

/** The argument text of every `raise <Name>(...)` in `app/`, one entry per site. */
function raiseArguments(name: string): string[] {
  const found: string[] = [];
  // 400, not 120: a raise whose detail alone exceeds the window falls out of
  // the list entirely, and every degradation from that is toward silence —
  // measured with a padded detail that made the site vanish rather than count.
  const pattern = new RegExp(`raise\\s+${name}\\s*\\(\\s*([\\s\\S]{0,400}?)\\)`, "g");
  for (const file of walk(appDir)) {
    if (relative(file) === "core/exceptions.py") continue;
    for (const match of readFileSync(file, "utf-8").matchAll(pattern)) {
      const argument = match[1].replace(/\s+/g, " ").trim();
      if (argument.length > 0) found.push(argument);
    }
  }
  return found;
}

// ============================================================
// Helpers
// ============================================================

function parentsOf(source: string, name: string): string[] {
  const match = new RegExp(`^class\\s+${name}\\s*\\(([^)]*)\\)`, "m").exec(source);
  return match === null ? [] : match[1].split(",").map((parent: string) => parent.trim());
}

function countBy(names: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  return counts;
}

/** Every .py file under app/, excluding caches. Validators are AST-scoped. */
function walk(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__pycache__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walk(path));
      continue;
    }
    if (entry.name.endsWith(".py")) found.push(path);
  }
  return found;
}

function relative(path: string): string {
  return path.startsWith(projectRoot) ? path.slice(projectRoot.length + 1) : path;
}
