/**
 * Check-Code-Layout Post Hook
 *
 * After tool execution, validates the layout standard in
 * .omp/rules/code-layout.md across **every** code surface — backend Python,
 * frontend TypeScript, the deck build scripts, and the harness's own hooks:
 *
 *   1. comments: no commented-out code, no parked-work markers (WORK_MARKER),
 *      a JSDoc header on every hook and lib
 *   2. section banners in backend/app: canonical vocabulary, canonical order,
 *      Imports first
 *   3. constant placement: under the Constants banner, before the first class;
 *      in TS/JS, after the imports and never declared with `let`
 *   4. class member order: declarative config → fields → relationships →
 *      properties → __init__ → public methods → private methods (Python), and
 *      fields → constructor → public → private (TypeScript)
 *   5. TypeScript file layout: imports, then constants, then export default,
 *      then the helpers it calls
 *
 * Arrangement drift is invisible in review but makes every file a new puzzle,
 * so it is checked rather than asked for.
 */
// @ts-ignore — OMP runtime module, not project-compiled
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot, WALK_EXCLUDES } from "../lib/hook-project-root.ts";

declare const process: {
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
};

// ============================================================
// Constants
// ============================================================

const projectRoot = resolveProjectRoot();

/** Banner vocabulary, in the order the sections must appear. */
const BANNER_ORDER = [
  "Imports",
  "Constants",
  "Classes",
  "Middleware",
  "Lifespan",
  "App Setup",
  "Router",
  "Functions",
  "Dependencies",
  "Router Registration",
];

/** Text assets held to the whitespace standard. */
const HYGIENE_EXTENSIONS = [
  ".py", ".ts", ".tsx", ".mjs", ".md", ".yml", ".yaml", ".http", ".toml", ".ini", ".css", ".sh",
];

/**
 * The exact rule line a banner is drawn with. A banner is a landmark: readers
 * find sections by the shape of the page, and two widths in one file make the
 * eye stop on the drawing instead of the title. All 87 banners in the app
 * already agree on this width — the check keeps them that way.
 */
const BANNER_RULE = `# ${"=".repeat(60)}`;

/**
 * A construct that must announce itself. A file can carry every banner in the
 * vocabulary in the right order and still hide its router under "Functions" —
 * presence and order cannot see that, so the construct names its section.
 */
