import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { touchesPath } from "../lib/hook-scope.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { runAstRules } from "../lib/ast-rules.ts";
import { aggregateDomains, belongsToAggregateDomain } from "../lib/backend-domain-structure.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";

/**
 * Check-Backend-Transaction Post Hook
 *
 * Validates backend-transaction.md: session.begin() placement rules.
 *
 *   - AST rules: transaction/ (service-only), domain/ (service-transaction-write-only)
 *
 * This is a read-only check — it does NOT block tool calls.
 */
const projectRoot = resolveProjectRoot();

export default function checkBackendTransaction(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-transaction", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["backend/"])) return;

    const issues = checkBackendTransactionSync();
    if (issues.length === 0) {
      resetSuppression("check-backend-transaction");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-transaction",
      issues,
      "run make check-backend-transaction for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-transaction") };
  }));
}

function checkBackendTransactionSync(): string[] {
  const issues: string[] = [];
  const base = join(projectRoot, "backend", "app");

  // transaction/ — session.begin() forbidden outside services.
  const transactionRules = join(projectRoot, ".omp", "ast-grep", "rules", "transaction");
  if (existsSync(transactionRules)) {
    issues.push(
      ...runAstRules(transactionRules, [
        join(base, "repositories"),
        join(base, "routers"),
        join(base, "core"),
        join(base, "engine"),
        join(base, "dependencies"),
        join(base, "models"),
        join(base, "schemas"),
      ]),
    );
  }

  // domain/ — within simple CRUD services, only create/update/delete may open
  // a transaction. A multi-table aggregate has synchronous validation helpers
  // and relationship replacement validated by its own file-shape hooks and,
  // when one exists, its dedicated configuration hook — never by a hardcoded
  // domain name, which is exactly what stopped excluding anything the day
  // a single service became a folder of several files.
  const domainRules = join(projectRoot, ".omp", "ast-grep", "rules", "domain");
  if (existsSync(domainRules)) {
    const aggregates = aggregateDomains();
    const aggregatePaths = ["services", "repositories"].flatMap((directory) => {
      const directoryPath = join(base, directory);
      return readdirSync(directoryPath)
        .filter((file: string) => {
          if (!file.endsWith(".py")) return false;
          return !belongsToAggregateDomain(file.replace(/\.py$/, ""), aggregates);
        })
        .map((file: string) => join(directoryPath, file));
    });
    issues.push(...runAstRules(domainRules, aggregatePaths));
  }

  return issues;
}

// Direct execution (make check-backend-transaction): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-transaction.ts")) {
  const issues = checkBackendTransactionSync();
  console.log("==> check-backend-transaction");
  if (issues.length === 0) {
    console.log("    PASS: backend transaction conventions valid");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-backend-transaction");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
