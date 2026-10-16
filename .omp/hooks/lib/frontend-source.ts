/**
 * Frontend source discovery — shared by every `check-frontend-*` hook.
 *
 * One module owns "what files exist and what a domain is", so six hooks cannot
 * disagree about which tree they are checking. Everything here is read-only and
 * pure: the hooks decide what is a violation, this decides what to look at.
 */

// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join, relative, sep } from "node:path";

/** Extensions the frontend standard governs. */
const SOURCE_EXTENSIONS = [".ts", ".tsx"];

/** Directories inside `src/` that belong to a tool, not to the standard. */
const SKIPPED_DIRECTORIES: Record<string, true> = { node_modules: true, dist: true };

/**
 * `mock` has a service and an endpoint table, but it is an action — send one
 * request to a mocked URL — not a resource: there is no list, no CRUD dialog
 * and no navigation entry to require.
 */
const NON_RESOURCE_DOMAINS: Record<string, true> = { mock: true };

export interface SourceFile {
  /** Absolute path. */
  path: string;
  /** Repository-relative label for a warning line. */
  label: string;
  content: string;
}

export const projectRoot = existsSync(join(process.cwd(), "frontend", "src"))
  ? process.cwd()
  : join(process.cwd(), "..");

export const frontendSrc = join(projectRoot, "frontend", "src");

/** What one `src/` directory or root file may import, and how its files are named. */
export interface SourceCharter {
  /** The top-level `src/` names an `@/` import from here may land in, besides its own; `*` is anything. */
  readonly imports: readonly string[];
  /** The name every file directly in the directory carries, when it holds one kind of thing. */
  readonly files?: RegExp;
  /** How the directory's subfolders import one another: `acyclic` freely but never in a cycle, `none` never. */
  readonly peers?: "acyclic" | "none";
}

/**
 * The frontend layout — what may exist directly under `frontend/src/`, what
 * each entry may import, and how its files are named (rule://frontend-layout).
 *
 * The backend twin (`backend-layout.ts`) also constrains depth, because flat
 * layer scans went blind when domains became folders. Here the read side
 * (`walkSources`) is fully recursive, so depth blinds nothing: the write gate
 * refuses a new top-level directory (`frontend/src/adapters/`) the way
 * `strict-backend-app-structure` refuses `backend/app/adapters/`, and a file
 * named against its directory (`pages/Foo.tsx`); `check-frontend-layout` holds
 * every import to its charter.
 */
export const SRC_LAYOUT: {
  directories: Readonly<Record<string, SourceCharter>>;
  rootFiles: Readonly<Record<string, SourceCharter>>;
} = {
  directories: {
    types: { imports: [], files: /^[a-z]+\.ts$/ },
    utils: { imports: [], files: /^[a-z][A-Za-z]*\.ts$/ },
    locales: { imports: [] },
    routes: { imports: [], files: /^paths\.ts$/ },
    theme: { imports: ["config"] },
    lib: { imports: ["config", "types"] },
    hooks: { imports: ["config", "lib", "locales", "types", "utils"], files: /^use[A-Z][A-Za-z]*\.ts$/ },
    components: { imports: ["config", "hooks", "lib", "locales", "theme", "types", "utils"], peers: "acyclic" },
    layouts: {
      imports: ["components", "config", "hooks", "lib", "locales", "routes", "theme", "types", "utils"],
      peers: "none",
    },
    sections: {
      imports: ["components", "config", "hooks", "lib", "locales", "routes", "theme", "types", "utils"],
      peers: "none",
    },
    pages: {
      imports: ["components", "config", "hooks", "locales", "routes", "sections", "types"],
      files: /^[A-Z][A-Za-z]*Page\.tsx$/,
    },
  },
  rootFiles: {
    "App.tsx": { imports: ["*"] },
    "main.tsx": { imports: ["*"] },
    "Providers.tsx": { imports: ["*"] },
    "config.ts": { imports: [] },
    "styles.css": { imports: [] },
    "vite-env.d.ts": { imports: [] },
  },
};

