// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";

/**
 * The backend directory charter — one declaration, every derivation.
 *
 * rule://backend-layout documents what each directory holds and
 * `strict-backend-app-structure` blocks writes outside it, but until this file
 * the *shape* of each layer — which ones hold folder domains, which are flat —
 * lived only in prose and in one traversal helper's habit of descending a
 * level. Every hook that re-implemented the walk from the directory name alone
 * went blind the day a domain became a folder: measured at seven checks, one of
 * which (`relationship lazy=`) applied to zero of the ten relationships it
 * existed to guard.
 *
 * So the shape is a value, and its consumers derive from it instead of
 * restating it:
 *
 * - `strict-backend-app-structure` (write side) — which directories may exist,
 *   how deep a file may sit in each, and what a file there is named;
 * - `layerFiles()` (read side) — the one traversal every scan uses;
 * - `check-omp-hooks` (meta) — rejects a hook that walks a layer by hand;
 * - `check-backend-layout` — every directory declared, every module named for
 *   its directory, every import inside its charter.
 *
 * A charter has three axes. *Holds* is prose, kept in rule://backend-layout
 * and matched row for row against this table. *Imports* is where a module may
 * reach outside its own unit. *Files* is the name every module directly in the
 * directory carries, when the directory holds one kind of thing.
 *
 * `depth` is the number of directory levels a file may sit below the layer
 * root: `0` is flat (`routers/user.py`), `1` allows folder domains
 * (`models/project/endpoint.py` — "a domain folder holds table files, never more
 * folders"), `null` is unconstrained (`tests/` mirrors the layers and nests
 * fixtures deeper).
 */

/** What one directory may hold and reach. */
export interface DirectoryCharter {
  /** Where an import from a module here may land, besides its own unit: a layer (`core`), a folder (`<layer>/<folder>`) or one module (`dependencies/query`). `*` is anything. */
  readonly imports: readonly string[];
  /** The name every module directly here carries, when the directory is one kind of thing. */
  readonly files?: RegExp;
}

/** A layer's charter, its depth, and its closed set of folders when it has one. */
export interface LayerCharter extends DirectoryCharter {
  readonly depth: 0 | 1 | null;
  /** A closed set of folders, each its own charter; absent means open domain folders sharing the layer's charter. */
  readonly folders?: Readonly<Record<string, DirectoryCharter>>;
}

export const APP_LAYERS: Readonly<Record<string, LayerCharter>> = {
  core: { depth: 0, imports: [] },
  // `engine` is pure (no session, no table), so it sits below `models`: a
  // model's CHECK constraint reads the engine's closed vocabulary
  // (`matcher.METHODS`) instead of restating it.
  engine: { depth: 0, imports: ["core"] },
  models: { depth: 1, imports: ["core", "engine"] },
  schemas: { depth: 1, imports: ["core", "engine", "models"] },
  repositories: { depth: 1, imports: ["core", "engine", "models", "schemas"] },
  services: { depth: 1, imports: ["core", "engine", "models", "repositories", "schemas"] },
  dependencies: { depth: 0, imports: ["core", "engine", "models", "schemas", "services"] },
  routers: { depth: 0, imports: ["core", "dependencies", "engine", "schemas"] },
  tests: { depth: null, imports: ["*"] },
};

/**
 * Every `.py` in one layer, one level of nesting deep, as paths relative to the
 * layer root: `user.py`, `batch/run.py`.
 *
 * One level is the whole convention, so the walk is fixed rather than read from
 * `APP_LAYERS` — a flat layer simply has no directories to descend into, and
 * `tests/` scans pass their own subtree. What the spec above adds is the write
 * gate and the meta-check; this function is the read side they both assume.
 */
export function layerFiles(layerDir: string): string[] {
  if (!existsSync(layerDir)) return [];
  const files: string[] = [];
  for (const entry of readdirSync(layerDir, { withFileTypes: true })) {
    if (entry.name === "__pycache__" || entry.name === "__init__.py") continue;
    if (entry.isDirectory()) {
      for (const inner of readdirSync(join(layerDir, entry.name))) {
        if (inner.endsWith(".py") && inner !== "__init__.py") files.push(`${entry.name}/${inner}`);
      }
    } else if (entry.name.endsWith(".py")) {
      files.push(entry.name);
    }
  }
  return files;
}

/**
 * Why a write at this depth is refused, or null when the layer allows it.
 *
 * `backend/app/routers/sub/x.py` passed the write gate before this existed: the
 * gate checked only that `routers` is a known directory, so the flat shape every
 * router scan assumes was enforced by nothing. A file two levels under `models/`
 * is the same defect one door down — the traversal descends exactly one level,
 * so a deeper file would be written and then seen by no check at all.
 */
