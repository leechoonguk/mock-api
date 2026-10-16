// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { resolveProjectRoot } from "./hook-project-root.ts";
import {
  APP_LAYERS,
  type DirectoryCharter,
  importAllowed,
  layerFiles,
  moduleUnit,
  pythonCode,
  unitCharter,
} from "./backend-layout.ts";

/**
 * The backend directory charter, checked against the tree (rule://backend-layout).
 *
 * `APP_LAYERS` declares what each directory under `backend/app/` may import and
 * how its modules are named; this reads the tree and asks four questions of it:
 * is every directory declared, is every module named for its directory, does
 * every import land inside its charter, and does the rule's table say what the
 * declaration says. The write gate refuses a new undeclared folder or a
 * misnamed module before it lands; this is the closing look at what is there.
 */

const projectRoot = resolveProjectRoot();
const APP_DIR = join(projectRoot, "backend", "app");
const RULE_PATH = join(projectRoot, ".omp", "rules", "backend-layout.md");

/** `from app.x.y import z` / `import app.x.y` — indented and `TYPE_CHECKING` imports included. */
const IMPORT = /^\s*(?:from\s+app\.([\w.]+)\s+import|import\s+app\.([\w.]+))/gm;

/** One row of the rule's `## Directories` table: directory, holds, imports, files. */
const RULE_ROW = /^\| `app\/([\w/]+)\/` \| (.+?) \| (.+?) \| (.+?) \|$/gm;

/** Every import in `source` that leaves the charter of the module at `path` (app-relative). */
export function importIssues(path: string, source: string): string[] {
  const unit = moduleUnit(path.replace(/\.py$/, "").split("/"));
  const issues: string[] = [];
  for (const match of pythonCode(source).matchAll(IMPORT)) {
    const target = match[1] ?? match[2];
    if (importAllowed(unit, target.split("."))) continue;
    const list = (unitCharter(unit)?.imports ?? []).join(", ");
    issues.push(
      `app/${path}: imports app.${target} — ${unit} may import ${list || "nothing outside itself"} (rule://backend-layout)`,
    );
  }
  return issues;
}

/** Why the module at `path` (app-relative) is misnamed for its directory, or null. */
export function fileNameIssue(path: string): string | null {
  const segments = path.split("/");
  const fileName = segments[segments.length - 1];
  if (fileName === "__init__.py" || !fileName.endsWith(".py")) return null;
  const layer = APP_LAYERS[segments[0]];
  if (layer === undefined || layer.depth === null) return null;
  let charter: DirectoryCharter | undefined;
  let directory = segments[0];
  if (segments.length === 2) charter = layer;
  else if (segments.length === 3 && layer.folders !== undefined) {
    charter = layer.folders[segments[1]];
    directory = `${segments[0]}/${segments[1]}`;
  }
  if (charter?.files === undefined || charter.files.test(fileName)) return null;
  return `app/${path}: is not ${charter.files} — app/${directory}/ holds one kind of module`;
}

/** Every directory under app/ that `APP_LAYERS` does not declare. */
function undeclaredDirectories(): string[] {
  const issues: string[] = [];
  const undeclared = (dir: string): string =>
    `app/${dir}/: no row in APP_LAYERS — declare what it holds and may import (rule://backend-layout)`;
  for (const entry of readdirSync(APP_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "__pycache__") continue;
    const layer = APP_LAYERS[entry.name];
    if (layer === undefined || layer.depth === null) {
      issues.push(undeclared(entry.name));
      continue;
    }
    if (layer.folders === undefined) continue;
    for (const inner of readdirSync(join(APP_DIR, entry.name), { withFileTypes: true })) {
      if (!inner.isDirectory() || inner.name === "__pycache__") continue;
      if (layer.folders[inner.name] === undefined) issues.push(undeclared(`${entry.name}/${inner.name}`));
    }
  }
  return issues;
}

/** Every module under app/ but the tests, as app-relative paths, `main.py` included. */
function appModules(): string[] {
  const modules: string[] = existsSync(join(APP_DIR, "main.py")) ? ["main.py"] : [];
  for (const [layer, charter] of Object.entries(APP_LAYERS)) {
    if (charter.depth === null) continue;
    modules.push(...layerFiles(join(APP_DIR, layer)).map((file: string) => `${layer}/${file}`));
  }
  return modules;
}

/** The cells a rule row must carry for one charter. */
function expectedCells(charter: DirectoryCharter): { imports: string; files: string } {
  return {
    imports: charter.imports.length === 0 ? "—" : charter.imports.map((entry) => `\`${entry}\``).join(", "),
    files: charter.files === undefined ? "—" : `\`${charter.files.source}\``,
  };
}

