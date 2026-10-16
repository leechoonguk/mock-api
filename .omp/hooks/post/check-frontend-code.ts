import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { touchesPath } from "../lib/hook-scope.ts";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { frontendSrc, readSources } from "../lib/frontend-source.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { basename, join } from "node:path";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Frontend-Code Post Hook
 *
 * Validates the structural half of .omp/rules/frontend-code-conventions.md
 * across the whole of frontend/src (not just its top level):
 *
 *   1. the entry files exist: main.tsx, App.tsx, styles.css
 *   2. functional components only — no class components, no React.FC
 *   3. imports use the `@/` alias, never a relative path
 *   4. no hardcoded port or host in a component
 *   5. a component file is named after the component it default-exports
 *   6. every package imported from `src/` is declared in package.json
 *
 * Lint/typecheck/build are delegated to check-verify.ts; transport, screens,
 * routing, contract and i18n each have their own hook.
 *
 * This is a read-only check — it does NOT block tool calls.
 */

/** Files the entry point cannot be assembled without. */
const REQUIRED_FILES = ["main.tsx", "App.tsx", "styles.css"];

const CLASS_COMPONENT = /\bclass\s+\w+\s+extends\s+(?:React\.)?(?:Component|PureComponent)\b/;

const RELATIVE_IMPORT = /from\s+['"]\.\.?\//g;

/** `host:1234` — a port a component has no business knowing. */
const HARDCODED_PORT = /:\d{4,5}\b/;

const DEFAULT_EXPORT_NAME = /^export default (?:function|memo\()?\s*(\w+)/m;

/** A bare module specifier: `react`, `@mui/material`, not `@/lib/...`. */
const PACKAGE_IMPORT = /^import\s[^'"]*from\s+['"]((?:@(?!\/)[^/'"]+\/)?[^.@/][^'"]*)['"]/gm;

export default function checkFrontendCode(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-frontend-code", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["frontend/"])) return;

    const issues = checkFrontendCodeSync();
    if (issues.length === 0) {
      resetSuppression("check-frontend-code");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-frontend-code",
      issues,
      "run make check-frontend-code for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-frontend-code") };
  }));
}

export function checkFrontendCodeSync(): string[] {
  const issues: string[] = [];
  if (!existsSync(frontendSrc)) return ["frontend/src/: directory not found"];

  for (const required of REQUIRED_FILES) {
    if (!existsSync(join(frontendSrc, required))) {
      // premature-ok: 프로젝트 기반 파일의 부재는 작업 순서가 아니라 설정 결함이다 — 어느 단계에서든 참이다.
      issues.push(`frontend/src/${required}: missing — the entry point is incomplete`);
    }
  }

  const declared = declaredPackages();
  for (const file of readSources(frontendSrc)) {
    issues.push(...checkComponentShape(file.label, file.content));
    issues.push(...checkImports(file.label, file.content, declared));
  }
  return issues;
}

function checkComponentShape(fileLabel: string, content: string): string[] {
  const issues: string[] = [];
  if (CLASS_COMPONENT.test(content)) {
    issues.push(`${fileLabel}: class component — this codebase is functional components only`);
  }
  // A bare fetch() that never reads res.ok treats 4xx/5xx as success. Word-anchored:
  // `query.refetch()` is not a transport call.
  if (/(?<!\w)fetch\s*\(/.test(content) && !/\.ok\b/.test(content)) {
    issues.push(`${fileLabel}: fetch call without res.ok check`);
  }
  if (/\bReact\.FC\b/.test(content)) {
    issues.push(
      `${fileLabel}: React.FC — annotate the props parameter instead, so children is ` +
        "declared where it is used",
    );
  }
  content.split("\n").forEach((line: string, index: number) => {
    if (HARDCODED_PORT.test(line)) {
      issues.push(
        `${fileLabel}:${index + 1}: hardcoded port — the Vite proxy and config.ts own the host`,
      );
    }
  });

  if (!fileLabel.endsWith(".tsx")) return issues;
  const exported = DEFAULT_EXPORT_NAME.exec(content);
  if (exported !== null) {
    const expected = basename(fileLabel, ".tsx");
    if (exported[1] !== expected && expected !== "index") {
      issues.push(
        `${fileLabel}: default-exports ${exported[1]} — name the file after the ` +
          "component so an import names what it renders",
      );
    }
  }
  return issues;
}

function checkImports(fileLabel: string, content: string, declared: Set<string>): string[] {
  const issues: string[] = [];
  for (const match of content.matchAll(RELATIVE_IMPORT)) {
    issues.push(
      `${fileLabel}: relative import (${match[0].trim()}) — use the @/ alias so the ` +
        "import survives a move",
    );
  }
  for (const match of content.matchAll(PACKAGE_IMPORT)) {
    const pkg = packageName(match[1]);
    if (pkg !== null && !declared.has(pkg)) {
      issues.push(
        `${fileLabel}: imports ${pkg}, which frontend/package.json does not declare — ` +
          "the build works locally and fails on a clean install",
      );
    }
  }
  return issues;
}

/** `@mui/x-data-grid/locales` → `@mui/x-data-grid`; `react-dom/client` → `react-dom`. */
function packageName(specifier: string): string | null {
  if (specifier.startsWith("@")) {
    const parts = specifier.split("/");
    return parts.length < 2 ? null : `${parts[0]}/${parts[1]}`;
  }
  return specifier.split("/")[0];
}

function declaredPackages(): Set<string> {
  const manifestPath = join(frontendSrc, "..", "package.json");
  if (!existsSync(manifestPath)) return new Set();
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
  ]);
}

// Direct execution (make check-frontend-code): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-frontend-code.ts")) {
  const issues = checkFrontendCodeSync();
  console.log("==> check-frontend-code");
  if (issues.length === 0) {
    console.log("    PASS: frontend code follows frontend-code-conventions.md");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-frontend-code");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
