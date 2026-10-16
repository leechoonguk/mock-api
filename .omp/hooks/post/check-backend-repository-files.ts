import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { checkRepositoryFilesSync } from "../lib/backend-repository-files.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Backend-Repository-Files Post Hook
 *
 * Validates backend-repository-files.md: one repository, one table, named
 * after it. The measurements live in `lib/backend-repository-files.ts`.
 *
 * This is a read-only check — it does NOT block tool calls.
 */

export default function checkBackendRepositoryFiles(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-repository-files", event, () => {
    if (!touchesPath(event, ["backend/"])) return;
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkRepositoryFilesSync();
    if (issues.length === 0) {
      resetSuppression("check-backend-repository-files");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-repository-files",
      issues,
      "run make check-backend-repository-files for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-repository-files") };
  }));
}

// Direct execution (make check-backend-repository-files): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-repository-files.ts")) {
  const issues = checkRepositoryFilesSync();
  console.log("==> check-backend-repository-files");
  if (issues.length === 0) {
    console.log("    PASS: one repository per table, named after it");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-backend-repository-files");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
