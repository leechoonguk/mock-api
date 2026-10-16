import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync, readdirSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";

/**
 * Check-Tooling Post Hook
 *
 * Enforces the tooling language policy (tooling.md) on the tree, not just at
 * write time — a file can also arrive by checkout, rename or a tool the pre
 * hook does not see:
 *
 *   1. Python is application code only (`backend/app`, `backend/tests`,
 *      `backend/alembic`). Automation in Python needs a virtualenv and a
 *      second toolchain to run one check.
 *   2. Shell is limited to `backend/scripts/start.sh`.
 *   3. `.omp/hooks/` is TypeScript only — hooks and libs import each other.
 *   4. Scripts live in `.omp/hooks/`, `.omp/extensions/`, `frontend/` or `decks/`; a root
 *      `scripts/`, `tools/` or `bin/` directory hides tooling from
 *      `check-omp-hooks` and from every make target.
 *   5. Every root `check-*` target runs `node .omp/hooks/...`, so a check is
 *      executable on any machine with node and nothing else.
 */

declare const process: {
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
};

// ============================================================
// Constants
// ============================================================

const cwd = process.cwd();
const projectRoot = resolveProjectRoot();

/** Python is the application's language; it is never the harness's. */
const PYTHON_ROOTS = ["backend/app/", "backend/tests/", "backend/alembic/"];

/** The app entrypoint is the one sanctioned shell script. */
const SHELL_FILES: Record<string, true> = { "backend/scripts/start.sh": true };

/** Where script code may live at all. */
const SCRIPT_ROOTS = [".omp/hooks/", ".omp/extensions/", "frontend/", "decks/"];

const ADHOC_SCRIPT_DIRS: Record<string, true> = {
  scripts: true,
  tools: true,
  bin: true,
  utils: true,
};

const SCRIPT_EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const SKIPPED_DIRS: Record<string, true> = {
  ".git": true,
  ".venv": true,
  "node_modules": true,
  "__pycache__": true,
  dist: true,
  htmlcov: true,
  cov_html: true,
  ".pytest_cache": true,
  ".ruff_cache": true,
};

// ============================================================
// Functions
// ============================================================

export default function checkTooling(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-tooling", event, () => {
    // Read-only tools never change files — running the check after them wastes context.
    // hook-scope: global — 도구 규약은 어느 경로의 스크립트에도 걸린다
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkToolingSync();
    if (issues.length === 0) {
      resetSuppression("check-tooling");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-tooling",
      issues,
      "move the script to .omp/hooks/ (a check) or .omp/extensions/ (session behaviour)",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-tooling") };
  }));
}

