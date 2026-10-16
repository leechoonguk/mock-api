/**
 * Check-Backend-App-Setup Post Hook
 *
 * Validates backend-app-setup.md: health check, OpenAPI metadata, API
 * versioning in main.py.
 *
 * This is a read-only check — it does NOT block tool calls.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { touchesPath } from "../lib/hook-scope.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";

const projectRoot = resolveProjectRoot();
const appDir = join(projectRoot, "backend", "app");
const mainPath = join(appDir, "main.py");

/**
 * Routers that answer at a fixed, unversioned path: health, which probes hit,
 * and mock, whose `/mock/{slug}/…` URLs are what clients of the mocked API call —
 * versioning them would change every mocked URL with the admin API.
 */
const UNVERSIONED_ROUTERS: Readonly<Record<string, string>> = {
  health: "probes use a fixed path",
  mock: "mocked URLs live at /mock/{slug}/…, outside the admin API",
};

export default function checkBackendAppSetup(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-app-setup", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["backend/"])) return;

    const issues = checkBackendAppSetupSync();
    if (issues.length === 0) {
      resetSuppression("check-backend-app-setup");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-app-setup",
      issues,
      "run make check-backend-app-setup for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-app-setup") };
  }));
}

/**
 * A router reached at the wrong path is a second, undocumented API: clients
 * find it, nothing versions it, and the version prefix stops meaning anything.
 * Presence of the string "/api/v1" in main.py cannot see that — this compares
 * the router modules on disk against the ones actually mounted under the
 * versioned parent, and allows only the unversioned mounts in
 * `UNVERSIONED_ROUTERS`.
 */
function checkRouterMounting(main: string): string[] {
  const issues: string[] = [];
  const routersDir = join(projectRoot, "backend", "app", "routers");
  if (!existsSync(routersDir)) return issues;

  const modules = readdirSync(routersDir)
    .filter((file: string) => file.endsWith(".py") && file !== "__init__.py")
    .map((file: string) => file.replace(/\.py$/, ""));

  const versioned = new Set(
    [...main.matchAll(/api_router\.include_router\(\s*(\w+)\.router/g)].map((match) => match[1]),
  );
  const direct = new Set(
    [...main.matchAll(/app\.include_router\(\s*(\w+)\.router/g)].map((match) => match[1]),
  );

  for (const module of modules) {
    const reason = UNVERSIONED_ROUTERS[module];
    if (reason !== undefined) {
      if (!direct.has(module)) {
        issues.push(`main.py: ${module} router must be mounted directly on app — ${reason}`);
      }
      continue;
    }
    if (direct.has(module)) {
      issues.push(
        `main.py: ${module} router is mounted on app directly — mount it on api_router ` +
          "so it answers under /api/v1",
      );
    } else if (!versioned.has(module)) {
      issues.push(`main.py: ${module} router exists but is never mounted — it answers nothing`);
    }
  }

  if (!/api_router\s*=\s*APIRouter\(prefix=API_V1_PREFIX\)/.test(main)) {
    issues.push("main.py: the versioned parent must be APIRouter(prefix=API_V1_PREFIX)");
  }
  return issues;
}

function checkBackendAppSetupSync(): string[] {
  const issues: string[] = [];
  if (!existsSync(mainPath)) {
    // premature-ok: 프로젝트 기반 파일의 부재는 작업 순서가 아니라 설정 결함이다 — 어느 단계에서든 참이다.
    issues.push("backend/app/main.py not found");
    return issues;
  }
  const main = readFileSync(mainPath, "utf-8");
  issues.push(...checkRouterMounting(main));

  // Health check
  const healthPath = join(appDir, "routers", "health.py");
  if (!existsSync(healthPath)) {
    issues.push("health check missing — add app/routers/health.py with GET /health (DB ping, 503 on failure)");
  } else {
    const health = readFileSync(healthPath, "utf-8");
    if (!/\/health/.test(health)) {
      issues.push("routers/health.py: no GET /health endpoint");
    }
    // The status code lives in the handler, not at the raise site
    // (backend-exceptions.md): health raises ServiceUnavailableError and
    // core/exceptions.py maps it to 503.
    if (!/ServiceUnavailableError/.test(health)) {
      issues.push(
        "routers/health.py: DB failure must raise ServiceUnavailableError (mapped to 503 by " +
          "core/exceptions.py) — never an HTTPException at the raise site",
      );
    }
    const exceptionsPath = join(appDir, "core", "exceptions.py");
    const exceptions = existsSync(exceptionsPath) ? readFileSync(exceptionsPath, "utf-8") : "";
    if (!/status_code=503/.test(exceptions)) {
      issues.push(
        "core/exceptions.py: ServiceUnavailableError handler must answer 503 — readiness has " +
          "no other way to tell an orchestrator to stop routing traffic",
      );
    }
  }

  // OpenAPI metadata
  if (!/FastAPI\(\s*title=/.test(main)) {
    issues.push("main.py: OpenAPI metadata missing — FastAPI(title=..., version=...)");
  }

  // API versioning: the prefix is in main.py, or declared once in core/settings.py
  // (`API_V1_PREFIX`) and imported by it, so the prefix is spelled nowhere twice.
  const settingsPath = join(appDir, "core", "settings.py");
  const settings = existsSync(settingsPath) ? readFileSync(settingsPath, "utf-8") : "";
  const declared = /API_V1_PREFIX\s*=\s*"\/api\/v1"/.test(settings) && /\bAPI_V1_PREFIX\b/.test(main);
  if (!/\/api\/v1/.test(main) && !declared) {
    issues.push("API versioning missing — mount routers under /api/v1 (health and mock stay unversioned)");
  }

  return issues;
}

// Direct execution (make check-backend-app-setup): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-app-setup.ts")) {
  const issues = checkBackendAppSetupSync();
  console.log("==> check-backend-app-setup");
  if (issues.length === 0) {
    console.log("    PASS: backend app setup standard valid");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-backend-app-setup");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