/** The rule's `## Directories` table against the declaration, row for row. */
function ruleTableIssues(): string[] {
  if (!existsSync(RULE_PATH)) return [".omp/rules/backend-layout.md: missing — the charter has no prose"];
  const rule = readFileSync(RULE_PATH, "utf-8");
  const section = /## Directories\n([\s\S]*?)(?=\n## |$)/.exec(rule)?.[1] ?? "";
  const rows = new Map<string, { imports: string; files: string }>();
  for (const row of section.matchAll(RULE_ROW)) rows.set(row[1], { imports: row[3].trim(), files: row[4].trim() });
  if (rows.size === 0) return [".omp/rules/backend-layout.md: the ## Directories table reads as empty — the comparison compared nothing"];

  const expected = new Map<string, { imports: string; files: string }>();
  for (const [layer, charter] of Object.entries(APP_LAYERS)) {
    if (charter.depth === null) continue;
    expected.set(layer, expectedCells(charter));
    for (const [folder, inner] of Object.entries(charter.folders ?? {})) {
      expected.set(`${layer}/${folder}`, expectedCells(inner));
    }
  }
  const issues: string[] = [];
  for (const [dir, cells] of expected) {
    const row = rows.get(dir);
    if (row === undefined) {
      issues.push(`.omp/rules/backend-layout.md: no row for app/${dir}/ — APP_LAYERS declares it`);
      continue;
    }
    if (row.imports !== cells.imports) {
      issues.push(`.omp/rules/backend-layout.md: app/${dir}/ Imports reads ${row.imports}, APP_LAYERS declares ${cells.imports}`);
    }
    if (row.files !== cells.files) {
      issues.push(`.omp/rules/backend-layout.md: app/${dir}/ Files reads ${row.files}, APP_LAYERS declares ${cells.files}`);
    }
  }
  for (const dir of rows.keys()) {
    if (!expected.has(dir)) issues.push(`.omp/rules/backend-layout.md: a row for app/${dir}/, which APP_LAYERS does not declare`);
  }
  return issues;
}

const SELF_TEST: ReadonlyArray<{ name: string; path: string; code?: string; fires: boolean }> = [
  { name: "core reaching an engine", path: "core/settings.py", code: "from app.engine.matcher import normalize_path\n", fires: true },
  { name: "an engine reaching the schemas", path: "engine/matcher.py", code: "from app.schemas.endpoint import EndpointReadResponse\n", fires: true },
  { name: "a router reaching a repository", path: "routers/project.py", code: "from app.repositories.project import ProjectRepository\n", fires: true },
  { name: "a router reaching the engine", path: "routers/mock.py", code: "from app.engine.matcher import METHODS\n", fires: false },
  { name: "a domain folder reaching its sibling", path: "schemas/project/endpoint.py", code: "from app.schemas.request_log import RequestLogReadResponse\n", fires: false },
  { name: "the assembly", path: "main.py", code: "from app.routers import project\nfrom app.core.settings import settings\n", fires: false },
  { name: "an import in prose", path: "core/settings.py", code: '"""Never `from app.engine import x` here."""\n# from app.engine import y\nx = 1\n', fires: false },
];

/** The self-test cases that judge wrong — a check that cannot tell its cases apart checks nothing. */
function selfTestIssues(): string[] {
  const issues: string[] = [];
  for (const test of SELF_TEST) {
    const found = test.code === undefined ? (fileNameIssue(test.path) === null ? 0 : 1) : importIssues(test.path, test.code).length;
    if ((found > 0) !== test.fires) {
      issues.push(`self-test '${test.name}': expected ${test.fires ? "a finding" : "silence"}, got ${found} finding(s)`);
    }
  }
  return issues;
}

export function checkBackendLayout(): string[] {
  if (!existsSync(APP_DIR)) return ["backend/app/ not found — there is no tree to hold to its charter"];
  const issues = [...selfTestIssues(), ...undeclaredDirectories()];
  const modules = appModules();
  if (modules.length === 0) return [...issues, "backend/app: no module read — the charter checked nothing"];
  for (const path of modules) {
    const misnamed = fileNameIssue(path);
    if (misnamed !== null) issues.push(misnamed);
    issues.push(...importIssues(path, readFileSync(join(APP_DIR, path), "utf-8")));
  }
  issues.push(...ruleTableIssues());
  return issues;
}
