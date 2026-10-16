/**
 * Check-Backend-Core-Config Post Hook
 *
 * Validates backend-core-config.md: settings validation, DB pool config,
 * error response schema.
 *
 * This is a read-only check — it does NOT block tool calls.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync } from "node:fs";
import { touchesPath } from "../lib/hook-scope.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";

const projectRoot = resolveProjectRoot();
const coreDir = join(projectRoot, "backend", "app", "core");

export default function checkBackendCoreConfig(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-core-config", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["backend/"])) return;

    const issues = checkBackendCoreConfigSync();
    if (issues.length === 0) {
      resetSuppression("check-backend-core-config");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-core-config",
      issues,
      "run make check-backend-core-config for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-core-config") };
  }));
}

function checkBackendCoreConfigSync(): string[] {
  const issues: string[] = [];

  // Settings validation
  const settingsPath = join(coreDir, "settings.py");
  if (existsSync(settingsPath)) {
    const settings = readFileSync(settingsPath, "utf-8");
    // Require an actual decorator, not just the import: `from pydantic import
    // field_validator` alone satisfied the old substring check.
    if (!/@field_validator\(/.test(settings)) {
      issues.push("settings.py: no @field_validator — validate env enum and DATABASE_URL scheme");
    }
  }

  // DB pool config
  const dbPath = join(coreDir, "database.py");
  if (existsSync(dbPath)) {
    const db = readFileSync(dbPath, "utf-8");
    if (!/pool_size/.test(db) || !/max_overflow/.test(db) || !/pool_timeout/.test(db)) {
      issues.push("database.py: explicit pool_size/max_overflow/pool_timeout required");
    }
  }

  // Error response schema
  const exceptionsPath = join(coreDir, "exceptions.py");
  if (existsSync(exceptionsPath)) {
    const exceptions = readFileSync(exceptionsPath, "utf-8");
    if (!/"code"/.test(exceptions)) {
      issues.push("exceptions.py: error responses must include a stable 'code' field");
    }
    if (!/request_id/.test(exceptions)) {
      issues.push("exceptions.py: error responses must include 'request_id'");
    }
  }

  return issues;
}

// Direct execution (make check-backend-core-config): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-core-config.ts")) {
  const issues = checkBackendCoreConfigSync();
  console.log("==> check-backend-core-config");
  if (issues.length === 0) {
    console.log("    PASS: backend core config standard valid");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-backend-core-config");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
