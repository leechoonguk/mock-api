import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { runAstRules } from "../lib/ast-rules.ts";
import {
  SRC_DIRECTORIES,
  frontendSrc,
  label,
  projectRoot,
  readIfPresent,
  readSources,
  walkSources,
} from "../lib/frontend-source.ts";
import { routerPathSegments } from "../lib/frontend-routes.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { touchesPath } from "../lib/hook-scope.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Frontend-API-Layer Post Hook
 *
 * Validates the transport and caching contract from
 * .omp/rules/frontend-api-layer.md:
 *
 *   1. one HTTP client — `axios.create` and `fetch` only in lib/api/client.ts
 *      (`ast-grep/rules/frontend-api/` owns the structural half)
 *   2. no URL literal outside lib/api/endpoints.ts
 *   3. services are transport only — no useQuery/useMutation in a service
 *   4. every query takes its key from a `*Keys` factory, never an array literal
 *   5. every list hook declares `placeholderData` — the grid reads its rows and
 *      its total from `data`, so losing it blanks the footer mid-fetch
 *   6. every CRUD mutation invalidates its list key
 *   7. screens go through hooks — sections/ and pages/ never import a service
 *
 * This is a read-only check — it does NOT block tool calls.
 */

/** Only the client may build a transport or call the platform directly. */
const TRANSPORT_OWNER = "frontend/src/lib/api/client.ts";

/**
 * A path literal that looks like a backend route. The browser's own route
 * registry is exempt: its paths are URLs in this app, not in the API, and
 * `check-frontend-routing` owns them. The client is exempt for its 401
 * exemption list, which names auth paths on purpose.
 */
const URL_LITERAL_EXEMPT: Record<string, true> = {
  "frontend/src/routes/paths.ts": true,
  [TRANSPORT_OWNER]: true,
}

export default function checkFrontendApiLayer(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-frontend-api-layer", event, () => {
    if (!touchesPath(event, ["frontend/"])) return;
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkFrontendApiLayerSync();
    if (issues.length === 0) {
      resetSuppression("check-frontend-api-layer");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-frontend-api-layer",
      issues,
      "run make check-frontend-api-layer for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-frontend-api-layer") };
  }));
}
/**
 * A path literal whose first segment is one the backend actually routes.
 * Built from `backend/app/routers/*.py` so a new router is covered the day it
 * lands; the previous literal `(?:auth|user|batch|integration)` also silently
 * omitted `/health`, which the backend has always served.
 */
function urlLiteralPattern(): RegExp {
  const segments = [...routerPathSegments(projectRoot)].sort();
  return new RegExp(`['"\`]/(?:${segments.join("|")})[/'"\`]`);
}

export function checkFrontendApiLayerSync(): string[] {
  const issues: string[] = [];
  if (!existsSync(frontendSrc)) return ["frontend/src/: directory not found"];

  issues.push(...checkTransportOwnership());
  issues.push(...checkUrlLiterals());
  issues.push(...checkServices());
  issues.push(...checkQueryHooks());
  issues.push(...checkScreensUseHooks());
  issues.push(...checkUninvalidatedScopesAreRealtime());
  issues.push(...checkRefusalsAreNotRetried());
  issues.push(...checkNoPerRowFanOut());
  return issues;
}

/**
 * The AST rule proves no second axios instance exists; the string checks cover
 * `fetch` and the import, which are not one construct.
 */