export function checkToolingSync(): string[] {
  const issues: string[] = [];

  for (const path of walk(projectRoot)) {
    if (path.endsWith(".py") && !PYTHON_ROOTS.some((root) => path.startsWith(root))) {
      issues.push(
        `${path}: Python outside the application roots — automation belongs in ` +
          ".omp/hooks/ as TypeScript (tooling.md)",
      );
    }
    if (path.endsWith(".sh") && SHELL_FILES[path] !== true) {
      issues.push(
        `${path}: shell script outside backend/scripts/start.sh — write the check or ` +
          "runner in .omp/hooks/ and register a make target",
      );
    }
    if (/^\.omp\/(hooks|extensions)\//.test(path) && !path.endsWith(".ts")) {
      issues.push(`${path}: .omp/hooks/ and .omp/extensions/ are TypeScript only — the modules import each other`);
    }
    if (ADHOC_SCRIPT_DIRS[path.split("/")[0]] === true) {
      issues.push(
        `${path}: repository-root script directory — tooling that is not under ` +
          ".omp/hooks/ is invisible to check-omp-hooks and to every make target",
      );
    }
    if (SCRIPT_EXTENSIONS.test(path) && !SCRIPT_ROOTS.some((root) => path.startsWith(root))) {
      issues.push(`${path}: script outside .omp/hooks/, .omp/extensions/, frontend/ and decks/ (tooling.md)`);
    }
  }

  issues.push(...checkCheckTargets());
  issues.push(...checkDatabaseAccess());
  // --- Extensions: a detached rejection tears the session down ---
  // Measured: `void ctx.compact()` rejected with "Nothing to compact (session
  // too small)", escaped handler dispatch, and the postmortem handler killed the
  // whole session (exit 1). Runtime actions that return a promise must have
  // their rejection handled, so the failure stays inside the extension.
  const extensionsDir = join(cwd, ".omp", "extensions");
  if (existsSync(extensionsDir)) {
    for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
      const files = entry.isDirectory()
        ? readdirSync(join(extensionsDir, entry.name))
            .filter((file: string) => file.endsWith(".ts"))
            .map((file: string) => join(entry.name, file))
        : entry.name.endsWith(".ts")
          ? [entry.name]
          : [];
      for (const file of files) {
        const source = readFileSync(join(extensionsDir, file), "utf-8");
        const lines = source.split("\n");
        lines.forEach((line: string, index: number) => {
          const call = /\bctx\.(compact|shutdown|abort)(?:\?\.)?\(/.exec(line);
          if (call === null) return;
          if (/^\s*(?:\/\/|\*)/.test(line)) return;
          // `void` is an explicit discard: there is nothing left to handle it.
          if (!/\bvoid\s+ctx\./.test(line)) {
            // The handler may sit on the following lines (assign, then .catch).
            const window = lines.slice(index, index + 5).join("\n");
            if (/\bawait\b/.test(window) || /\.catch\(/.test(window)) return;
          }
          issues.push(
            `.omp/extensions/${file}:${index + 1}: ctx.${call[1]}() without await or .catch — ` +
              "a detached rejection escapes handler dispatch and kills the session",
          );
        });
      }
    }
  }

  return issues;
}

/**
 * Reading the database has exactly one path: `psql` inside the postgres
 * container, spawned from one place.
 *
 * Three failures this closes, all measured in this repository:
 *
 *   1. **A second copy.** `rowCounts()` built its own `docker compose exec`
 *      argv next to `query()`, so the credentials and the container name existed
 *      twice while the comment above it claimed they did not.
 *   2. **Reading through the API instead.** The drift gate first compared seeded
 *      operations against `GET /integration/` — and a bare-array response made
 *      the live set empty, reporting a live operation as absent. An endpoint
 *      filters, paginates and serialises; that is the wrong instrument for "does
 *      this row exist".
 *   3. **A stale answer.** A query against a database behind head reports drift
 *      that is only a missing `make migrate`, so a Makefile recipe that runs
 *      `psql` must apply migrations in the same target.
 *
 * A host `psql` or a `docker exec` by container name are rejected outright: the
 * first assumes a local client, the second bypasses compose's project scoping.
 */
function checkDatabaseAccess(): string[] {
  const issues: string[] = [];
  // Detection is by call site, not by mention: this file names `psql` to police
  // it, and a policy that flags its own prose is a policy nobody keeps.
  const ARGV_PSQL = /,\s*"psql",/g;
  const SANCTIONED_ARGV = /"compose",\s*"exec",\s*"-T",\s*"postgres",\s*"psql",/;
  // `$(DC…)` covers every stack's compose variable - `$(DC)` for development,
  // `$(DC_QA)` for the QA project. They are the same spawn form with a different
  // project name; what the rule refuses is a host `psql` or a bare `docker exec`.
  const SANCTIONED_SHELL = /(?:docker\s+compose|\$\(DC[A-Z_]*\))\s+exec\s+-T\s+postgres\s+psql\b/;
  const DRIVER_IMPORT = /(?:from|require\()\s*["'](?:asyncpg|psycopg[\w.]*|pg)["']/;
  const spawners: string[] = [];
  for (const path of walk(projectRoot)) {
    if (!path.startsWith(".omp/hooks/") || !path.endsWith(".ts")) continue;
    const source = readFileSync(join(projectRoot, path), "utf-8");
    const argv = [...source.matchAll(ARGV_PSQL)];
    if (argv.length > 0) {
      spawners.push(path);
      if (argv.length > 1) {
        issues.push(
          `${path}: spawns psql ${argv.length} times — one helper owns the container path and ` +
            "the credentials; every other reader calls it",
        );
      }
      if (!SANCTIONED_ARGV.test(source)) {
        issues.push(
          `${path}: psql is not run as \`docker compose exec -T postgres psql\` — a host client ` +
            "assumes a local install and \`docker exec\` bypasses compose project scoping",
        );
      }
    }
    if (DRIVER_IMPORT.test(source)) {
      issues.push(`${path}: opens a Postgres connection directly — read through the psql helper`);
    }
  }
  if (spawners.length > 1) {
    issues.push(
      `.omp/hooks/: ${spawners.length} modules spawn psql (${spawners.join(", ")}) — ` +
        "the harness reads the database from one place",
    );
  }
  const makefilePath = join(projectRoot, "Makefile");
  if (existsSync(makefilePath)) {
    for (const target of readFileSync(makefilePath, "utf-8").split(/\n(?=[a-zA-Z])/)) {
      if (!/\bpsql\b/.test(target)) continue;
      const name = /^([a-zA-Z][\w-]*):/.exec(target)?.[1] ?? "(unnamed)";
      if (!SANCTIONED_SHELL.test(target)) {
        issues.push(`Makefile: target '${name}' runs psql outside \`docker compose exec -T postgres psql\``);
      }
      // Either spelling of "bring it to head first": the development target calls
      // `make -C backend migrate`, the QA one runs alembic inside its container.
      if (!/\bmigrate\b/.test(target) && !/alembic\s+upgrade\s+head/.test(target)) {
        issues.push(
          `Makefile: target '${name}' queries the database without applying migrations first — ` +
            "an answer read from a database behind head is drift that is only a missing migrate",
        );
      }
    }
  }
  return issues;
}

/** A check must be one `node` invocation — no interpreter, no virtualenv. */
function checkCheckTargets(): string[] {
  const issues: string[] = [];
  const makefilePath = join(projectRoot, "Makefile");
  if (!existsSync(makefilePath)) return issues;

  const lines = readFileSync(makefilePath, "utf-8").split("\n");
  lines.forEach((line: string, index: number) => {
    const target = /^(check-[\w-]+):/.exec(line);
    if (target === null) return;
    const recipe = lines[index + 1] ?? "";
    if (!recipe.startsWith("\t")) return; // aggregate target: dependencies only
    if (recipe.includes("node .omp/hooks/")) return;
    issues.push(
      `Makefile ${target[1]}: runs '${recipe.trim()}' — a check target must run ` +
        "node .omp/hooks/... so it needs nothing but node (tooling.md)",
    );
  });
  return issues;
}

// ============================================================
// Helpers
// ============================================================

/** Every tracked-looking file in the repository, as a repo-relative path. */
function walk(dir: string, prefix = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRS[entry.name] === true) continue;
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...walk(join(dir, entry.name), path));
      continue;
    }
    found.push(path);
  }
  return found;
}

// Direct execution (make check-tooling): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-tooling.ts")) {
  const issues = checkToolingSync();
  console.log("==> check-tooling");
  if (issues.length === 0) {
    console.log("    PASS: tooling language policy valid");
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-tooling");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
