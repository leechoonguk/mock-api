/**
 * Check-Backend-Layout Post Hook
 *
 * Validates backend-layout.md: every directory under backend/app/ declared in
 * APP_LAYERS, every module named for its directory, every import inside its
 * directory's charter, and the rule's table matching the declaration.
 *
 * This is a read-only check — it does NOT block tool calls.
 */
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { passLine } from "../lib/hook-dormancy.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { checkBackendLayout } from "../lib/backend-layout-check.ts";

export default function checkBackendLayoutHook(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-layout", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["backend/app/", ".omp/rules/backend-layout.md"])) return;

    const issues = checkBackendLayout();
    if (issues.length === 0) {
      resetSuppression("check-backend-layout");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-layout",
      issues,
      "run make check-backend-layout for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-layout") };
  }));
}

// Direct execution (make check-backend-layout): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-layout.ts")) {
  const issues = checkBackendLayout();
  console.log("==> check-backend-layout");
  if (issues.length === 0) {
    console.log(passLine("check-backend-layout", "every directory is declared, every module named for its directory, every import inside its charter"));
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-backend-layout");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
