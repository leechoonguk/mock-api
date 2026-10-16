// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join, relative, sep } from "node:path";
import { frontendSrc, projectRoot, SRC_LAYOUT, type SourceCharter, stripComments, walkSources } from "./frontend-source.ts";

/**
 * The frontend directory charter, checked against the tree (rule://frontend-layout).
 *
 * `SRC_LAYOUT` declares what each `src/` directory and root file may import
 * and how its files are named; this reads every source file and asks: is
 * every top-level entry declared, is every file named for its directory, does
 * every `@/` import land inside its charter, do component families never form
 * a cycle, and does the rule's table say what the declaration says.
 */

const RULE_PATH = join(projectRoot, ".omp", "rules", "frontend-layout.md");

/** An `@/` import — static, type-only, dynamic and side-effect alike. */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+)['"]@\/([^'"]+)['"]/gm;

/** One row of the rule's `## Directories` table: entry, holds, imports, files. */
const RULE_ROW = /^\| `src\/([\w./-]+)` \| (.+?) \| (.+?) \| (.+?) \|$/gm;

/** Where a `src/`-relative path sits: its top-level name, the charter, and its subfolder (`""` at the directory root). */
function placeOf(srcRelative: string): { top: string; charter: SourceCharter | undefined; sub: string } {
  const segments = srcRelative.split("/");
  if (segments.length === 1) {
    return { top: segments[0].replace(/\.[^.]+$/, ""), charter: SRC_LAYOUT.rootFiles[segments[0]], sub: "" };
  }
  return { top: segments[0], charter: SRC_LAYOUT.directories[segments[0]], sub: segments.length >= 3 ? segments[1] : "" };
}

/** An import target's top-level name and subfolder: `components/chat/x` → `components`, `chat`. */
function targetOf(specifier: string): { top: string; sub: string } {
  const segments = specifier.split("/");
  return { top: segments[0].replace(/\.[^.]+$/, ""), sub: segments.length >= 3 ? segments[1] : "" };
}

/** The `@/` imports of `content`. */
function importsOf(content: string): string[] {
  return [...stripComments(content).matchAll(IMPORT)].map((match) => match[1]);
}

/** Every `@/` import of the file at `srcRelative` that leaves its charter. */
export function importIssues(srcRelative: string, content: string): string[] {
  const source = placeOf(srcRelative);
  const issues: string[] = [];
  for (const specifier of importsOf(content)) {
    const target = targetOf(specifier);
    if (target.top === source.top) {
      if (source.charter?.peers === "none" && target.sub !== source.sub) {
        issues.push(
          `src/${srcRelative}: imports @/${specifier} — a ${source.top}/ folder never imports another's (rule://frontend-layout)`,
        );
      }
      continue;
    }
    const allowed = source.charter?.imports ?? [];
    if (allowed.includes("*") || allowed.includes(target.top)) continue;
    issues.push(
      `src/${srcRelative}: imports @/${specifier} — ${source.top} may import ${allowed.join(", ") || "nothing outside itself"} (rule://frontend-layout)`,
    );
  }
  return issues;
}

/** Why the file at `srcRelative` is named against its directory, or null. */
export function fileNameIssue(srcRelative: string): string | null {
  const segments = srcRelative.split("/");
  if (segments.length !== 2) return null;
  const pattern = SRC_LAYOUT.directories[segments[0]]?.files;
  if (pattern === undefined || pattern.test(segments[1])) return null;
  return `src/${srcRelative}: is not ${pattern} — src/${segments[0]}/ holds one kind of file`;
}

/** Each cycle among `<directory>/<folder>` units, once: `components/a → components/b → components/a`. */
export function cyclesOf(directory: string, edges: Map<string, Set<string>>): string[] {
  const found = new Map<string, string>();
  const visit = (node: string, path: string[]): void => {
    for (const next of edges.get(node) ?? []) {
      const at = path.indexOf(next);
      if (at >= 0) {
        const cycle = path.slice(at);
        const start = cycle.indexOf([...cycle].sort()[0]);
        const rotated = [...cycle.slice(start), ...cycle.slice(0, start)];
        const key = rotated.join(">");
        if (!found.has(key)) found.set(key, [...rotated, rotated[0]].map((unit) => `${directory}/${unit}`).join(" → "));
        continue;
      }
      visit(next, [...path, next]);
    }
  };
  for (const node of [...edges.keys()].sort()) visit(node, [node]);
  return [...found.values()].map((cycle) => `src/${directory}: ${cycle} — a family may use another, never in a cycle (rule://frontend-layout)`);
}

/** The cells a rule row must carry for one charter. */
function expectedCells(charter: SourceCharter): { imports: string; files: string } {
  return {
    imports: charter.imports.length === 0 ? "—" : charter.imports.map((entry) => `\`${entry}\``).join(", "),
    files: charter.files === undefined ? "—" : `\`${charter.files.source}\``,
  };
}

