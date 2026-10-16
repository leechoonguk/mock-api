import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import {
  SRC_DIRECTORIES,
  frontendSrc,
  jsxOpeningTag,
  readIfPresent,
  readSources,
  stripComments,
} from "../lib/frontend-source.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Frontend-Routing Post Hook
 *
 * Validates the routing contract from .omp/rules/frontend-routing.md:
 *
 *   1. registry ↔ route table, both ways — every PATHS leaf is routed and every
 *      route comes from PATHS (a literal path is a link that breaks silently)
 *   2. registry ↔ navigation — every screen route is reachable from the
 *      sidebar, and the sidebar points at nothing unrouted
 *   3. no literal `to="/..."` / `navigate('/...')` anywhere in src
 *   4. the catch-all route sits inside the shell layout, so an unknown path keeps the nav
 *   5. a nav path that is a prefix of another (`/project`, `/project/archive`)
 *      needs the sidebar's `NavLink` rendered with `end`, or both items are active
 *
 * This is a read-only check — it does NOT block tool calls.
 */

/** Registry leaves that are not navigation targets: the root only redirects. */
const NON_NAV_PATHS: Record<string, true> = { root: true };

export default function checkFrontendRouting(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-frontend-routing", event, () => {
    if (!touchesPath(event, ["frontend/"])) return;
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkFrontendRoutingSync();
    if (issues.length === 0) {
      resetSuppression("check-frontend-routing");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-frontend-routing",
      issues,
      "run make check-frontend-routing for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-frontend-routing") };
  }));
}

export function checkFrontendRoutingSync(): string[] {
  const issues: string[] = [];
  if (!existsSync(frontendSrc)) return ["frontend/src/: directory not found"];

  const paths = readIfPresent(join(SRC_DIRECTORIES.routes, "paths.ts"));
  const routes = readIfPresent(join(frontendSrc, "App.tsx"));
  const navigation = readIfPresent(join(SRC_DIRECTORIES.layouts, "dashboard", "config-navigation.tsx"));

  if (paths === null) return ["frontend/src/routes/paths.ts: missing — routes would be literals"];
  if (routes === null) return ["frontend/src/App.tsx: missing — the app has no route table"];
  if (navigation === null) {
    return ["frontend/src/layouts/dashboard/config-navigation.tsx: missing — no navigation model"];
  }

  const registry = registryLeaves(paths);
  const routed = referencedLeaves(routes);
  const navigated = referencedLeaves(navigation);

  // All three loops below compare these sets, so a consistent rename of the
  // registry (`PATHS` -> anything) empties every side at once and the whole
  // contract passes vacuously. An existing file the parser reads as empty is
  // the parser's blindness, and that is the finding.
  if (registry.size === 0) {
    return [
      "frontend/src/routes/paths.ts: no PATHS leaves parsed — the registry exists but " +
        "the check cannot read it, so every route/navigation comparison is vacuous",
    ];
  }
  if (routed.size === 0) {
    return [
      "frontend/src/App.tsx: no PATHS references parsed from the route table — either " +
        "no route reads the registry or the parser was defeated; both retire this check",
    ];
  }

  for (const leaf of registry) {
    if (!routed.has(leaf)) {
      issues.push(
        `frontend/src/App.tsx: PATHS.${leaf} is registered but not routed — the path ` +
          "exists and reaches nothing",
      );
    }
    if (NON_NAV_PATHS[leaf] !== true && !navigated.has(leaf)) {
      issues.push(
        `frontend/src/layouts/dashboard/config-navigation.tsx: PATHS.${leaf} is routed but ` +
          "absent from NAV_ITEMS — the screen is unreachable from the sidebar",
      );
    }
  }
  for (const leaf of navigated) {
    if (!registry.has(leaf)) {
      issues.push(
        `frontend/src/layouts/dashboard/config-navigation.tsx: PATHS.${leaf} is not in the ` +
          "registry — the sidebar points at a path that does not exist",
      );
    }
  }

  issues.push(...checkLiteralPaths());
  issues.push(...checkCatchAllInShell());
  issues.push(
    ...checkNavActiveIsExact(
      paths,
      navigation,
      readIfPresent(join(SRC_DIRECTORIES.layouts, "dashboard", "NavVertical.tsx")),
    ),
  );
  return issues;
}

/**
 * `NavLink` marks an item active when the location *starts with* its path, so
 * a parent path stayed lit on its child path and the sidebar showed two
 * selected items (measured: both `a.active`). `end` makes the match exact. It is
 * required whenever one nav path is a prefix of another - the registry says so,
 * so a new pair added later cannot reintroduce the double highlight - and the
 * sidebar must render its items through `NavLink`, the one source of `.active`.
 */
