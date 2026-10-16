import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { checkServiceInjectionSync } from "../lib/backend-service-injection.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Backend-Service-Injection Post Hook
 *
 * Validates backend-service-injection.md: a service composes repositories,
 * never another service. The measurement lives in
 * `lib/backend-service-injection.ts`.
 *
 * This is a read-only check — it does NOT block tool calls.
 */

export default function checkBackendServiceInjection(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-service-injection", event, () => {
    if (!touchesPath(event, ["backend/"])) return;
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkServiceInjectionSync();
    if (issues.length === 0) {
      resetSuppression("check-backend-service-injection");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-service-injection",
      issues,
      "run make check-backend-service-injection for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-service-injection") };
  }));
}

// Direct execution (make check-backend-service-injection): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-service-injection.ts")) {
  const issues = checkServiceInjectionSync();
  console.log("==> check-backend-service-injection");
  if (issues.length === 0) {
    console.log("    PASS: no service imports another service");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-backend-service-injection");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