/** The rule's `## Directories` table against the declaration, row for row. */
function ruleTableIssues(): string[] {
  if (!existsSync(RULE_PATH)) return [".omp/rules/frontend-layout.md: missing — the charter has no prose"];
  const section = /## Directories\n([\s\S]*?)(?=\n## |$)/.exec(readFileSync(RULE_PATH, "utf-8"))?.[1] ?? "";
  const rows = new Map<string, { imports: string; files: string }>();
  for (const row of section.matchAll(RULE_ROW)) rows.set(row[1], { imports: row[3].trim(), files: row[4].trim() });
  if (rows.size === 0) return [".omp/rules/frontend-layout.md: the ## Directories table reads as empty — the comparison compared nothing"];
  const expected = new Map<string, { imports: string; files: string }>();
  for (const [name, charter] of Object.entries(SRC_LAYOUT.directories)) expected.set(`${name}/`, expectedCells(charter));
  for (const [name, charter] of Object.entries(SRC_LAYOUT.rootFiles)) expected.set(name, expectedCells(charter));
  const issues: string[] = [];
  for (const [entry, cells] of expected) {
    const row = rows.get(entry);
    if (row === undefined) {
      issues.push(`.omp/rules/frontend-layout.md: no row for src/${entry} — SRC_LAYOUT declares it`);
      continue;
    }
    if (row.imports !== cells.imports) issues.push(`.omp/rules/frontend-layout.md: src/${entry} Imports reads ${row.imports}, SRC_LAYOUT declares ${cells.imports}`);
    if (row.files !== cells.files) issues.push(`.omp/rules/frontend-layout.md: src/${entry} Files reads ${row.files}, SRC_LAYOUT declares ${cells.files}`);
  }
  for (const entry of rows.keys()) {
    if (!expected.has(entry)) issues.push(`.omp/rules/frontend-layout.md: a row for src/${entry}, which SRC_LAYOUT does not declare`);
  }
  return issues;
}

const SELF_TEST: ReadonlyArray<{ name: string; path: string; code?: string; edges?: Array<[string, string]>; fires: boolean }> = [
  { name: "a hook reaching a component", path: "hooks/useX.ts", code: "import X from '@/components/chat/x'\n", fires: true },
  { name: "a section reaching another's", path: "sections/a/A.tsx", code: "import B from '@/sections/b/B'\n", fires: true },
  { name: "a component cycle", path: "components", edges: [["data-grid", "detail"], ["detail", "data-grid"]], fires: true },
  { name: "a page named against pages/", path: "pages/Foo.tsx", fires: true },
  { name: "a component reaching the API layer", path: "components/x/X.tsx", code: "import { useFood } from '@/lib/api/hooks/useFood'\n", fires: false },
  { name: "the route table's lazy page", path: "App.tsx", code: "const X = lazy(() => import('@/pages/XPage'))\n", fires: false },
  { name: "an import in a comment", path: "hooks/useX.ts", code: "// import B from '@/sections/b/B'\n/* import C from '@/pages/CPage' */\nexport const x = 1\n", fires: false },
  { name: "families used without a cycle", path: "components", edges: [["data-grid", "clipped-text"], ["detail", "clipped-text"]], fires: false },
];

/** The self-test cases that judge wrong — a check that cannot tell its cases apart checks nothing. */
function selfTestIssues(): string[] {
  const issues: string[] = [];
  for (const test of SELF_TEST) {
    let found: number;
    if (test.edges !== undefined) {
      const edges = new Map<string, Set<string>>();
      for (const [from, to] of test.edges) edges.set(from, (edges.get(from) ?? new Set()).add(to));
      found = cyclesOf(test.path, edges).length;
    } else if (test.code !== undefined) found = importIssues(test.path, test.code).length;
    else found = fileNameIssue(test.path) === null ? 0 : 1;
    if ((found > 0) !== test.fires) issues.push(`self-test '${test.name}': expected ${test.fires ? "a finding" : "silence"}, got ${found} finding(s)`);
  }
  return issues;
}

export function checkFrontendLayout(): string[] {
  if (!existsSync(frontendSrc)) return ["frontend/src/ not found — there is no tree to hold to its charter"];
  const issues = selfTestIssues();
  for (const entry of readdirSync(frontendSrc, { withFileTypes: true })) {
    const declared = entry.isDirectory() ? SRC_LAYOUT.directories[entry.name] : SRC_LAYOUT.rootFiles[entry.name];
    if (declared === undefined) {
      issues.push(`src/${entry.name}${entry.isDirectory() ? "/" : ""}: no entry in SRC_LAYOUT — declare what it holds and may import (rule://frontend-layout)`);
    }
  }
  const files = walkSources(frontendSrc);
  if (files.length === 0) return [...issues, "frontend/src: no source read — the charter checked nothing"];
  // Every directory with peers "acyclic" gets its own folder graph.
  const graphs = new Map<string, Map<string, Set<string>>>();
  for (const path of files) {
    const srcRelative = relative(frontendSrc, path).split(sep).join("/");
    const misnamed = fileNameIssue(srcRelative);
    if (misnamed !== null) issues.push(misnamed);
    const content = readFileSync(path, "utf-8");
    issues.push(...importIssues(srcRelative, content));
    const source = placeOf(srcRelative);
    if (source.charter?.peers !== "acyclic" || source.sub === "") continue;
    for (const specifier of importsOf(content)) {
      const target = targetOf(specifier);
      if (target.top !== source.top || target.sub === "" || target.sub === source.sub) continue;
      const graph = graphs.get(source.top) ?? new Map<string, Set<string>>();
      graph.set(source.sub, (graph.get(source.sub) ?? new Set()).add(target.sub));
      graphs.set(source.top, graph);
    }
  }
  for (const [directory, graph] of graphs) issues.push(...cyclesOf(directory, graph));
  issues.push(...ruleTableIssues());
  return issues;
}