export function layerDepthViolation(appRelative: string): string | null {
  const segments = appRelative.split("/");
  const layer = APP_LAYERS[segments[0]];
  if (layer === undefined || layer.depth === null) return null;
  const directoryDepth = segments.length - 2;
  if (directoryDepth <= layer.depth) return null;
  return layer.depth === 0
    ? `\`${segments[0]}/\` is a flat layer — its files sit at the layer root, and every scan of it assumes that`
    : `\`${segments[0]}/\` allows one folder level (a domain), never more — a deeper file is invisible to every layer scan`;
}

/**
 * The unit a module belongs to: `<layer>/<folder>` inside a layer with a
 * closed folder set, `<layer>` otherwise, `main.py` for the assembly.
 *
 * `appRelativeModule` is the dotted path after `app.`, split — a file without
 * its `.py`.
 */
export function moduleUnit(appRelativeModule: string[]): string {
  const [layer, folder] = appRelativeModule;
  if (layer === "main") return "main.py";
  const folders = APP_LAYERS[layer]?.folders;
  if (folders !== undefined && folder !== undefined && folders[folder] !== undefined) return `${layer}/${folder}`;
  return layer;
}

/** The charter a unit answers to, or undefined for an undeclared one. */
export function unitCharter(unit: string): DirectoryCharter | undefined {
  const [layer, folder] = unit.split("/");
  const charter = APP_LAYERS[layer];
  if (folder === undefined) return charter;
  return charter?.folders?.[folder];
}

/**
 * Whether a module in `sourceUnit` may import `app.<target…>`.
 *
 * Its own unit is always reachable; an open layer's domain folders reach one
 * another; anything else must be named by the charter, as a layer, a folder or
 * one module — an entry is a prefix of the target's path.
 */
export function importAllowed(sourceUnit: string, target: string[]): boolean {
  if (sourceUnit === "main.py") return true;
  const charter = unitCharter(sourceUnit);
  if (charter === undefined) return false;
  if (charter.imports.includes("*")) return true;
  if (moduleUnit(target) === sourceUnit) return true;
  const [sourceLayer, sourceFolder] = sourceUnit.split("/");
  if (sourceFolder === undefined && APP_LAYERS[sourceLayer]?.folders === undefined && target[0] === sourceLayer) return true;
  return charter.imports.some((entry) => {
    const parts = entry.split("/");
    return parts.every((part, index) => target[index] === part);
  });
}

/**
 * Python source with its docstrings and comments blanked, line count kept:
 * an import quoted in prose is no import.
 */
export function pythonCode(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/g, "");
  return source
    .replace(/"""[\s\S]*?"""|'''[\s\S]*?'''/g, blank)
    .replace(/#[^\n]*/g, "");
}

/**
 * Why a write breaks the directory charter, or null when it keeps it: a folder
 * a closed layer does not declare, or a module named against its directory.
 */
export function layoutViolation(appRelative: string): string | null {
  const segments = appRelative.split("/");
  const layer = APP_LAYERS[segments[0]];
  if (layer === undefined || layer.depth === null) return null;
  const fileName = segments[segments.length - 1];
  let charter: DirectoryCharter = layer;
  let directory = segments[0];
  if (segments.length > 2) {
    if (layer.folders === undefined) return null;
    const folder = layer.folders[segments[1]];
    if (folder === undefined) {
      return `\`${segments[0]}/\` 에 선언되지 않은 폴더 생성 금지 (rule://backend-layout)\n\n선언된 폴더만 사용하세요:\n  ${Object.keys(layer.folders).map((f) => `${f}/`).join(", ")}`;
    }
    charter = folder;
    directory = `${segments[0]}/${segments[1]}`;
  }
  if (!fileName.endsWith(".py") || fileName === "__init__.py" || charter.files === undefined) return null;
  if (charter.files.test(fileName)) return null;
  return `\`${directory}/\` 의 모듈 이름 규칙 위반 (rule://backend-layout)\n\n\`${directory}/\` 는 한 종류의 모듈만 둔다 — \`${fileName}\` 는 ${charter.files} 가 아니다`;
}

/**
 * The text between the bracket at `open` and the one that closes it.
 *
 * A Python call spans lines the way `ruff format` breaks it, and a reader
 * that stops at the first line ending in `)` stops inside the call — measured
 * on `relationship(primaryjoin=lambda: foreign(X.col)\n== Y.col,
 * ..., lazy=...)`: the `lazy=` check read one line and reported it missing on
 * seven of seventeen relationships that had it.
 */
export function balanced(content: string, open: number): string {
  let depth = 0;
  for (let i = open; i < content.length; i += 1) {
    if (content[i] === "(" || content[i] === "[" || content[i] === "{") depth += 1;
    else if (content[i] === ")" || content[i] === "]" || content[i] === "}") {
      depth -= 1;
      if (depth === 0) return content.slice(open + 1, i);
    }
  }
  return content.slice(open + 1);
}