function checkTransportOwnership(): string[] {
  const issues: string[] = [];
  const scanned = walkSources(frontendSrc).filter(
    (path: string) => label(path) !== TRANSPORT_OWNER,
  );
  if (scanned.length > 0) {
    const rulesDir = join(projectRoot, ".omp", "ast-grep", "rules", "frontend-api");
    issues.push(...runAstRules(rulesDir, scanned));
  }

  for (const file of readSources(frontendSrc)) {
    if (file.label === TRANSPORT_OWNER) continue;
    if (/\bfetch\s*\(/.test(file.content)) {
      issues.push(
        `${file.label}: raw fetch — call the api helpers from ${TRANSPORT_OWNER}, ` +
          "which attach the token and normalise the error",
      );
    }
    if (/^import .*from ['"]axios['"]/m.test(file.content) && !file.label.endsWith("errors.ts")) {
      issues.push(
        `${file.label}: imports axios — only ${TRANSPORT_OWNER} and its error mapper may`,
      );
    }
  }
  return issues;
}

function checkUrlLiterals(): string[] {
  const issues: string[] = [];
  const endpoints = join(SRC_DIRECTORIES.lib, "endpoints.ts");
  const urlLiteral = urlLiteralPattern();
  for (const file of readSources(frontendSrc)) {
    if (file.path === endpoints || URL_LITERAL_EXEMPT[file.label] === true) continue;
    file.content.split("\n").forEach((line: string, index: number) => {
      if (urlLiteral.test(line)) {
        issues.push(
          `${file.label}:${index + 1}: backend path literal — add it to ` +
            "frontend/src/lib/api/endpoints.ts so a renamed route fails a check",
        );
      }
    });
  }
  return issues;
}

/**
 * A service that caches is a service no other caller can reuse; a list or
 * facets read takes the query's `AbortSignal`.
 *
 * A superseded read is cancelled: typing 고추장 on a phone left four list
 * requests in flight at once, each a full count over 1.86M rows, because the
 * read had no signal for React Query to abort with.
 */
function checkServices(): string[] {
  const issues: string[] = [];
  let reads = 0;
  for (const file of readSources(SRC_DIRECTORIES.services)) {
    if (/\buseQuery\b|\buseMutation\b/.test(file.content)) {
      issues.push(
        `${file.label}: a service must be transport only — move the caching to ` +
          "lib/api/hooks/",
      );
    }
    if (!/from ['"]@\/lib\/api\/client['"]/.test(file.content)) {
      issues.push(`${file.label}: does not import the shared client from @/lib/api/client`);
    }
    for (const read of file.content.matchAll(/^\s+(list\w*|\w*Facets): \(([^)]*)\)\s*=>/gm)) {
      reads += 1;
      const start = read.index ?? 0;
      const end = file.content.indexOf("\n\n", start);
      const body = file.content.slice(start + read[0].length, end === -1 ? file.content.length : end);
      if (!/signal\?: AbortSignal/.test(read[2]) || !/\{[^}]*\bsignal\b[^}]*\}/.test(body)) {
        issues.push(
          `${file.label}: ${read[1]} takes no AbortSignal into its request config — a superseded ` +
            "read runs to the end (four list reads in flight while typing 고추장)",
        );
      }
    }
  }
  if (reads === 0) {
    issues.push("frontend/src/lib/api/services/: no list or facets read found — the cancellation check compared nothing");
  }
  return issues;
}

/**
 * A 4xx is the request's own fault: asking again answers the same.
 *
 * A half-typed date (`2026-0`) answered 422, the default retry sent it again,
 * and the reader got the error toast for a value they had not finished typing.
 * So the query client's `retry` is a function that refuses 400-499.
 */
