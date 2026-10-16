import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { touchesPath } from "../lib/hook-scope.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { runAstRules } from "../lib/ast-rules.ts";
import { checkBackendExceptions } from "../lib/backend-exceptions.ts";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";

/**
 * Check-Backend-Exceptions Post Hook
 *
 * Orchestrates the core exception policy (backend-exceptions.md):
 *
 *   - `ast-grep/rules/exceptions/` — the single-file shape of a raise: no builtin
 *     exception (outside a Pydantic validator), no `HTTPException`, no stored
 *     instance raised by variable name
 *   - `lib/backend-exceptions.ts` — the cross-file half: every raised class is
 *     defined in `app/core/exceptions.py`, every class has exactly one handler,
 *     every handler returns `detail`/`code`/`request_id` with an explicit status
 *
 * One vocabulary of failures, one place that turns them into responses. A raise
 * that bypasses it answers 500 with a stack trace, or answers a status invented
 * at the raise site.
 */

declare const process: {
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
};

// ============================================================
// Constants
// ============================================================

const projectRoot = resolveProjectRoot();

// ============================================================
// Functions
// ============================================================

export default function checkBackendExceptionsHook(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-exceptions", event, () => {
    // Read-only tools never change files — running the check after them wastes context.
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["backend/"])) return;

    const issues = checkBackendExceptionsSync();
    if (issues.length === 0) {
      resetSuppression("check-backend-exceptions");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-exceptions",
      issues,
      "make check-backend-exceptions",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-exceptions") };
  }));
}

export function checkBackendExceptionsSync(): string[] {
  const appDir = join(projectRoot, "backend", "app");
  if (!existsSync(appDir)) return [];

  return [
    ...runAstRules(join(projectRoot, ".omp", "ast-grep", "rules", "exceptions"), [appDir]),
    ...checkBackendExceptions(),
  ];
}

// Direct execution (make check-backend-exceptions): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-exceptions.ts")) {
  const issues = checkBackendExceptionsSync();
  console.log("==> check-backend-exceptions");
  if (issues.length === 0) {
    console.log("    PASS: core exception policy valid");
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-backend-exceptions");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