/** Why a file written at `srcRelative` is named against its directory, or null. */
export function sourceFileViolation(srcRelative: string): string | null {
  const segments = srcRelative.split("/");
  if (segments.length !== 2) return null;
  const pattern = SRC_LAYOUT.directories[segments[0]]?.files;
  if (pattern === undefined || pattern.test(segments[1])) return null;
  return `\`src/${segments[0]}/\` 의 파일 이름 규칙 위반 (rule://frontend-layout)\n\n\`src/${segments[0]}/\` 는 한 종류의 파일만 둔다 — \`${segments[1]}\` 는 ${pattern} 가 아니다`;
}

export const SRC_DIRECTORIES = {
  components: join(frontendSrc, "components"),
  hooks: join(frontendSrc, "hooks"),
  layouts: join(frontendSrc, "layouts"),
  lib: join(frontendSrc, "lib", "api"),
  locales: join(frontendSrc, "locales"),
  pages: join(frontendSrc, "pages"),
  routes: join(frontendSrc, "routes"),
  sections: join(frontendSrc, "sections"),
  services: join(frontendSrc, "lib", "api", "services"),
  queryHooks: join(frontendSrc, "lib", "api", "hooks"),
  types: join(frontendSrc, "types"),
} as const;

export function walkSources(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES[entry.name] !== true) stack.push(join(dir, entry.name));
      } else if (SOURCE_EXTENSIONS.some((ext: string) => entry.name.endsWith(ext))) {
        files.push(join(dir, entry.name));
      }
    }
  }
  return files.sort();
}

export function readSources(root: string): SourceFile[] {
  return walkSources(root).map((path: string) => ({
    path,
    label: label(path),
    content: readFileSync(path, "utf-8"),
  }));
}

export function label(path: string): string {
  return relative(projectRoot, path).split(sep).join("/");
}

export function readIfPresent(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf-8") : null;
}

/**
 * Source with comments removed — the first step of every structural read.
 *
 * A check that scans raw source matches the prose explaining the construct as
 * readily as the construct: a style assertion here once passed against a file
 * whose style had been deleted, because the comment above it still named the
 * property. Both JSX (`{/* … *\/}`) and plain block comments go, then whole-line
 * `//` — a trailing `//` is left alone, since stripping it would need the string
 * tracking the callers do for themselves.
 */
export function stripComments(content: string): string {
  return content
    .replace(/\{\/\*[\s\S]*?\*\/\}|\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * A domain is a `<name>.service.ts`: the service is the layer that cannot be
 * skipped, so it is the only honest place to enumerate domains from. Action
 * services are excluded — see `NON_RESOURCE_DOMAINS`.
 */
export function discoverDomains(): string[] {
  if (!existsSync(SRC_DIRECTORIES.services)) return [];
  return readdirSync(SRC_DIRECTORIES.services)
    .filter((file: string) => file.endsWith(".service.ts"))
    .map((file: string) => file.replace(/\.service\.ts$/, ""))
    .filter((name: string) => NON_RESOURCE_DOMAINS[name] !== true)
    .sort();
}

/** `user` → `User`, `integration` → `Integration`. */
export function pascalCase(domain: string): string {
  return domain
    .split(/[-_]/)
    .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

/**
 * The opening tag that starts at `index` (`<Name …>` or `<Name … />`), read to
 * the first `>` outside every `{…}`, quoted string and comment - so an arrow's
 * `=>`, a `>` inside a prop's expression or an apostrophe in a comment between
 * props does not end it. A slice that leaned on indentation (`"\n      />"`)
 * read past a re-indented tag into the next element's props; this reads the
 * tag's own syntax instead.
 */
export function jsxOpeningTag(content: string, index: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let at = index + 1; at < content.length; at += 1) {
    const char = content[at];
    if (quote !== null) {
      if (char === "\\") at += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && content[at + 1] === "/") {
      const end = content.indexOf("\n", at);
      at = end === -1 ? content.length : end;
    } else if (char === "/" && content[at + 1] === "*") {
      const end = content.indexOf("*/", at + 2);
      at = end === -1 ? content.length : end + 1;
    } else if (char === '"' || char === "'" || char === "`") quote = char;
    else if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return content.slice(index, at + 1);
  }
  return content.slice(index);
}
