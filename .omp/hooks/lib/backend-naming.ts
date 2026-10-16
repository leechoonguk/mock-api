// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { layerFiles } from "./backend-layout.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { resolveProjectRoot } from "./hook-project-root.ts";

/**
 * Domain naming checks — module-private functions, conftest registration
 * (backend-naming.md).
 *
 * Validates:
 *   - module-level functions never referenced by another module are `_`-prefixed
 *   - a `_`-prefixed name is never imported by another module
 *   - every CRUD model is imported in tests/conftest.py
 *
 * Pure validation — no ast-grep, no side effects. Called by the
 * check-backend-domain orchestrator.
 */

const projectRoot = resolveProjectRoot();

export function checkDomainNaming(): string[] {
  const issues: string[] = [];
  const base = join(projectRoot, "backend", "app");

  issues.push(...checkModulePrivateFunctions(base));
  issues.push(...checkPrivateMethods(base));
  issues.push(...checkPrivateImports(base));
  issues.push(...checkConftestModelImports(base));
  issues.push(...checkSectionDividers(base));

  return issues;
}

/**
 * A method the class calls on itself and nothing else calls is private.
 *
 * The sibling check below reads module-level functions only — its regex is
 * anchored at column zero — so a helper that lives inside a class was invisible
 * to it. Measured: `IntegrationOperationService.create_call_log` was reachable
 * from every caller in the process while serving exactly one line of its own
 * class, and no gate said a word.
 *
 * A method is PUBLIC (no `_` required) when any other module in `app/` names
 * it. Tests deliberately do not count: a method only its own class and its own
 * test touch is an internal step, and the test can name it with the underscore.
 *
 * Every module under `app/`, with no layer carved out. The one exemption this
 * check started with (`core/`) existed for a single row — a scheduler state
 * query nothing but its own class called — and an exemption kept for one file
 * is a rule that stops meaning what it says.
 */