function checkRefusalsAreNotRetried(): string[] {
  const file = "frontend/src/Providers.tsx";
  const source = readIfPresent(join(projectRoot, file));
  if (source === null) return [`${file}: missing — the query client's defaults are set there`];
  const retry = /retry:\s*\(/.exec(source);
  if (retry === null) {
    return [`${file}: queries retry by count alone — a 422 is asked again and toasts twice`];
  }
  const body = source.slice(retry.index, source.indexOf("},", retry.index));
  if (!body.includes("400") || !body.includes("500")) {
    return [`${file}: the retry function does not refuse 400-499 — a refusal is retried into a second toast`];
  }
  return [];
}

function checkQueryHooks(): string[] {
  const issues: string[] = [];
  for (const file of readSources(SRC_DIRECTORIES.queryHooks)) {
    for (const [hookName, body] of exportedFunctions(file.content)) {
      if (/useQuery\(/.test(body)) {
        if (/queryKey:\s*\[/.test(body)) {
          issues.push(
            `${file.label}: ${hookName} spells its own queryKey array — take it from ` +
              "the factory in lib/api/queryKeys.ts or no mutation can invalidate it",
          );
        }
        if (!/staleTime:\s*QUERY_STALE_TIME\./.test(body)) {
          issues.push(
            `${file.label}: ${hookName} sets no staleTime from QUERY_STALE_TIME — ` +
              "a bare number says how long, never why",
          );
        }
        if (/List\b/.test(hookName) && !/placeholderData:/.test(body)) {
          issues.push(
            `${file.label}: ${hookName} declares no placeholderData — the grid reads ` +
              "its rows and its total from data, which goes undefined during a fetch",
          );
        }
        const read = /\w+Service\.(list\w*|\w*Facets)\(([^)]*)\)/.exec(body);
        if (/^use\w+(List|Facets|ByKey)$/.test(hookName) && read !== null) {
          if (!/queryFn:\s*\(\{\s*signal\s*\}\)/.test(body) || !/\bsignal\b/.test(read[2])) {
            issues.push(
              `${file.label}: ${hookName} does not hand the query's signal to ${read[1]} — ` +
                "a superseded read is never cancelled",
            );
          }
        }
      }
      if (/useMutation\(/.test(body) && /^use(Create|Update|Delete)/.test(hookName)) {
        if (!/invalidateQueries\(/.test(body)) {
          issues.push(
            `${file.label}: ${hookName} does not invalidate its list key — the list ` +
              "keeps showing the row it just changed",
          );
        }
      }
    }
  }
  return issues;
}

function checkScreensUseHooks(): string[] {
  const issues: string[] = [];
  for (const root of [SRC_DIRECTORIES.sections, SRC_DIRECTORIES.pages]) {
    for (const file of readSources(root)) {
      if (/from ['"]@\/lib\/api\/services\//.test(file.content)) {
        issues.push(
          `${file.label}: imports a service directly — a screen goes through ` +
            "lib/api/hooks/ so the result is cached and invalidated with everything else",
        );
      }
    }
  }
  return issues;
}

/**
 * A scope no mutation invalidates has no way back to fresh data but a refetch.
 *
 * `invalidateQueries` is this application's only cache-refresh path — measured:
 * no `setQueryData`, `refetchQueries`, `removeQueries` or `resetQueries` exists
 * anywhere in `frontend/src`. So for a scope no mutation names, a non-zero
 * `staleTime` is a window in which the screen cannot show the truth and nothing
 * on it can ask again: the run log is written by the scheduler, outside HTTP, and
 * a stale answer reports last night's failure as still running.
 *
 * Scopes are **discovered** from the key factory, never listed here — a hook that
 * writes a domain name into a classifier keeps passing on the day it stops
 * applying. The direction is one-way: a scope that *is* invalidated may still
 * choose REALTIME (a list read far more often than it changes is a different
 * decision), so only the uninvalidated ones are constrained.
 */
function checkUninvalidatedScopesAreRealtime(): string[] {
  const issues: string[] = [];
  const factories = keyFactories();
  if (factories.size === 0) return issues;

  const files = readSources(SRC_DIRECTORIES.queryHooks);
  const invalidated = new Set<string>();
  for (const file of files) {
    // One level of indirection is a legitimate shape:
    // `const runKey = batchRunKeys.lists(); invalidateQueries({ queryKey: runKey })`.
    // Reading only the call site missed it and demanded REALTIME from a scope a
    // mutation was in fact refreshing — measured as a false finding.
    const bindings = new Map<string, string>();
    for (const bound of file.content.matchAll(/const\s+(\w+)\s*=\s*(\w+Keys)\s*\./g)) {
      bindings.set(bound[1], bound[2]);
    }
    for (const match of file.content.matchAll(/invalidateQueries\(\s*\{\s*queryKey:\s*(\w+)/g)) {
      invalidated.add(bindings.get(match[1]) ?? match[1]);
    }
  }

  const queried = new Set<string>();
  for (const file of files) {
    for (const match of file.content.matchAll(/queryKey:\s*(\w+)\s*\./g)) {
      queried.add(match[1]);
    }
  }
  for (const factory of factories) {
    if (queried.has(factory)) continue;
    issues.push(
      `frontend/src/lib/api/queryKeys.ts: ${factory} is declared and no query reads ` +
        "it — either the screen was never built or the scope is a key waiting to be " +
        "copied onto the wrong collection",
    );
  }

  for (const file of files) {
    for (const [hookName, body] of exportedFunctions(file.content)) {
      if (!/useQuery\(/.test(body)) continue;
      const key = /queryKey:\s*(\w+)\s*\./.exec(body);
      if (key === null || !factories.has(key[1])) continue;
      if (invalidated.has(key[1])) continue;
      const stale = /staleTime:\s*QUERY_STALE_TIME\.(\w+)/.exec(body);
      if (stale === null || stale[1] === "REALTIME") continue;
      issues.push(
        `${file.label}: ${hookName} caches ${key[1]} for ${stale[1]}, but no mutation ` +
          `invalidates that scope — nothing can refresh the rows before the window ` +
          "expires, so use QUERY_STALE_TIME.REALTIME or give a write the invalidation",
      );
    }
  }
  return issues;
}

/**
 * Every `<name>Keys = createQueryKeys('<scope>')` in the key factory module.
 *
 * A factory declared and used by no query is reported here rather than left to a
 * reader: `authKeys` sat exported and referenced by nothing, and an unused scope
 * is either a screen that was never built or a key someone will copy for the
 * wrong collection.
 */
function keyFactories(): Set<string> {
  // existence-ok: queryKeys.ts is imported by every hook module — tsc fails loudly without it.
  const source = readIfPresent(join(SRC_DIRECTORIES.lib, "queryKeys.ts"));
  if (source === null) return new Set();
  return new Set(
    [...source.matchAll(/export const (\w+)\s*=\s*createQueryKeys\(/g)].map(
      (match: RegExpMatchArray) => match[1],
    ),
  );
}

/**
 * Splits a hooks module into `name → body`. A brace counter is enough here
 * because these modules are exported functions at the top level; it keeps the
 * per-hook checks from leaking across hook boundaries, which a whole-file regex
 * does (one compliant hook would excuse its neighbour).
 */
function exportedFunctions(content: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  const pattern = /export function (\w+)\s*\(/g;
  let match = pattern.exec(content);
  while (match !== null) {
    const start = content.indexOf("{", match.index + match[0].length - 1);
    if (start !== -1) {
      let depth = 0;
      let end = start;
      for (let i = start; i < content.length; i += 1) {
        if (content[i] === "{") depth += 1;
        if (content[i] === "}") {
          depth -= 1;
          if (depth === 0) {
            end = i;
            break;
          }
        }
      }
      found.push([match[1], content.slice(start, end + 1)]);
    }
    match = pattern.exec(content);
  }
  return found;
}

/**
 * A surface is one request, not one per row. `useQueries` over a list asks the
 * server once per item on every mount: the header's failure bell read each
 * schedule's run log (35 reads on every page load) until the backend answered
 * the question itself. A collection the screen
 * needs across rows is an endpoint, so `useQueries` is refused; a fan-out that
 * truly cannot be one request says why on its line or the two above
 * (`// fan-out-ok: <reason>`).
 */
function checkNoPerRowFanOut(): string[] {
  const issues: string[] = [];
  for (const file of readSources(frontendSrc)) {
    const lines = file.content.split("\n");
    lines.forEach((line: string, index: number) => {
      if (/^\s*(\*|\/\/)/.test(line) || !/\buseQueries\(/.test(line)) return;
      const excuse = /fan-out-ok:(.*)$/m.exec(lines.slice(Math.max(0, index - 2), index + 1).join("\n"));
      if (excuse !== null && excuse[1].trim() !== "") return;
      issues.push(
        `${file.label}:${index + 1}: useQueries fans one request out per row — ask the backend for the ` +
          "collection in one endpoint, or say fan-out-ok: <reason>",
      );
    });
  }
  return issues;
}

// Direct execution (make check-frontend-api-layer): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-frontend-api-layer.ts")) {
  const issues = checkFrontendApiLayerSync();
  console.log("==> check-frontend-api-layer");
  if (issues.length === 0) {
    console.log("    PASS: frontend API layer contract valid");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-frontend-api-layer");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