export function checkNavActiveIsExact(paths: string, navigation: string, sidebar: string | null): string[] {
  const values = new Map<string, string>();
  let group: string | null = null;
  for (const line of paths.split("\n")) {
    const nested = /^\s{2}(\w+):\s*\{\s*$/.exec(line);
    if (nested !== null) group = nested[1];
    else if (/^\s{2}\},?\s*$/.test(line)) group = null;
    const leaf = /^\s+(\w+):\s*'(\/[^']*)'/.exec(line);
    if (leaf !== null) values.set(group === null ? leaf[1] : `${group}.${leaf[1]}`, leaf[2]);
  }
  const navPaths = [...referencedLeaves(navigation)]
    .map((leaf) => values.get(leaf))
    .filter((value): value is string => value !== undefined && value !== "/");
  const prefixes = navPaths.flatMap((short) =>
    navPaths.filter((long) => long.startsWith(`${short}/`)).map((long) => `${short} -> ${long}`),
  );
  if (prefixes.length === 0) return [];
  const file = "frontend/src/layouts/dashboard/NavVertical.tsx";
  if (sidebar === null) return [`${file}: missing - nav paths are in a prefix relation (${prefixes.join(", ")}) and nothing renders them exactly`];
  const source = stripComments(sidebar);
  const link = source.search(/<StyledItem\b[^>]*component=\{NavLink\}|<NavLink\b/);
  if (link === -1) {
    return [`${file}: the nav items are not rendered through NavLink - the one source of the active state - while nav paths are in a prefix relation (${prefixes.join(", ")})`];
  }
  const tag = jsxOpeningTag(source, source.indexOf("<", link));
  if (!/(^|\s)end(\s|=|\/|>|$)/.test(tag)) {
    return [
      `${file}: the nav's NavLink has no \`end\`, and nav paths are in a prefix relation (${prefixes.join(", ")}) - ` +
        "both items are active on the longer path",
    ];
  }
  return [];
}

/** `project: '/project'` and `settings: { general: '...' }` → `project`, `settings.general`. */
function registryLeaves(source: string): Set<string> {
  const leaves = new Set<string>();
  let group: string | null = null;
  for (const line of source.split("\n")) {
    const nested = /^\s{2}(\w+):\s*\{\s*$/.exec(line);
    if (nested !== null) {
      group = nested[1];
      continue;
    }
    if (/^\s{2}\},?\s*$/.test(line)) {
      group = null;
      continue;
    }
    const leaf = /^\s+(\w+):\s*[`'"]/.exec(line);
    if (leaf !== null) {
      leaves.add(group === null ? leaf[1] : `${group}.${leaf[1]}`);
    }
  }
  return leaves;
}

function referencedLeaves(source: string): Set<string> {
  return new Set(
    [...source.matchAll(/PATHS\.([\w.]+)/g)].map((match: RegExpMatchArray) => match[1]),
  );
}

/** A path spelled in a component is the one the router will not rename. */
function checkLiteralPaths(): string[] {
  const issues: string[] = [];
  const registry = join(SRC_DIRECTORIES.routes, "paths.ts");
  for (const file of readSources(frontendSrc)) {
    if (file.path === registry) continue;
    file.content.split("\n").forEach((line: string, index: number) => {
      if (/\bto=["']\//.test(line) || /navigate\(\s*['"]\//.test(line)) {
        issues.push(
          `${file.label}:${index + 1}: literal route — use PATHS from ` +
            "frontend/src/routes/paths.ts",
        );
      }
      if (/\bpath=["']\/(?!\*)/.test(line)) {
        issues.push(
          `${file.label}:${index + 1}: literal route path — bind the route to PATHS so the ` +
            "registry and the table cannot disagree",
        );
      }
    });
  }
  return issues;
}

/**
 * The catch-all is routed inside the shell's layout route, so an unknown path
 * renders with the nav and the reader can leave it.
 */
function checkCatchAllInShell(): string[] {
  const app = readIfPresent(join(frontendSrc, "App.tsx")) ?? "";
  const shell = app.indexOf("<DashboardLayout");
  const catchAll = app.indexOf('path="*"');
  // The shell is the table's last layout route: its end is the last `</Route>`.
  const shellEnd = shell === -1 ? -1 : app.lastIndexOf("</Route>");
  if (catchAll === -1 || shell === -1 || catchAll < shell || catchAll > shellEnd) {
    return ['frontend/src/App.tsx: the catch-all (path="*") is not routed inside DashboardLayout — an unknown path renders with no nav to leave it'];
  }
  return [];
}

// Direct execution (make check-frontend-routing): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-frontend-routing.ts")) {
  const issues = checkFrontendRoutingSync();
  console.log("==> check-frontend-routing");
  if (issues.length === 0) {
    console.log("    PASS: routes, registry and navigation agree");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-frontend-routing");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