function checkPrivateMethods(base: string): string[] {
  const issues: string[] = [];
  const sources = new Map<string, string>();
  for (const path of listAppPython(base)) sources.set(path, readFileSync(path, "utf-8"));

  for (const [path, source] of sources) {
    for (const declaration of source.matchAll(/^    (?:async )?def (\w+)\(/gm)) {
      const name = declaration[1];
      if (name.startsWith("_")) continue;
      if (!new RegExp(`self\\.${name}\\(`).test(source)) continue;
      const namedElsewhere = [...sources].some(
        ([other, text]) => other !== path && new RegExp(`\\b${name}\\b`).test(text),
      );
      if (namedElsewhere) continue;
      issues.push(
        `${path.slice(base.length + 1)}: \`${name}\` is called only by its own class — ` +
          "prefix it `_` so the class's public surface is what callers actually use",
      );
    }
  }
  return issues;
}

/**
 * Section divider standard (backend-naming.md "Section Dividers").
 *
 * Every module in backend/app/ is split into labeled sections by
 * `# ====...====` divider pairs. Validates:
 *   - every .py module (except __init__.py) has at least one divider pair
 *   - the first divider pair is `# Imports` and precedes any code
 *   - section names come from the canonical set
 *   - section order follows the canonical order (Imports → Constants →
 *     Classes → Functions → Dependencies → Router → …)
 */
function checkSectionDividers(base: string): string[] {
  const issues: string[] = [];
  /**
   * The vocabulary only. **Order is `check-code-layout`'s**, and used to be
   * declared here too — in a different order.
   *
   * The two disagreed about where a router's private helpers go: this file put
   * `Functions` before `Router`, `check-code-layout` after it. A router with one
   * helper could satisfy neither, which is how the contradiction surfaced. Order
   * belongs to the check whose rule states the principle it follows — a file
   * reads top-down from its entry point to its details — so the copy here is
   * gone rather than kept in sync by hand (`omp-hooks.md`: one invariant, one
   * owner).
   */
  const SECTION_VOCABULARY = [
    "Imports",
    "Constants",
    "Classes",
    "Functions",
    "Dependencies",
    "Router",
    "Middleware",
    "Lifespan",
    "App Setup",
    "Router Registration",
  ];
  const pyFiles: string[] = listAppPython(base);
  const mainPy = join(base, "main.py");
  if (existsSync(mainPy)) pyFiles.push(mainPy);

  for (const path of pyFiles) {
    const fileName = path.split("/").pop() ?? "";
    const lines = readFileSync(path, "utf-8").split("\n");
    const names: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (/^# ={60}$/.test(lines[i]) && i + 1 < lines.length) {
        const name = lines[i + 1].match(/^# ([A-Z][A-Za-z ]+)$/);
        if (name) names.push(name[1]);
      }
    }
    if (names.length === 0) {
      issues.push(
        `${fileName}: missing section dividers — every module needs ` +
          "`# ====...====` / `# <Section>` pairs (backend-naming.md)",
      );
      continue;
    }
    if (names[0] !== "Imports") {
      issues.push(`${fileName}: first section must be "Imports" (found "${names[0]}")`);
    }
    const firstCode = lines.findIndex(
      (l: string) => l && !l.startsWith("#") && !l.startsWith('"""') && !l.startsWith("'''"),
    );
    const firstDivider = lines.findIndex((l: string) => /^# ={60}$/.test(l));
    if (firstCode !== -1 && firstDivider > firstCode) {
      issues.push(`${fileName}: code appears before the first section divider`);
    }
    // Import order, grouping and the blank lines after the block are owned by
    // ruff's `I` rules (`lines-after-imports = 2`). This file used to *require*
    // `# isort: off` / `# isort: on` around the block, on the theory that isort
    // would otherwise absorb the divider comments — measured false: ruff leaves
    // a banner in place whether or not a blank line separates it. What is left
    // is the inverse claim: nothing may switch the sorter off locally, or the
    // order stops being a standard and becomes a per-file opinion.
    lines.forEach((line: string, index: number) => {
      if (/^\s*#\s*isort:\s*\S/.test(line) || /#\s*(?:ruff:\s*)?noqa:[^\n]*\bI0\d\d\b/.test(line)) {
        issues.push(
          `${fileName}:${index + 1}: import-order suppression (${line.trim()}) — ` +
            "ruff's I rules own the import block; there is no local exemption",
        );
      }
    });
    for (const name of names) {
      if (!SECTION_VOCABULARY.includes(name)) {
        issues.push(
          `${fileName}: unknown section "${name}" — use one of ${SECTION_VOCABULARY.join(", ")}`,
        );
      }
    }
  }
  return issues;
}

/**
 * A `_`-prefixed name belongs to the module that declares it.
 *
 * Without this, the sibling check below is one rename away from meaningless: a
 * helper that does not belong in a layer passes every gate by being called
 * `_helper` and imported anyway. Python enforces nothing here — the underscore
 * is a claim about who may call, and this is what makes the claim true.
 */
function checkPrivateImports(base: string): string[] {
  const issues: string[] = [];
  for (const path of listAppPython(base)) {
    const source = readFileSync(path, "utf-8");
    for (const statement of source.matchAll(
      /^from\s+(app[\w.]*)\s+import\s+(?:\(([^)]*)\)|([^\n]*))/gm,
    )) {
      const module = statement[1];
      const imported = statement[2] ?? statement[3] ?? "";
      for (const name of imported.split(",")) {
        const symbol = name.trim().split(/\s+/)[0];
        if (!symbol.startsWith("_")) continue;
        issues.push(
          `${path.slice(base.length + 1)}: imports \`${symbol}\` from ${module} — ` +
            "an underscore name is private to its own module; export it under a " +
            "public name, or move the logic to the caller",
        );
      }
    }
  }
  return issues;
}

/**
 * Scans backend/app/ for module-level functions that are never referenced by
 * any other module. Such functions are module-private and must be prefixed
 * with `_` (e.g. `_lifespan`). Cross-file analysis — ast-grep cannot express
 * "referenced elsewhere", so this scans other modules' contents directly.
 *
 * A function is PUBLIC (no `_` required) when any other module:
 *   - imports it (`from app.x import NAME`, or `import app.x` + `app.x.NAME`)
 *   - references it via `Depends(NAME)` (DI factory)
 *   - or the function itself is registered via a decorator (`@router.`, `@app.`)
 *     — FastAPI routes are public endpoints without imports.
 */
function checkModulePrivateFunctions(base: string): string[] {
  const issues: string[] = [];
  const pyFiles: string[] = listAppPython(base);
  const mainPy = join(base, "main.py");
  if (existsSync(mainPy)) pyFiles.push(mainPy);

  // Collect all module contents for cross-module reference scanning.
  const allContents = new Map<string, string>(); // path → content
  for (const p of pyFiles) {
    allContents.set(p, readFileSync(p, "utf-8"));
  }

  for (const [path, content] of allContents) {
    const fileName = path.split("/").pop() ?? "";
    const moduleName = fileName.replace(/\.py$/, "");

    // Module-level function definitions (no indentation), with their decorators.
    // Decorator line: @router.post("/", status_code=...) — capture the whole line.
    const defs = [...content.matchAll(/^(?:(@\S[^\n]*)\s*\n)?(async\s+)?def\s+(\w+)\s*\(/gm)];
    for (const m of defs) {
      const decorator = m[1] ?? "";
      const name = m[3];
      if (name.startsWith("_") || name.startsWith("__")) continue; // already private or dunder
      if (decorator.startsWith("@router.") || decorator.startsWith("@app.")) continue; // FastAPI route

      // Public if ANY other module references it: import, module.name, Depends().
      // Also public if the SAME module wires it into DI (Depends(NAME)) — DI
      // factories are exported via Annotated aliases, not direct imports.
      // Imports may be single-line or parenthesized multi-line.
      let isPublic = false;
      const importRe = new RegExp(
        `\\bfrom\\s+[\\w.]+\\s+import\\s+(?:[^\\n(]+|\\()[^)]*\\b${name}\\b`,
      );
      for (const [otherPath, otherContent] of allContents) {
        if (otherPath === path) {
          if (new RegExp(`\\bDepends\\(\\s*${name}\\s*\\)`).test(otherContent)) { isPublic = true; break; }
          continue;
        }
        if (importRe.test(otherContent)) { isPublic = true; break; }
        if (new RegExp(`\\bimport\\s+[\\w.]*\\b${name}\\b`).test(otherContent)) { isPublic = true; break; }
        if (new RegExp(`\\b${moduleName}\\.${name}\\b`).test(otherContent)) { isPublic = true; break; }
        if (new RegExp(`\\bDepends\\(\\s*${name}\\s*\\)`).test(otherContent)) { isPublic = true; break; }
      }
      if (isPublic) continue;

      issues.push(
        `${fileName}: module-level function "${name}" is never referenced by ` +
          "another module — module-private functions must be prefixed with _ " +
          "(e.g. _lifespan)",
      );
    }
  }

  return issues;
}

/**
 * Every module under `backend/app/`, recursively, excluding `main.py` (callers
 * append it explicitly) and package markers.
 *
 * Walked, not listed. The eight-directory list this replaced missed two things
 * at once: a directory nobody had added to it, and - after the domain folders
 * landed - every file inside `models/integration/`, because it read one level
 * deep. Both were silent: the loop simply had fewer files to check.
 */
function listAppPython(base: string): string[] {
  const found: string[] = [];
  const walk = (directory: string): void => {
    if (!existsSync(directory)) return;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === "__pycache__") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!entry.name.endsWith(".py") || entry.name === "__init__.py") continue;
      if (directory === base && entry.name === "main.py") continue;
      found.push(path);
    }
  };
  walk(base);
  return found;
}

