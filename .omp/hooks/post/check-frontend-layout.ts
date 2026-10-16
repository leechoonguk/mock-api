/**
 * Check-Frontend-Layout Post Hook
 *
 * Validates frontend-layout.md: every entry under frontend/src/ declared in
 * SRC_LAYOUT, every file named for its directory, every `@/` import inside its
 * charter, no cycle among component families, and the rule's table matching
 * the declaration.
 *
 * This is a read-only check — it does NOT block tool calls.
 */
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { passLine } from "../lib/hook-dormancy.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { checkFrontendLayout } from "../lib/frontend-layout.ts";

export default function checkFrontendLayoutHook(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-frontend-layout", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["frontend/src/", ".omp/rules/frontend-layout.md"])) return;

    const issues = checkFrontendLayout();
    if (issues.length === 0) {
      resetSuppression("check-frontend-layout");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-frontend-layout",
      issues,
      "run make check-frontend-layout for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-frontend-layout") };
  }));
}

// Direct execution (make check-frontend-layout): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-frontend-layout.ts")) {
  const issues = checkFrontendLayout();
  console.log("==> check-frontend-layout");
  if (issues.length === 0) {
    console.log(passLine("check-frontend-layout", "every source directory is declared, every file named for its directory, every import inside its charter, no component cycle"));
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-frontend-layout");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
