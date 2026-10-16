/**
 * Check-Backend-Middleware Post Hook
 *
 * Validates backend-middleware.md: CORS, CSRF protection, security headers,
 * request ID, structured logging in main.py.
 *
 * This is a read-only check — it does NOT block tool calls.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { runAstRules } from "../lib/ast-rules.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";

const projectRoot = resolveProjectRoot();
const mainPath = join(projectRoot, "backend", "app", "main.py");
const appDir = join(projectRoot, "backend", "app");

export default function checkBackendMiddleware(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-middleware", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["backend/"])) return;

    const issues = checkBackendMiddlewareSync();
    if (issues.length === 0) {
      resetSuppression("check-backend-middleware");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-middleware",
      issues,
      "run make check-backend-middleware for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-middleware") };
  }));
}

function checkBackendMiddlewareSync(): string[] {
  const issues: string[] = [];
  if (!existsSync(mainPath)) {
    // premature-ok: 프로젝트 기반 파일의 부재는 작업 순서가 아니라 설정 결함이다 — 어느 단계에서든 참이다.
    issues.push("backend/app/main.py not found");
    return issues;
  }
  // A logged credential outlives the process; this hook owns structured logging,
  // so it owns the rule that keeps values out of it.
  const loggingRules = join(projectRoot, ".omp", "ast-grep", "rules", "logging");
  if (existsSync(loggingRules)) {
    issues.push(...runAstRules(loggingRules, [appDir]));
  }

  const main = readFileSync(mainPath, "utf-8");

  // Host allowlist — the rule has required this since it was written; nothing
  // checked it, and main.py did not have it (measured).
  if (!/TrustedHostMiddleware/.test(main)) {
    issues.push(
      "main.py: Host header guard missing — add TrustedHostMiddleware(allowed_hosts=settings.allowed_hosts): " +
        "a poisoned Host ends up in generated URLs (password reset, redirects)",
    );
  } else if (!/allowed_hosts=settings\.allowed_hosts/.test(main)) {
    issues.push("main.py: TrustedHostMiddleware must take its allowlist from settings, not a literal");
  }

  // CORS
  if (!/CORSMiddleware/.test(main)) {
    issues.push("main.py: CORS missing — add CORSMiddleware (dev origin from settings.cors_origins)");
  } else if (!/allow_origins/.test(main)) {
    issues.push("main.py: CORSMiddleware allow_origins must be configured (from settings)");
  }

  // CSRF
  if (!/class CsrfProtection\(BaseHTTPMiddleware\)/.test(main)) {
    issues.push("main.py: CSRF protection missing — add CsrfProtection middleware");
  } else if (!/Sec-Fetch-Site/.test(main) || !/request\.headers\.get\("Origin"\)/.test(main)) {
    issues.push("main.py: CSRF protection must validate Origin and Sec-Fetch-Site on unsafe requests");
  } else if (!/CSRF validation failed/.test(main)) {
    issues.push("main.py: CSRF protection must reject invalid requests with a 403 response");
  }

  // Security headers — each one is its own claim. The previous
  // `X-Content-Type-Options|X-Frame-Options|SecurityHeaders` alternation passed
  // when nosniff was deleted, because frame-options still matched (measured).
  if (!/X-Content-Type-Options/.test(main)) {
    issues.push("main.py: security header X-Content-Type-Options: nosniff missing");
  }
  if (!/X-Frame-Options/.test(main)) {
    issues.push("main.py: security header X-Frame-Options: DENY missing");
  }

  // Request ID
  if (!/X-Request-ID/.test(main)) {
    issues.push("main.py: request ID missing — add X-Request-ID middleware (echo header + log context)");
  }

  // Structured logging
  const loggingPath = join(projectRoot, "backend", "app", "core", "logging.py");
  if (!existsSync(loggingPath)) {
    issues.push("app/core/logging.py: structured logging missing — add it (structlog, JSON in prod)");
  }

  // Registration, not just definition. Measured: deleting
  // `app.add_middleware(SecurityHeaders)` left every header string in place
  // inside the class body, so this check stayed green while the app served
  // responses with no security headers at all. A middleware that is defined and
  // never added is the same as one that does not exist.
  for (const middleware of [
    "TrustedHostMiddleware",
    "CsrfProtection",
    "SecurityHeaders",
    "CORSMiddleware",
  ]) {
    if (!new RegExp(`add_middleware\\(\\s*${middleware}`).test(main)) {
      issues.push(
        `main.py: ${middleware} is never registered — add ` +
          `app.add_middleware(${middleware}); a defined middleware that is not added does nothing`,
      );
    }
  }

  return issues;
}

// Direct execution (make check-backend-middleware): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-middleware.ts")) {
  const issues = checkBackendMiddlewareSync();
  console.log("==> check-backend-middleware");
  if (issues.length === 0) {
    console.log("    PASS: backend middleware standard valid");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-backend-middleware");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