/**
 * Verifies that every CRUD model in app/models/ is imported in
 * tests/conftest.py. Without the import, Base.metadata.create_all() skips the
 * model's table in the in-memory SQLite test DB — tests then fail with
 * "no such table". Mirrors the alembic/env.py registration rule.
 */
function checkConftestModelImports(base: string): string[] {
  const issues: string[] = [];
  const modelDir = join(base, "models");
  // tests/ moved out of app/ — conftest lives at backend/tests/conftest.py.
  const conftestPath = join(projectRoot, "backend", "tests", "conftest.py");
  if (!existsSync(modelDir) || !existsSync(conftestPath)) return issues;

  const conftestContent = readFileSync(conftestPath, "utf-8");
  // A nested model is imported as `app.models.batch.run`, so the module path is
  // the file path with separators swapped — and a flat scan never reached those
  // files at all. Measured: deleting the `batch.run` import from conftest passed
  // while deleting `refresh` failed, so nine tables could vanish from the test
  // database without a word.
  for (const f of layerFiles(modelDir)) {
    if (f === "base.py") continue;
    const name = f.replace(/\.py$/, "").split("/").join(".");
    if (!new RegExp(`from app\\.models\\.${name} import(?:\\s+\\w+|\\s*\\()`).test(conftestContent)) {
      issues.push(
        `conftest.py: model "${name}" not imported — Base.metadata.create_all() ` +
          "skips its table in the test DB; add `from app.models.<name> import <Name>`",
      );
    }
  }
  return issues;
}