const BANNER_FOR_CONSTRUCT: Array<{ construct: RegExp; titles: string[]; what: string }> = [
  { construct: /^router = APIRouter\(/m, titles: ["Router"], what: "an APIRouter" },
  { construct: /^class \w+/m, titles: ["Classes", "Middleware"], what: "a class" },
];

/** An intention parked in a comment is never found again. */
const WORK_MARKER = /\b(TODO|FIXME|XXX|HACK)\b/;

/** Comment lines that are really statements — dead code pretending to be prose. */
const COMMENTED_CODE_PY =
  /^\s*#\s*(?:from\s+[\w.]+\s+import\s|import\s+[\w.]+\s*$|def\s+\w+\s*\(|class\s+\w+\s*[:(]|return\s+\S|await\s+\w|\w+\s*=\s*[^=\s]\S*\s*$)/;
const COMMENTED_CODE_TS =
  /^\s*\/\/\s*(?:import\s+[\w{*][^;]*from\s|export\s+(?:default|function|const)\s|function\s+\w+\s*\(|const\s+\w+\s*=\s*[^=]|return\s+\S)/;

/**
 * Python class members, in the order code-layout.md requires them.
 *
 * `__init__` has its own rank: the documented order is properties → `__init__` →
 * methods, and ranking the constructor as a plain method left no legal position
 * for a property in a class that has both (measured on `IntegrationClient`).
 */
const PY_MEMBER_RANK: Record<string, number> = {
  config: 0,
  field: 1,
  relationship: 2,
  property: 3,
  init: 4,
  method: 5,
};
const PY_MEMBER_ORDER_TEXT =
  "declarative config → fields → relationships → properties → __init__ → methods";

/** TypeScript class members, same principle: state before behaviour. */
const TS_MEMBER_RANK: Record<string, number> = { field: 0, constructor: 1, method: 2 };
const TS_MEMBER_ORDER_TEXT = "fields → constructor → methods";

const PY_CONFIG = /^ {4}(__tablename__|__table_args__|model_config|__mapper_args__)\s*[:=]/;
const PY_PROPERTY = /^ {4}@(?:property|cached_property)\b/;
const PY_METHOD = /^ {4}(?:async\s+)?def\s+(\w+)/;
const PY_FIELD = /^ {4}(\w+)\s*:\s*\S/;
const TS_CLASS_OPEN = /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+(\w+)/;
const TS_CONSTRUCTOR = /^\s{2,}(?:private\s+|protected\s+|public\s+)?constructor\s*\(/;
const TS_METHOD =
  /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+|override\s+)*([#\w]+)\s*(?:<[^>]*>)?\(/;
const TS_FIELD = /^\s{2,}(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+)*([#\w]+)\s*[?!]?\s*[:=]/;
/** Every executable source extension in the repository outside Python. */
const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

interface ClassBlock {
  name: string;
  body: string;
  line: number;
}

interface ClassMember {
  kind: string;
  name: string;
  line: number;
}

// ============================================================
// Functions
// ============================================================

export default function checkCodeLayout(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-code-layout", event, () => {
    // Read-only tools never change files — running the check after them wastes context.
    // hook-scope: global — 레이아웃은 어느 경로에 새 파일이 생겨도 대상이다
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkCodeLayoutSync();
    if (issues.length === 0) {
      resetSuppression("check-code-layout");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-code-layout",
      issues,
      "make check-code-layout",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-code-layout") };
  }));
}

export function checkCodeLayoutSync(): string[] {
  const issues: string[] = [];

  // Banners and constant sections are the hand-written module standard; tests
  // and migrations have their own shapes (fixtures, revision headers).
  const bannerRoots = [join(projectRoot, "backend", "app"), join(projectRoot, "backend", "scripts")];
  const pythonRoots = [
    ...bannerRoots,
    join(projectRoot, "backend", "tests"),
    join(projectRoot, "backend", "alembic"),
  ];
  const scriptRoots = [
    join(projectRoot, ".omp", "hooks"),
    join(projectRoot, ".omp", "extensions"),
    join(projectRoot, "frontend", "src"),
    join(projectRoot, "decks", "scripts"),
  ];
  // Package-root config files are code too: they carry ports, aliases and lint
  // policy. They are not walked recursively — node_modules and dist are not ours.
  const scriptFiles = walk(join(projectRoot, "frontend"), SCRIPT_EXTENSIONS, false);

  for (const rootDir of pythonRoots) {
    for (const path of walk(rootDir, [".py"])) {
      const source = readFileSync(path, "utf-8");
      const label = relative(path);
      issues.push(...checkComments(label, source, COMMENTED_CODE_PY));
      issues.push(...checkClassMemberOrder(label, source));
      // An empty `__init__.py` is a package marker: it has no code to divide.
      const hasCode = source.split("\n").some((line: string) => {
        const text = line.trim();
        return text !== "" && !text.startsWith("#");
      });
      if (hasCode && bannerRoots.some((root) => path.startsWith(root))) {
        issues.push(...checkBanners(label, source));
        issues.push(...checkConstantPlacement(label, source));
      }
    }
  }

  const scriptPaths = [...scriptRoots.flatMap((root) => walk(root, SCRIPT_EXTENSIONS)), ...scriptFiles];
  for (const path of scriptPaths) {
    const source = readFileSync(path, "utf-8");
    const label = relative(path);
    issues.push(...checkComments(label, source, COMMENTED_CODE_TS));
    issues.push(...checkScriptLayout(label, source, /\.omp[\\/](hooks|extensions)[\\/]/.test(path)));
    issues.push(...checkScriptClassOrder(label, source));
  }

  issues.push(...checkWhitespaceHygiene());

  return issues;
}

/**
 * Every text asset the repository owns. Directories that belong to a tool
 * (`node_modules`, `.venv`, build output) and pushed migrations are excluded.
 */
function hygieneFiles(): string[] {
  const roots = [
    join(projectRoot, "backend", "app"),
    join(projectRoot, "backend", "tests"),
    join(projectRoot, "backend", "scripts"),
    join(projectRoot, "frontend", "src"),
    join(projectRoot, "decks", "scripts"),
    join(projectRoot, "api"),
    join(projectRoot, ".omp", "rules"),
    join(projectRoot, ".omp", "hooks"),
    join(projectRoot, ".omp", "ast-grep"),
    join(projectRoot, ".omp", "extensions"),
  ];
  const singles = [
    join(projectRoot, "Makefile"),
    join(projectRoot, "docker-compose.yml"),
    join(projectRoot, ".env.example"),
    join(projectRoot, "backend", "Makefile"),
    join(projectRoot, "backend", "pyproject.toml"),
    join(projectRoot, "backend", "alembic.ini"),
    join(projectRoot, "backend", ".env.example"),
    join(projectRoot, "frontend", "Makefile"),
    join(projectRoot, "decks", "Makefile"),
  ];
  return [
    ...roots.flatMap((root) => walk(root, HYGIENE_EXTENSIONS)),
    ...singles.filter((path) => existsSync(path)),
  ];
}

/**
 * Whitespace at a line's end or a file's edge is invisible in an editor and
 * loud in a diff: it turns a one-line change into a multi-line one and hides
 * the real edit. Every text asset in the repository is held to the same shape.
 *
 * Ownership: `ruff` (W291/W293) owns trailing whitespace inside Python, so
 * Python is checked here only at the file boundary — ruff's own W391 is
 * preview-gated and cannot be relied on. Pushed migrations are exempt: they are
 * immutable (`backend-migrations.md`), so their shape is history, not a standard.
 */
function checkWhitespaceHygiene(): string[] {
  const issues: string[] = [];
  for (const path of hygieneFiles()) {
    const source = readFileSync(path, "utf-8");
    if (source === "") continue;
    const label = relative(path);
    const isPython = path.endsWith(".py");
    const isMakefile = path.endsWith("Makefile");

    if (source.includes("\r\n")) {
      issues.push(`${label}: CRLF line endings — the repository is LF only`);
    }
    if (!source.endsWith("\n")) {
      issues.push(`${label}: no final newline — the last line is not a line`);
    } else if (source.endsWith("\n\n")) {
      issues.push(`${label}: blank line at end of file — keep exactly one final newline`);
    }

    source.split("\n").forEach((line: string, index: number) => {
      if (!isPython && /[ \t]+$/.test(line)) {
        issues.push(`${label}:${index + 1}: trailing whitespace`);
      }
      if (!isMakefile && /^\t/.test(line)) {
        issues.push(`${label}:${index + 1}: tab indentation — spaces everywhere but Makefile recipes`);
      }
    });
  }
  return issues;
}

/** Comment hygiene — identical in every language. */
function checkComments(label: string, source: string, commentedCode: RegExp): string[] {
  const issues: string[] = [];
  source.split("\n").forEach((line, index) => {
    const position = `${label}:${index + 1}`;
    if (WORK_MARKER.test(line) && /(^|\s)(#|\/\/|\*)/.test(line)) {
      issues.push(
        `${position}: work marker in a comment — do it now or track it outside the code`,
      );
    }
    if (commentedCode.test(line)) {
      issues.push(
        `${position}: commented-out code — delete it, Git remembers (${line.trim().slice(0, 60)})`,
      );
    }
  });
  return issues;
}

/** Section banners: canonical vocabulary, canonical order, Imports first. */
function checkBanners(label: string, source: string): string[] {
  const issues: string[] = [];
  const banners = [...source.matchAll(/^(# =+)\n# (.+)\n(# =+)$/gm)];
  const titles = banners.map((match) => match[2].trim());

  for (const banner of banners) {
    if (banner[1] !== BANNER_RULE || banner[3] !== BANNER_RULE) {
      const line = source.slice(0, banner.index ?? 0).split("\n").length;
      issues.push(
        `${label}:${line}: banner "${banner[2].trim()}" is drawn ${banner[1].length}/${banner[3].length} ` +
          `wide — every rule line is ${BANNER_RULE.length} characters ("# " + 60 "=")`,
      );
    }
  }

  // Spacing is the other half of the landmark: a banner floating one line below
  // the previous section reads as part of it. Two blank lines everywhere, and
  // nothing above the first banner — a file starts with its own first section.
  for (const banner of banners) {
    const line = source.slice(0, banner.index ?? 0).split("\n").length;
    const before = source.slice(0, banner.index ?? 0).split("\n").slice(0, -1);
    if (before.length === 0) continue;
    let blanks = 0;
    for (let index = before.length - 1; index >= 0 && before[index] === ""; index--) blanks++;
    if (blanks === before.length) {
      issues.push(`${label}:${line}: ${blanks} blank line(s) before the first banner — a file opens with it`);
    } else if (blanks !== 2) {
      issues.push(
        `${label}:${line}: ${blanks} blank line(s) before banner "${banner[2].trim()}" — ` +
          "every section is separated by exactly two",
      );
    }
  }

  for (const { construct, titles: expected, what } of BANNER_FOR_CONSTRUCT) {
    if (!construct.test(source)) continue;
    if (expected.some((title) => titles.includes(title))) continue;
    issues.push(
      `${label}: the file defines ${what} but has no ${expected.map((t) => `"${t}"`).join(" / ")} ` +
        `banner — the section a construct lives in is part of finding it`,
    );
  }
  if (titles.length === 0) {
    issues.push(`${label}: no section banners — every app module opens with an "Imports" banner`);
    return issues;
  }
  if (titles[0] !== "Imports") {
    issues.push(`${label}: first banner is "${titles[0]}" — an app module opens with "Imports"`);
  }
  let previous = -1;
  for (const title of titles) {
    const position = BANNER_ORDER.indexOf(title);
    if (position === -1) {
      issues.push(
        `${label}: banner "${title}" is outside the vocabulary ` +
          `(${BANNER_ORDER.join(" → ")})`,
      );
      continue;
    }
    if (position < previous) {
      issues.push(
        `${label}: banner "${title}" is out of order — sections follow ` +
          BANNER_ORDER.join(" → "),
      );
    }
    previous = position;
  }
  return issues;
}

/** Module constants belong under the Constants banner, above the first class. */
function checkConstantPlacement(label: string, source: string): string[] {
  const issues: string[] = [];
  const constants = [...source.matchAll(/^([A-Z][A-Z0-9_]{2,})\s*(?::[^=\n]+)?=/gm)];
  if (constants.length === 0) return issues;

  if (!/^# =+\n# Constants\n# =+$/m.test(source)) {
    issues.push(
      `${label}: module constants (${constants
        .map((match) => match[1])
        .slice(0, 3)
        .join(", ")}) need a "Constants" banner section`,
    );
  }
  const firstClass = /^class\s+\w+/m.exec(source);
  if (firstClass === null) return issues;
  for (const constant of constants) {
    if ((constant.index ?? 0) > (firstClass.index ?? 0)) {
      issues.push(
        `${label}: constant ${constant[1]} is declared after the first class — ` +
          "module constants sit in the Constants section, above the classes",
      );
    }
  }
  return issues;
}

/**
 * Python class members: state before behaviour, and the public surface before
 * the helpers that serve it. A reader looking for what a class holds should not
 * scroll past behaviour to find it.
 */
function checkClassMemberOrder(label: string, source: string): string[] {
  const issues: string[] = [];
  for (const block of splitPythonClasses(source)) {
    const members = pythonMembers(block.body);
    issues.push(...checkMemberRanks(label, block, members, PY_MEMBER_RANK, PY_MEMBER_ORDER_TEXT));

    const methods = members.filter((member) => member.kind === "method").map((m) => m.name);
    if (methods.length === 0) continue;

    // `__init__` position is the rank rule's job now that it has its own kind:
    // a method before it ranks 5 against its 4.
    const publicMethods = methods
      .map((name, index) => ({ name, index }))
      .filter((entry) => !entry.name.startsWith("_"));
    // A dunder is a protocol implementation (`__aenter__`, `__repr__`), not a
    // private helper: its position is dictated by the protocol, not by taste.
    const privateMethods = methods
      .map((name, index) => ({ name, index }))
      .filter((entry) => entry.name.startsWith("_") && !/^__\w+__$/.test(entry.name));
    if (publicMethods.length === 0 || privateMethods.length === 0) continue;
    const lastPublic = publicMethods[publicMethods.length - 1];
    const firstPrivate = privateMethods[0];
    if (firstPrivate.index < lastPublic.index) {
      issues.push(
        `${label}:${block.name}: private ${firstPrivate.name}() precedes public ` +
          `${lastPublic.name}() — helpers belong below the public surface`,
      );
    }
  }
  return issues;
}

/** Imports, then constants, then the entry point, then its helpers. */
function checkScriptLayout(label: string, source: string, isHook: boolean): string[] {
  const issues: string[] = [];
  const lines = source.split("\n");

  if (isHook && !source.slice(0, 2000).includes("/**")) {
    issues.push(
      `${label}: missing JSDoc header — a hook or lib whose purpose is undocumented ` +
        "cannot be reviewed against the rule it serves",
    );
  }

  lines.forEach((line, index) => {
    if (/^let\s+[A-Z][A-Z0-9_]*\s*[:=]/.test(line)) {
      issues.push(
        `${label}:${index + 1}: module constant declared with let — a reassignable ` +
          "constant is a lie; compute the value once and use const",
      );
    }
  });

  const lastImport = lines.reduce(
    (last, line, index) => (/^import\s/.test(line) ? index : last),
    -1,
  );
  if (lastImport === -1) return issues;

  const firstConstant = lines.findIndex((line) => /^const\s+[A-Za-z_]/.test(line));
  if (firstConstant !== -1 && firstConstant < lastImport) {
    issues.push(`${label}: a const is declared before the last import`);
  }
  const exportDefault = lines.findIndex((line) => /^export default function/.test(line));
  const firstFunction = lines.findIndex((line) => /^function\s/.test(line));
  if (exportDefault !== -1 && firstFunction !== -1 && firstFunction < exportDefault) {
    issues.push(
      `${label}: a helper function precedes "export default" — the file reads ` +
        "top-down from its entry point to its details",
    );
  }
  return issues;
}

/** TypeScript/JavaScript classes follow the same shape as Python's. */
function checkScriptClassOrder(label: string, source: string): string[] {
  const issues: string[] = [];
  for (const block of splitScriptClasses(source)) {
    const members = scriptMembers(block.body);
    issues.push(...checkMemberRanks(label, block, members, TS_MEMBER_RANK, TS_MEMBER_ORDER_TEXT));

    const methods = members.filter((member) => member.kind === "method");
    const lastPublic = methods.filter((member) => !isPrivateName(member.name)).pop();
    const firstPrivate = methods.find((member) => isPrivateName(member.name));
    if (lastPublic !== undefined && firstPrivate !== undefined && firstPrivate.line < lastPublic.line) {
      issues.push(
        `${label}:${block.line + firstPrivate.line}: ${block.name}.${firstPrivate.name}() is ` +
          `private but precedes public ${lastPublic.name}() — helpers belong below the ` +
          "public surface",
      );
    }
  }
  return issues;
}

// ============================================================
// Helpers
// ============================================================

function walk(dir: string, extensions: string[], recursive = true): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (WALK_EXCLUDES.has(entry.name)) {
      continue;
    }
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) found.push(...walk(path, extensions));
      continue;
    }
    if (extensions.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }
  return found;
}

/** Members must appear in rank order; the first regression names both sides. */
function checkMemberRanks(
  label: string,
  block: ClassBlock,
  members: ClassMember[],
  ranks: Record<string, number>,
  orderText: string,
): string[] {
  const issues: string[] = [];
  let highest = -1;
  let highestKind = "";
  for (const member of members) {
    const rank = ranks[member.kind];
    if (rank < highest) {
      issues.push(
        `${label}:${block.line + member.line}: ${block.name}.${member.name} — ` +
          `${member.kind} declared after ${highestKind}; members run ${orderText}`,
      );
      continue;
    }
    highest = rank;
    highestKind = member.kind;
  }
  return issues;
}

/**
 * A class body ends at the first line that returns to module level, so code
 * following a class is never mistaken for one of its members.
 */
function splitPythonClasses(source: string): ClassBlock[] {
  const lines = source.split("\n");
  const classes: ClassBlock[] = [];
  lines.forEach((line, index) => {
    const start = /^class\s+(\w+)[^\n]*:\s*$/.exec(line);
    if (start === null) return;
    let end = index + 1;
    while (end < lines.length && (lines[end].trim() === "" || /^\s/.test(lines[end]))) end += 1;
    classes.push({ name: start[1], body: lines.slice(index, end).join("\n"), line: index + 1 });
  });
  return classes;
}

/**
 * Top-level members of a Python class body, ignoring anything inside brackets
 * or inside a docstring.
 *
 * A decorated property is **one** member. Counting the `@property` line and its
 * `def` separately made the two order rules mutually unsatisfiable for any class
 * holding both a property and `__init__`: before `__init__` the property's `def`
 * counted as a method, so "__init__ comes after last_exchange()" fired; after
 * `__init__` the decorator ranked as a property behind a method, so "property
 * declared after method" fired. Measured on `IntegrationClient`, the first class
 * in this codebase to have both.
 *
 * Docstrings are prose, and prose is not a member. Bracket depth was tracked
 * from the start but string state was not, so a docstring line opening with
 * `word:` — `derived: counting the ledger is wrong` — was read as a field
 * declaration and the class's real `__tablename__` below it was reported as
 * "config declared after field". Measured; the workaround at the time was to
 * reword the sentence.
 */
function pythonMembers(body: string): ClassMember[] {
  const members: ClassMember[] = [];
  let depth = 0;
  let inDocstring = false;
  let pendingProperty = false;
  const lines = body.split("\n");
  lines.forEach((line, index) => {
    const fences = (line.match(/"""|'''/g) ?? []).length;
    const closesHere = inDocstring && fences % 2 === 1;
    if (fences % 2 === 1) inDocstring = !inDocstring;
    if (inDocstring || closesHere) return;
    if (depth === 0 && /^ {4}\S/.test(line)) {
      const config = PY_CONFIG.exec(line);
      const method = PY_METHOD.exec(line);
      const field = PY_FIELD.exec(line);
      if (config !== null) members.push({ kind: "config", name: config[1], line: index });
      else if (PY_PROPERTY.test(line)) {
        members.push({ kind: "property", name: "@property", line: index });
        pendingProperty = true;
      } else if (method !== null) {
        if (pendingProperty) {
          // The `def` the decorator applies to: name the property after it and
          // count nothing extra.
          members[members.length - 1].name = method[1];
          pendingProperty = false;
        } else {
          members.push({
            kind: method[1] === "__init__" ? "init" : "method",
            name: method[1],
            line: index,
          });
        }
      } else if (field !== null) {
        // `ruff format` wraps a long value in parentheses, leaving `= (` on the
        // field's line and `relationship(` on the next; classify by the value.
        const value = /=\s*\(\s*$/.test(line) ? `${line}${lines[index + 1] ?? ""}` : line;
        members.push({
          kind: /\brelationship\(/.test(value) ? "relationship" : "field",
          name: field[1],
          line: index,
        });
      }
    }
    for (const character of line) {
      if ("([{".includes(character)) depth += 1;
      else if (")]}".includes(character)) depth -= 1;
    }
  });
  return members;
}

/** Class bodies in TS/JS, delimited by brace depth. */
function splitScriptClasses(source: string): ClassBlock[] {
  const lines = source.split("\n");
  const classes: ClassBlock[] = [];
  lines.forEach((line, index) => {
    const start = TS_CLASS_OPEN.exec(line);
    if (start === null) return;
    let depth = 0;
    let end = index;
    while (end < lines.length) {
      for (const character of lines[end]) {
        if (character === "{") depth += 1;
        else if (character === "}") depth -= 1;
      }
      if (depth === 0 && end > index) break;
      end += 1;
    }
    classes.push({ name: start[1], body: lines.slice(index, end + 1).join("\n"), line: index + 1 });
  });
  return classes;
}

/** Members declared directly in a TS/JS class body. */
function scriptMembers(body: string): ClassMember[] {
  const members: ClassMember[] = [];
  let depth = 0;
  // Parentheses, not only braces. A signature that wraps keeps the brace depth
  // at 1, so every parameter line (`status: number,`) matched the field pattern
  // and was reported as "a field declared after the constructor". Measured the
  // moment `ApiError`'s constructor took a fifth parameter and prettier wrapped
  // it: five real fields, in the right order, five failures.
  let paren = 0;
  body.split("\n").forEach((line, index) => {
    if (depth === 1 && paren === 0) {
      const method = TS_METHOD.exec(line);
      const field = TS_FIELD.exec(line);
      if (TS_CONSTRUCTOR.test(line)) members.push({ kind: "constructor", name: "constructor", line: index });
      else if (method !== null) members.push({ kind: "method", name: method[1], line: index });
      else if (field !== null) members.push({ kind: "field", name: field[1], line: index });
    }
    for (const character of line) {
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === "(") paren += 1;
      else if (character === ")") paren -= 1;
    }
  });
  return members;
}

function isPrivateName(name: string): boolean {
  return name.startsWith("#") || name.startsWith("_");
}

function relative(path: string): string {
  return path.startsWith(projectRoot) ? path.slice(projectRoot.length + 1) : path;
}

// Direct execution (make check-code-layout): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-code-layout.ts")) {
  const issues = checkCodeLayoutSync();
  console.log("==> check-code-layout");
  if (issues.length === 0) {
    console.log("    PASS: code layout standard valid");
  } else {
    for (const issue of issues) {
      console.log(`    FAIL: ${issue}`);
    }
    printRuleHint("check-code-layout");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
