import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { checkModelFilesSync } from "../lib/backend-model-files.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Backend-Model-Files Post Hook
 *
 * Validates backend-model-files.md: one table, one model class, one file, named
 * after the table. The measurements and the exemption live in
 * `lib/backend-model-files.ts`.
 *
 * This is a read-only check — it does NOT block tool calls.
 */

export default function checkBackendModelFiles(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-model-files", event, () => {
    if (!touchesPath(event, ["backend/"])) return;
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkModelFilesSync();
    if (issues.length === 0) {
      resetSuppression("check-backend-model-files");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-model-files",
      issues,
      "run make check-backend-model-files for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-model-files") };
  }));
}

// Direct execution (make check-backend-model-files): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-model-files.ts")) {
  const issues = checkModelFilesSync();
  console.log("==> check-backend-model-files");
  if (issues.length === 0) {
    console.log("    PASS: one table, one model class, one file");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-backend-model-files");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
