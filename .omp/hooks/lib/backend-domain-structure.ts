// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { balanced, layerFiles } from "./backend-layout.ts";
import { ledgerTablesOf } from "./backend-ledger-feeds.ts";
import { derivedTablesOf } from "./backend-derivations.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { resolveProjectRoot } from "./hook-project-root.ts";

/**
 * Domain structure checks — 5-layer CRUD pattern (backend-domain.md).
 *
 * Validates:
 *   - model filename format (<name>.py, lowercase alphanumeric)
 *   - data chain existence (model → schema → repository → service; router optional)
 *   - file contents per layer (model/schema/repository/service/router/DI/main/env)
 *   - the schema layer's public surface (Pydantic classes + to_read/to_read_list)
 *   - no generic `find_stale` finder (retention is per-domain, by its own column)
 *
 * Pure validation — no ast-grep, no side effects. Called by the
 * check-backend-domain orchestrator.
 */

const projectRoot = resolveProjectRoot();

/**
 * The only module-level functions a schema module may expose.
 *
 * Not a style list: these two are the layer's documented surface
 * (backend-domain.md), and every other public function in `schemas/` is logic
 * that belongs to whoever calls it.
 */
const SCHEMA_PUBLIC_FUNCTIONS = new Set(["to_read", "to_read_list"]);

/**
 * A schema module exposes its Pydantic classes and nothing else but
 * `to_read`/`to_read_list`.
 *
 * Measured on this repository: a ledger domain grew two public functions in
 * `schemas/` — one building a request object out of an external API record,
 * one normalising a timestamp a driver had handed back naive. Both were
 * imported by the service, both passed every gate, and neither belonged to the
 * schema layer: the first is a constructor of the class it returns, the second
 * is a comparison detail of the caller. The reason they landed there is
 * mechanical, not careless — `domain/service-method-async.yml` forbids a sync
 * `def` anywhere in `services/`, so `schemas/` is the nearest place a helper
 * compiles, and nothing was watching it.
 *
 * The fix a violation names is therefore concrete: put a constructor on the
 * class (`<Class>.from_record`), and keep a caller's detail in the caller.
 */
/**
 * `user` → `User`, `food_barcode` → `FoodBarcode`.
 *
 * Capitalising the first letter alone was enough while every flat domain was one
 * word: the first two-word table (`food_barcode`, the first of five sibling
 * ledgers from one provider) made this check demand a class called
 * `Food_barcode`, which no Python file would ever be allowed to declare.
 */
/**
 * One entry per schema file: `[leaf, source]`, with `null` for a flat domain.
 *
 * The families a file may declare depend on which leaf it is, so the check
 * reads the files apart rather than through `readLayerSource`'s concatenation.
 */
function schemaLeafSources(schemaDir: string, name: string): [string | null, string][] {
  const flat = join(schemaDir, `${name}.py`);
  if (existsSync(flat)) return [[null, readFileSync(flat, "utf-8")]];
  const folder = join(schemaDir, name);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((file: string) => file.endsWith(".py") && file !== "__init__.py")
    .sort()
    .map((file: string): [string | null, string] => [
      file.replace(/\.py$/, ""),
      readFileSync(join(folder, file), "utf-8"),
    ]);
}

function pascalCase(domain: string): string {
  return domain
    .split("_")
    .map((part: string) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

export function checkSchemaSurface(base: string): string[] {
  const issues: string[] = [];
  const schemaDir = join(base, "schemas");
  if (!existsSync(schemaDir)) return issues;

  for (const file of layerFiles(schemaDir)) {
    const source = readFileSync(join(schemaDir, file), "utf-8");
    for (const declaration of source.matchAll(/^(?:async )?def (\w+)\(/gm)) {
      const name = declaration[1];
      if (name.startsWith("_") || SCHEMA_PUBLIC_FUNCTIONS.has(name)) continue;
      issues.push(
        `schemas/${file}: \`${name}()\` is a public function in the schema layer — ` +
          "its surface is the Pydantic classes plus to_read/to_read_list. Put a " +
          "constructor on the class it builds (`<Class>.from_record`), keep a " +
          "caller's detail in the caller, or make it module-private (`_name`)",
      );
    }
  }
  return issues;
}

/**
 * Under asyncio there is no safe lazy default: a relationship touched outside a
 * loaded query raises `MissingGreenlet` from deep inside greenlet plumbing, at
 * whichever endpoint happens to touch it first. `lazy="raise_on_sql"` moves that
 * failure to the access itself with a sentence a reader can act on, and makes
 * the eager-load contract enforceable by the runtime instead of by review.
 */
/**
 * `find_stale` is banned by name, in every repository and service.
 *
 * It used to be the template: every repository had to define it and had to
 * filter `created_at < older_than`. Measured across the tree the day it was
 * removed: fourteen definitions, zero business callers — pure scaffolding —
 * and the one blanket semantic was wrong for every table that has a real
 * retention story. A user is stale by last activity, a token by its own
 * expiry (`find_expired`/`expires_at`), a run by when it finished
 * (`find_finished_before`/`finished_at`). Purging any of them by creation
 * date deletes active rows.
 *
 * So a retention finder is named for its semantic and its column, and exists
 * only where something calls it. A master table gets none.
 */
export function checkNoGenericStaleFinder(base: string): string[] {
  const issues: string[] = [];
  for (const layer of ["repositories", "services"]) {
    const layerDir = join(base, layer);
    if (!existsSync(layerDir)) continue;
    for (const file of layerFiles(layerDir)) {
      const source = readFileSync(join(layerDir, file), "utf-8");
      const line = source.split("\n").findIndex((text: string) => text.includes("def find_stale("));
      if (line === -1) continue;
      issues.push(
        `${layer}/${file}:${line + 1}: \`find_stale\` is the retired blanket finder — name the ` +
          "semantic and its column (find_expired/expires_at, find_finished_before/finished_at), " +
          "and only where a caller exists; a created_at purge deletes active rows",
      );
    }
  }
  return issues;
}

export function checkRelationshipLoading(base: string): string[] {
  const issues: string[] = [];
  const modelsDir = join(base, "models");
  if (!existsSync(modelsDir)) return issues;

  // A folder domain's tables are one level down, and a relationship declared
  // there needs its `lazy=` policy just as much — under asyncio a forgotten
  // eager load is a MissingGreenlet in production, not a slow query.
  for (const file of layerFiles(modelsDir)) {
    const source = readFileSync(join(modelsDir, file), "utf-8");
    // The call spans lines the way `ruff format` breaks it (and may sit in
    // parentheses of its own); read to the parenthesis that closes it.
    for (const match of source.matchAll(/^\s*(\w+):[^\n]*=\s*(?:\(\s*)?relationship\(/gm)) {
      const call = balanced(source, match.index + match[0].length - 1);
      if (/lazy=/.test(call)) continue;
      const line = source.slice(0, match.index).split("\n").length;
      issues.push(
        `models/${file}:${line}: ${match[1]} declares no \`lazy=\` policy — ` +
          'under asyncio use lazy="raise_on_sql" so a forgotten eager load fails at the ' +
          "access instead of raising MissingGreenlet in production",
      );
    }
  }
  return issues;
}

/**
 * A column's closed vocabulary survives into the schema that exposes it.
 *
 * `check-backend-table-design` already requires a short type/status/mode column
 * to carry `CheckConstraint("<col> IN (...)")`. That is where the vocabulary is
 * *decided*; this is where it is **kept**. A schema field that widens the column
 * back to `str` throws the set away at the only layer a client can read, and the
 * loss is silent in both directions — the server still refuses a bad value, so
 * nothing fails until a reader has to guess what the column can hold.
 *
 * The chain this closes: constraint → `Literal[...]` → (`check-frontend-types`,
 * which already maps a `Literal` to the same TS union) → the union a screen
 * switches on. Measured before it existed: `integration_field` kept its four
 * vocabularies through all three layers while `batch_run.status`,
 * `batch_run.trigger`, `batch_step.status`, `integration_call.method` and
 * `integration_call.outcome` were `str` in their schemas — and the TS side had
 * been narrowed by hand, answerable to nothing.
 *
 * Model file and schema file mirror by path (`models/batch/run.py` ↔
 * `schemas/batch/run.py`), which is what keeps a `status` on one table from being
 * compared against another table's.
 */
export function checkClosedVocabularyExposed(base: string): string[] {
  const issues: string[] = [];
  const modelsDir = join(base, "models");
  const schemasDir = join(base, "schemas");
  if (!existsSync(modelsDir) || !existsSync(schemasDir)) return issues;

  for (const relative of layerFiles(modelsDir)) {
    const source = readFileSync(join(modelsDir, relative), "utf-8");
    const schemaPath = join(schemasDir, relative);
    for (const [column, values] of closedValueSets(source)) {
      if (!existsSync(schemaPath)) continue;
      const schema = readFileSync(schemaPath, "utf-8");
      for (const annotation of fieldAnnotations(schema, column)) {
        const declared = literalValues(schema, annotation, base);
        if (declared === null) {
          issues.push(
            `schemas/${relative}: ${column}: ${annotation} widens a closed set back to a ` +
              `free string — the column accepts only ${values.join(", ")}, so declare a ` +
              "Literal alias and let the reader switch on it",
          );
          continue;
        }
        const missing = values.filter((value: string) => !declared.has(value));
        const extra = [...declared].filter((value: string) => !values.includes(value));
        if (missing.length === 0 && extra.length === 0) continue;
        issues.push(
          `schemas/${relative}: ${column} declares a Literal the constraint does not ` +
            `match — ${missing.length > 0 ? `missing ${missing.join(", ")}` : ""}` +
            `${missing.length > 0 && extra.length > 0 ? "; " : ""}` +
            `${extra.length > 0 ? `not in the constraint: ${extra.join(", ")}` : ""}`,
        );
      }
    }
  }
  return issues;
}

/**
 * An input the API accepts must fit the column that stores it.
 *
 * The frontend/backend length parity (`check-frontend-contract`) compares a form
 * against the schema. This is the layer below it, and its failure is worse: a
 * value the schema admits and the column cannot hold is not a 422, it is an
 * `IntegrityError` from the database — a 500 the user cannot act on and the log
 * reports as a server fault rather than bad input.
 *
 * Two ways to get there, and both are checked:
 *
 * - the schema caps higher than the column (`max_length=200` into `String(120)`);
 * - the schema does not cap at all, so any string reaches a bounded column.
 *
 * Only `*CreateRequest` / `*UpdateRequest` matter: those are the inputs. A read
 * response carries what the row already holds, so a bound there proves nothing.
 *
 * Model and schema mirror by path, the same correspondence the closed-vocabulary
 * check uses, which is what keeps one table's `code` from being measured against
 * another table's column.
 */
export function checkColumnLengthParity(base: string): string[] {
  // A field declared by both the create and the update request produces the
  // same sentence twice, and the fix is the one constant both read.
  const issues = new Set<string>();
  const modelsDir = join(base, "models");
  const schemasDir = join(base, "schemas");
  if (!existsSync(modelsDir) || !existsSync(schemasDir)) return [];

  for (const relative of layerFiles(modelsDir)) {
    const schemaPath = join(schemasDir, relative);
    if (!existsSync(schemaPath)) continue;
    const columns = stringColumns(readFileSync(join(modelsDir, relative), "utf-8"));
    if (columns.size === 0) continue;

    const schema = readFileSync(schemaPath, "utf-8");
    const constants = moduleConstants(schema);
    for (const [field, declaration] of requestStringFields(schema)) {
      const column = columns.get(field);
      if (column === undefined) continue;

      const capped = /\bmax_length\s*=\s*(\w+)/.exec(declaration);
      if (capped === null) {
        issues.add(
          `schemas/${relative}: ${field} accepts any length but the column is ` +
            `String(${column}) — an over-long value is refused by the database as a 500, ` +
            "not by the schema as a 422",
        );
        continue;
      }
      const declared = /^\d+$/.test(capped[1]) ? Number(capped[1]) : constants.get(capped[1]);
      if (declared === undefined || declared <= column) continue;
      issues.add(
        `schemas/${relative}: ${field} caps at ${declared} but the column is ` +
          `String(${column}) — the schema admits a value the database then refuses`,
      );
    }
  }
  return [...issues];
}

/** `<column> -> n` for every `mapped_column(String(n))`, module constants resolved. */
function stringColumns(model: string): Map<string, number> {
  const constants = moduleConstants(model);
  const found = new Map<string, number>();
  for (const match of model.matchAll(
    /^\s+(\w+):\s*Mapped\[[^\]]*\]\s*=\s*mapped_column\(([\s\S]{0,220}?)\)\n/gm,
  )) {
    const sized = /String\((\w+)\)/.exec(match[2]);
    if (sized === null) continue;
    const length = /^\d+$/.test(sized[1]) ? Number(sized[1]) : constants.get(sized[1]);
    if (length !== undefined) found.set(match[1], length);
  }
  return found;
}

/** `NAME = 120` module constants, the form `code-layout` requires for a literal. */
function moduleConstants(source: string): Map<string, number> {
  const found = new Map<string, number>();
  for (const match of source.matchAll(/^(\w+) = (\d+)$/gm)) {
    found.set(match[1], Number(match[2]));
  }
  return found;
}

/** Every string field of every request class, with the declaration it carries. */
function requestStringFields(schema: string): Array<[string, string]> {
  const found: Array<[string, string]> = [];
  for (const block of schema.matchAll(
    /class \w+(?:Create|Update)Request\([^)]*\):([\s\S]*?)(?=\nclass |\Z)/g,
  )) {
    let pending = "";
    for (const line of block[1].split("\n")) {
      if (/^\S/.test(line) && line.trim() !== "") break;
      pending = pending === "" ? line : `${pending} ${line.trim()}`;
      if (countParens(pending) > 0) continue;
      const declaration = pending;
      pending = "";
      const field = /^\s{4}(\w+)\s*:\s*([^\n=]+)/.exec(declaration);
      if (field === null || field[1] === "model_config") continue;
      if (!/\bstr\b/.test(field[2])) continue;
      found.push([field[1], declaration]);
    }
  }
  return found;
}

/** Unclosed parentheses in an accumulated declaration. */
function countParens(text: string): number {
  return (text.match(/\(/g) ?? []).length - (text.match(/\)/g) ?? []).length;
}

/** `<column> IN ('A', 'B')` check constraints, as `[column, values]`. */
function closedValueSets(source: string): Array<[string, string[]]> {
  const sets: Array<[string, string[]]> = [];
  for (const match of source.matchAll(/CheckConstraint\s*\(/g)) {
    const argument = parenthesized(source, match[0].length + match.index - 1);
    if (argument === null) continue;
    // The expression may be split across adjacent string literals.
    const expression = [...argument.matchAll(/"([^"]*)"/g)].map((part) => part[1]).join(" ");
    const column = /^\s*(\w+)\s+IN\s*\(/.exec(expression);
    if (column === null) continue;
    sets.push([column[1], [...expression.matchAll(/'([^']+)'/g)].map((value) => value[1])]);
  }
  return sets;
}

/** From an opening `(` to its match. */
function parenthesized(source: string, open: number): string | null {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(open, index + 1);
    }
  }
  return null;
}

/** Every `<column>: <annotation>` declared as a class field in the schema. */
function fieldAnnotations(schema: string, column: string): string[] {
  return [...schema.matchAll(new RegExp(`^\\s+${column}\\s*:\\s*([^\n=]+)`, "gm"))].map(
    (match) => match[1].trim().replace(/,$/, ""),
  );
}

/**
 * The values an annotation admits, or `null` when it admits any string.
 *
 * Resolves the three forms this repository uses: an inline `Literal[...]`, a
 * module-level alias assigned to one (`ResponseFormat = Literal["JSON", "XML"]`),
 * and an alias **imported** from the module that produces the values.
 *
 * The import form is not a loophole, it is the point: a vocabulary is spelled
 * once. `integration_call`'s verbs and outcomes are decided in
 * `engine/integration.py`, where the literals are actually written, so the schema
 * imports them instead of restating them — and a check that only looked in the
 * schema file would have called that correct code a violation and pushed the
 * author into duplicating the set.
 */
function literalValues(schema: string, annotation: string, appBase: string): Set<string> | null {
  // A facets response answers the vocabulary itself - `list[ReportKind]` - and
  // that is the set kept, not a set widened: the element type is what a reader
  // switches on, so the list wrapper is read through.
  const listed = /^list\[([\s\S]+)\]$/.exec(annotation.trim());
  if (listed !== null) return literalValues(schema, listed[1], appBase);
  const bare = annotation.replace(/\|\s*None/, "").trim();
  const inline = /^Literal\[([\s\S]*)\]$/.exec(bare);
  if (inline !== null) return literalMembers(inline[1]);
  if (!/^[A-Z]\w*$/.test(bare)) return null;

  const local = new RegExp(`^${bare}\\s*=\\s*Literal\\[([\\s\\S]*?)\\]`, "m").exec(schema);
  if (local !== null) return literalMembers(local[1]);

  const imported = importedFrom(schema, bare);
  if (imported === null) return null;
  const module = join(appBase, `${imported.module.split(".").join("/")}.py`);
  if (!existsSync(module)) return null;
  const source = readFileSync(module, "utf-8");
  const alias = new RegExp(`^${imported.remoteName}\\s*=\\s*Literal\\[([\\s\\S]*?)\\]`, "m").exec(source);
  return alias === null ? null : literalMembers(alias[1]);
}

/** The quoted members of a `Literal[...]` body. */
function literalMembers(body: string): Set<string> {
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

/**
 * The `app.`-relative module a name is imported from, and the name it had
 * there — `import CallOutcome as OutcomeVocabulary` binds the local name to a
 * remote one, and resolving the local name in the remote module finds nothing.
 * Measured: the rename alone turned a correct schema into a "widens" report.
 */
function importedFrom(schema: string, name: string): { module: string; remoteName: string } | null {
  for (const match of schema.matchAll(/^from\s+app\.([\w.]+)\s+import\s+([^\n(]*)/gm)) {
    for (const item of match[2].split(",")) {
      const bound = /^\s*(\w+)(?:\s+as\s+(\w+))?\s*$/.exec(item);
      if (bound === null) continue;
      if ((bound[2] ?? bound[1]) === name) return { module: match[1], remoteName: bound[1] };
    }
  }
  return null;
}

/**
 * Domains that own more than one model file — a multi-table aggregate, checked
 * by its own file-shape hooks (check-backend-model-files,
 * check-backend-repository-files) and, when one exists, its dedicated
 * configuration hook, never by the generic single-resource CRUD template every
 * other hook in this file assumes.
 *
 * **Structural, not named.** Hardcoding a domain's name to skip it is what
 * broke three times in one session when `integration.py` became five files:
 * `check-backend-transaction`'s own `file !== "integration.py"` filter,
 * `check-backend-tests`'s own `Set(["integration"])`, and this file's earlier
 * `name === "integration"` skip all stopped matching anything the day the
 * split landed, because none of them asked "does this domain own more than one
 * file" — they asked "is this domain literally named integration". A domain
 * discovered this way needs no update when the next aggregate is split; a
 * hardcoded name needs one every time, silently, until someone happens to
 * touch that exact domain again.
 *
 * Measured two ways, because the aggregate has two shapes: several model files
 * (the folder), or one flat file declaring several tables — the shape a domain
 * has before its folder move, and the shape the sandbox baseline keeps.
 */
export function aggregateDomains(): Set<string> {
  const base = join(projectRoot, "backend", "app");
  const serviceDir = join(base, "services");
  if (!existsSync(join(base, "models")) || !existsSync(serviceDir)) return new Set();

  const result = new Set<string>();
  for (const name of listDomains(serviceDir)) {
    if (ownedModelFiles(name).length > 1 || ownedTableCount(name) > 1) result.add(name);
  }
  return result;
}

/**
 * The model files one domain owns, in either shape:
 *
 * - `models/<domain>/*.py` - a folder, required once a domain owns more than
 *   one table (`backend-model-files.md`). The file inside is named after its
 *   table with the domain prefix dropped, so `integration/provider.py` maps
 *   `integration_provider`.
 * - `models/<domain>.py`, or the flat `models/<domain>_*.py` a domain has
 *   while it is being moved into a folder.
 *
 * Returned as paths relative to `models/`, because a caller that only ever saw
 * bare filenames was the reason the folder move went unnoticed: five files
 * moved one directory down, `readdirSync` stopped matching them, and every
 * aggregate check silently reported success on nothing.
 */
export function ownedModelFiles(domain: string): string[] {
  const modelDir = join(projectRoot, "backend", "app", "models");
  if (!existsSync(modelDir)) return [];

  const folder = join(modelDir, domain);
  if (existsSync(folder) && statSync(folder).isDirectory()) {
    return readdirSync(folder)
      .filter((f: string) => f.endsWith(".py") && f !== "__init__.py")
      .map((f: string) => `${domain}/${f}`);
  }

  // layer-flat-ok: the folder shape is handled above; this is the flat fallback,
  // matching `<domain>.py` and `<domain>_*.py` at the layer root by construction.
  return readdirSync(modelDir).filter(
    (f: string) => f === `${domain}.py` || (f.startsWith(`${domain}_`) && f.endsWith(".py")),
  );
}

/**
 * `__tablename__` declarations across the model files one domain owns — the
 * other half of the aggregate measure. A flat `models/<domain>.py` that maps
 * four tables is exactly as much an aggregate as four files in a folder, and
 * the singular one-table templates fit it exactly as badly.
 */
export function ownedTableCount(domain: string): number {
  const modelDir = join(projectRoot, "backend", "app", "models");
  let count = 0;
  for (const file of ownedModelFiles(domain)) {
    const source = readFileSync(join(modelDir, file), "utf-8");
    count += (source.match(/^\s*__tablename__\s*=/gm) ?? []).length;
  }
  return count;
}

/** Domain names, from the layer that decides a domain exists: `services/`. */
export function listDomains(serviceDir: string): string[] {
  if (!existsSync(serviceDir)) return [];
  const names: string[] = [];
  for (const entry of readdirSync(serviceDir, { withFileTypes: true })) {
    if (entry.name === "__init__.py" || entry.name === "__pycache__") continue;
    if (entry.isDirectory()) names.push(entry.name);
    else if (entry.name.endsWith(".py")) names.push(entry.name.replace(".py", ""));
  }
  return names;
}

/** True when `stem` (a filename minus `.py`) belongs to a multi-file domain. */
export function belongsToAggregateDomain(stem: string, aggregates: Set<string>): boolean {
  for (const domain of aggregates) {
    if (stem === domain || stem.startsWith(`${domain}_`)) return true;
  }
  return false;
}


/**
 * One domain's source in a layer, as a single string: the file when the layer
 * holds `<domain>.py`, the concatenation of `<domain>/*.py` when the domain has
 * grown into a folder.
 *
 * Concatenating is what makes the split invisible to a content check. The
 * alternative - picking one file - is how a check starts reading half a
 * contract and passing: `schemas/integration/provider.py` alone has no
 * `IntegrationSecretCreateRequest`, and the domain's schema contract is the
 * whole folder.
 */
export function readLayerSource(layerDir: string, domain: string): string | null {
  const file = join(layerDir, `${domain}.py`);
  if (existsSync(file)) return readFileSync(file, "utf-8");

  const folder = join(layerDir, domain);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) return null;
  return readdirSync(folder)
    .filter((f: string) => f.endsWith(".py") && f !== "__init__.py")
    .sort()
    .map((f: string) => readFileSync(join(folder, f), "utf-8"))
    .join("\n");
}

/**
 * Absolute paths of the files one domain owns in a layer - the folder's
 * contents, or the flat `<domain>.py` / `<domain>_*.py` files.
 */
export function listDomainLayerFiles(layerDir: string, domain: string): string[] {
  if (!existsSync(layerDir)) return [];

  const folder = join(layerDir, domain);
  if (existsSync(folder) && statSync(folder).isDirectory()) {
    return readdirSync(folder)
      .filter((f: string) => f.endsWith(".py") && f !== "__init__.py")
      .sort()
      .map((f: string) => join(folder, f));
  }

  return readdirSync(layerDir)
    .filter((f: string) => f === `${domain}.py` || (f.startsWith(`${domain}_`) && f.endsWith(".py")))
    .sort()
    .map((f: string) => join(layerDir, f));
}

/**
 * A layer must not hold both `<domain>.py` and `<domain>/` for the same domain.
 *
 * Measured: with `models/user.py` and `models/user/extra.py` both present,
 * every check passed. `ownedModelFiles()` answers with the folder and stops
 * looking, so the flat file's table was invisible - the exact shape a
 * half-finished move leaves behind, and the one state where "which files does
 * this domain own" has two answers.
 */
export function checkLayerOwnership(layerDir: string, layerLabel: string): string[] {
  if (!existsSync(layerDir)) return [];
  const issues: string[] = [];
  for (const entry of readdirSync(layerDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "__pycache__") continue;
    if (!existsSync(join(layerDir, `${entry.name}.py`))) continue;
    issues.push(
      `${layerLabel}/: ${entry.name} owns both ${entry.name}.py and ${entry.name}/ - ` +
        "a domain lives in one or the other; finish the move and delete the flat file",
    );
  }
  return issues;
}

export function checkDomainStructure(): string[] {
  const issues: string[] = [];
  const base = join(projectRoot, "backend", "app");
  const modelDir = join(base, "models");
  const schemaDir = join(base, "schemas");
  const repoDir = join(base, "repositories");
  const serviceDir = join(base, "services");
  const routerDir = join(base, "routers");
  const mainPy = join(base, "main.py");
  const envPy = join(projectRoot, "backend", "alembic", "env.py");

  if (!existsSync(modelDir)) {
    issues.push("backend/app/models/ directory not found");
    return issues;
  }

  // No layer may answer "which files does this domain own" two ways at once.
  for (const [dir, label] of [
    [modelDir, "models"],
    [schemaDir, "schemas"],
    [repoDir, "repositories"],
    [serviceDir, "services"],
  ] as const) {
    issues.push(...checkLayerOwnership(dir, label));
  }

  // A domain is a 5-layer stack, and the layer that decides one exists is the
  // service. Discovery used to enumerate **model files**, which made a table
  // and a domain the same thing - so `integration` had to be skipped by name,
  // and the moment one table moved to its own file the checker demanded a
  // router, a schema and a service for `integration_secret`.
  //
  // One table per model file is the table rule (`backend-model-files.md`), and
  // a domain that owns several of them keeps them in `models/<domain>/`. Both
  // shapes are read through `ownedModelFiles()` so this checker, the aggregate
  // predicate, and the file-shape hooks cannot disagree about what a domain
  // owns - they disagreed once already, and the answer was silence.
  const modelFiles: string[] = layerFiles(modelDir);

  // File naming: lower snake case, because a model file is named after its
  // table (minus the domain prefix when it sits in the domain's folder).
  for (const modelFile of modelFiles) {
    const name = modelFile.replace(/^.*\//, "").replace(".py", "");
    if (!/^[a-z][a-z0-9_]*$/.test(name)) {
      issues.push(
        `${modelFile}: model filename must be lower snake case - it is named after ` +
          "the table it maps (backend-model-files.md)",
      );
    }
  }

  const domains: string[] = listDomains(serviceDir);

  const repoFiles: string[] = existsSync(repoDir) ? layerFiles(repoDir) : [];

  for (const name of domains) {
    const cls = pascalCase(name);

    const owned = ownedModelFiles(name);
    if (owned.length === 0) {
      issues.push(
        `${name}: services layer exists but no model file ` +
          `(models/${name}.py, models/${name}/*.py, or models/${name}_*.py)`,
      );
      continue;
    }
    const modelFile = owned.includes(`${name}.py`) ? `${name}.py` : owned.sort()[0];
    // A model file per table (backend-model-files.md), so a domain's repository
    // side is not required to be exactly `repositories/<name>.py` either - only
    // that at least one file exists for it, in the folder when there are
    // several (`backend-repository-files.md`).
    const ownedRepos = repoFiles.filter(
      (file: string) =>
        file === `${name}.py` || file.startsWith(`${name}_`) || file.startsWith(`${name}/`),
    );
    // The singular templates below (model class == domain name, repository's
    // 7-method shape) describe one table's worth of CRUD. A domain that owns
    // several files — several tables, several repositories — is checked by its
    // own file-shape hooks (check-backend-model-files,
    // check-backend-repository-files) and its dedicated configuration hook when
    // one exists; running the singular template against an arbitrarily chosen
    // file here is what let `models/integration_call.py` satisfy `model class
    // "Integration" not found` by prefix coincidence (`IntegrationCall` starts
    // with `Integration`) before this gate existed.
    // The aggregate is measured, never named (see aggregateDomains): several
    // model files, or one flat file declaring several tables. Either shape puts
    // the domain outside the one-table templates below.
    const isAggregate = owned.length > 1 || ownedTableCount(name) > 1;
    const isSingleFileDomain = !isAggregate && owned.length === 1 && owned[0] === `${name}.py`;
    const isSingleRepoDomain = !isAggregate && ownedRepos.length === 1 && ownedRepos[0] === `${name}.py`;

    // Data chain: model → schema → repository → service. Router is OPTIONAL —
    // a domain may be internal-only (batch jobs) or exposed via a custom
    // router (auth). When a router exists, its content is validated below.
    //
    // 완성도 요구는 **의존 방향으로만** 건다(사용자 지적 + 실측). 도메인 발견 자체가
    // services/ 앵커라서 모델만(또는 모델+스키마만) 있는 상태는 도메인으로 잡히지 않는다 — 작업의
    // 첫 걸음에서 마지막 걸음을 요구하지 않는다. 여기 도달한 도메인은 서비스(또는 라우터)가 이미
    // 섰으므로 그 하류가 상류(schema·repository)를 요구한다. 완성 시점의 계약은 그대로다.
    const routerPath = join(routerDir, `${name}.py`);
    const hasRouter = existsSync(routerPath);
    const anchor = hasRouter ? "routers" : "services";
    const schemaSource = readLayerSource(schemaDir, name);
    if (schemaSource === null) {
      issues.push(
        `${name}: ${anchor} layer exists but schema layer is missing ` +
          `(schemas/${name}.py or schemas/${name}/*.py)`,
      );
    }
    if (ownedRepos.length === 0) {
      issues.push(
        `${name}: ${anchor} layer exists but repository layer is missing ` +
          `(repositories/${name}.py, repositories/${name}/*.py, or repositories/${name}_*.py)`,
      );
    }
    if (readLayerSource(serviceDir, name) === null) {
      // premature-ok: services/ 가 이 도메인을 선언했는데 읽을 소스가 없다 — 어느 단계에서든 결함이다.
      issues.push(`${name}: missing service file (services/${name}.py or services/${name}/*.py)`);
    }

    // --- Validate file contents ---

    const modelPath = join(modelDir, modelFile);
    const modelContent = readFileSync(modelPath, "utf-8");

    if (isSingleFileDomain) {
      // Model: should have Base, AuditMixin, UUID id, name/description
      if (!modelContent.includes("AuditMixin")) {
        issues.push(`${name}: model missing AuditMixin`);
      }
      if (!modelContent.includes("class " + cls)) {
        issues.push(`${name}: model class "${cls}" not found`);
      }
      if (!modelContent.includes("Mapped[uuid.UUID]")) {
        issues.push(`${name}: model id must be Mapped[uuid.UUID] (UUID primary key)`);
      }
      if (!modelContent.includes("default=uuid4")) {
        issues.push(`${name}: model id missing default=uuid4`);
      }
      if (!modelContent.includes("mapped_column")) {
        issues.push(`${name}: model missing mapped_column`);
      }
      if (!new RegExp(`__tablename__ = "${name}"`).test(modelContent)) {
        issues.push(`${name}: ${modelFile} must declare __tablename__ "${name}"`);
      }
    }

    // Schema: should have 6 classes, extra="forbid"
    // Naming convention: XBase, XCreateRequest, XCreateInternal, XReadResponse,
    // XUpdateRequest, XUpdateInternal (Request/Response suffixes).
    if (schemaSource !== null) {
      const schemaContent = schemaSource;
      /**
       * The class family, which is the domain's own name **or a leaf's**.
       *
       * A single-file domain has one entity, so the family is `<Domain>*`. A
       * folder domain need not: `food` is two sibling ledgers with no root
       * between them (`FoodBarcode*`, `FoodRawMaterial*`), and demanding
       * `FoodBase` would invent an entity nothing stores. `integration` passes
       * either way — its aggregate root happens to carry the domain's own name
       * while `IntegrationSecret*` and `IntegrationOperation*` are leaves — and
       * that coincidence is what made "one domain, one root" look like a rule.
       *
       * The domain's own name stays in the list for the root that may exist —
       * `integration/provider.py` declares `IntegrationCreateRequest`, not
       * `IntegrationProviderCreateRequest` — so both shapes pass and neither is
       * mandatory.
       */
      /**
       * A `<Family>Base` is the promise of a CRUD family, and the other five
       * are the rest of it.
       *
       * The family's name is the domain's own or a leaf's: `integration/
       * provider.py` declares `Integration*` while `food` — two sibling ledgers
       * with no root between them — declares `FoodBarcode*` and
       * `FoodRawMaterial*` and no `Food*` at all. Nested aggregates carry only
       * what they need (`IntegrationSecretCreateRequest` with no `Base`), and
       * the `Base` is exactly what tells the two apart.
       *
       * Checked per file, because a family is complete or it is not: against the
       * folder's concatenated text a sibling's `FoodBarcodeUpdateInternal`
       * answered for the `raw_material` leaf that had lost its own - measured,
       * on a planted deletion this check reported nothing.
       */
      const suffixes = [
        "CreateRequest",
        "CreateInternal",
        "ReadResponse",
        "UpdateRequest",
        "UpdateInternal",
      ];
      /**
       * A derived table (`Derivation` of a derive job, rule://backend-ledger)
       * is read-only over HTTP - the derive job rewrites it whole every
       * night - so its family is `Base` + `ReadResponse` and nothing else: a
       * Create or Update request there is a promise the next rebuild breaks.
       * A ledger declares no family at all (its schema is `Mutable`, `Base`
       * and `CreateRequest.from_record`, the shape the sync validates with).
       */
      const derivedTables = derivedTablesOf(base, name);
      const ledgerLeaves = ledgerTablesOf(base, name);
      let complete = 0;
      for (const [leaf, source] of schemaLeafSources(schemaDir, name)) {
        if (leaf !== null && ledgerLeaves.includes(leaf)) continue;
        const families = leaf === null ? [cls] : [cls, `${cls}${pascalCase(leaf)}`];
        const where = leaf === null ? `schemas/${name}.py` : `schemas/${name}/${leaf}.py`;
        const wanted = leaf !== null && derivedTables.includes(leaf) ? ["ReadResponse"] : suffixes;
        for (const family of families) {
          if (!new RegExp(`class\\s+${family}Base\\b`).test(source)) continue;
          const missing = wanted.filter(
            (suffix) => !new RegExp(`class\\s+${family}${suffix}\\b`).test(source),
          );
          if (missing.length === 0) complete += 1;
          else {
            issues.push(
              `${name}: ${where} declares ${family}Base but not ` +
                missing.map((suffix) => `${family}${suffix}`).join(", "),
            );
          }
        }
      }
      if (complete === 0) {
        issues.push(
          `${name}: no schema declares a complete class family - one file owes ` +
            `${cls}Base plus ${suffixes.map((suffix) => cls + suffix).join(", ")}, ` +
            "under the domain's name or a leaf's",
        );
      }

      // Every Read response exposes the optimistic-lock revision its caller holds:
      // a client that cannot see `version` cannot know which row it edited, and
      // its next write is either a blind overwrite or a 409 it cannot explain.
      // Stated for every table in backend-table-design.md; enforced only for
      // `integration` until a planted omission on a food ledger stayed green.
      for (const [leaf, source] of schemaLeafSources(schemaDir, name)) {
        for (const declaration of source.matchAll(
          /^class\s+(\w+ReadResponse)\((BaseModel|\w+)\):\n((?:[ \t].*\n|\n)*)/gm,
        )) {
          // A read that extends another read (`FoodItemReportDetailReadResponse(FoodItemReportReadResponse)`)
          // inherits the revision and the identity with the rest of the row.
          if (declaration[2].endsWith("ReadResponse")) continue;
          // A composition of reads - every field another `*ReadResponse` or a list
          // of them (`FoodItemReportStandardsReadResponse { types: list[...] }`) -
          // is not a row and holds no revision; the rows inside carry their own.
          const fields = [...declaration[3].matchAll(/^\s+(\w+):\s*([^=\n]+?)\s*(?:=|$)/gm)]
            .filter((f) => f[1] !== "model_config")
            .map((f) => f[2]);
          if (fields.length > 0 && fields.every((f) => /^(?:list\[)?\w+ReadResponse\]?$/.test(f))) continue;
          const where = leaf === null ? `schemas/${name}.py` : `schemas/${name}/${leaf}.py`;
          if (!/^\s+version:\s*int\b/m.test(declaration[3])) {
            issues.push(
              `${name}: ${where}: ${declaration[1]} does not expose version: int - the ` +
                "optimistic-lock revision is part of every Read response (backend-table-design.md)",
            );
          }
          // A row read carries the row's identity beside its revision: a nested read
          // that dropped `id` left the client keying table rows by their words, and
          // two clauses spelled alike kept a stale row on every page (measured).
          if (!/^\s+id:\s*UUID\b/m.test(declaration[3])) {
            issues.push(
              `${name}: ${where}: ${declaration[1]} does not expose id: UUID - a row read carries ` +
                "its identity, or the client has nothing but the row's words to key it by",
            );
          }
        }
      }

      // Per class, not per file: one new schema class without extra="forbid"
      // silently accepts unknown request fields while its siblings reject them.
      for (const declaration of schemaContent.matchAll(
        /^class\s+(\w+)\((?:BaseModel|\w+)\):\n((?:[ \t].*\n|\n)*)/gm,
      )) {
        const [, className, classBody] = declaration;
        if (!/model_config\s*=\s*ConfigDict\(/.test(classBody)) continue;
        if (!/extra=["']forbid["']/.test(classBody)) {
          issues.push(`${name}: schema class ${className} missing extra="forbid"`);
        }
      }
      if (!schemaContent.includes("from_attributes=True")) {
        issues.push(`${name}: schema Read missing from_attributes=True`);
      }
      if (!schemaContent.includes("def to_read(") || !schemaContent.includes("def to_read_list(")) {
        issues.push(`${name}: schema missing to_read()/to_read_list() helpers`);
      }
      if (!schemaContent.includes("id: UUID")) {
        issues.push(`${name}: schema Read missing id: UUID`);
      }
    }

    // Repository: should have 7 methods, UUID id params — the single-table
    // template. A domain with several repository files is checked structurally
    // by check-backend-repository-files instead (backend-repository-files.md).
    const repoPath = join(repoDir, `${name}.py`);
    if (isSingleRepoDomain && existsSync(repoPath)) {
      const repoContent = readFileSync(repoPath, "utf-8");
      const methods = ["async def get", "async def list", "async def create", "async def update", "async def delete", "def __init__"];
      for (const method of methods) {
        if (!repoContent.includes(method)) {
          issues.push(`${name}: repository missing method "${method.replace("async def ", "").replace("def ", "")}"`);
        }
      }
      if (!repoContent.includes(`${name}_id: UUID`)) {
        issues.push(`${name}: repository id params must be typed UUID (${name}_id: UUID)`);
      }
    }

    // Service: should have session.begin() transaction management and NotFoundError
    const servicePath = join(serviceDir, `${name}.py`);
    if (existsSync(servicePath)) {
      const serviceContent = readFileSync(servicePath, "utf-8");
      if (!serviceContent.includes("session.begin()")) {
        issues.push(`${name}: service missing session.begin() transaction management`);
      }
      if (!serviceContent.includes("NotFoundError")) {
        issues.push(`${name}: service missing NotFoundError`);
      }
      if (!serviceContent.includes(`${name}_id: UUID`)) {
        issues.push(`${name}: service id params must be typed UUID (${name}_id: UUID)`);
      }
      if (!serviceContent.includes("exclude_unset=True")) {
        issues.push(`${name}: service update must use exclude_unset=True`);
      }
      // `updated_at` belongs to the repository, set before its flush. A service
      // assignment lands after the flush and costs a second UPDATE, which bumps
      // the optimistic-lock version twice per request.
      if (/\.updated_at\s*=/.test(serviceContent)) {
        issues.push(
          `${name}: service must not assign updated_at — set it in the repository ` +
            "before flush (a post-flush assignment costs a second UPDATE and version bump)",
        );
      }
    }

    // Router: the CRUD template has 5 endpoints and UUID path params. A
    // **ledger domain** - one whose tables a provider job replaces feed by feed
    // (a `Feed` of `app/batch/sync/sync_<provider>_ledgers.py`) - is read-only instead: a row
    // written by hand is compared against the provider's record on the next
    // pass and overwritten, so a write endpoint there is a lie the sync corrects
    // nightly. The check refuses the write verbs rather than requiring them.
    if (hasRouter) {
      const routerContent = readFileSync(routerPath, "utf-8");
      const ledgerTables = ledgerTablesOf(base, name);
      const ledger = ledgerTables.length > 0;
      if (ledger) {
        // Per table, not per domain: a domain may hold a ledger beside a table
        // people edit. A route is held to the table its first path segment
        // names (`/item-report/` -> `item_report`). A ledger has no route at
        // all - it is the provider's copy, and what the API serves is the
        // derived table rebuilt off it (rule://backend-ledger); a derived
        // table refuses the write verbs, since the derive job rewrites it
        // whole every night.
        const derived = derivedTablesOf(base, name);
        for (const route of routerContent.matchAll(/@router\.(get|post|patch|put|delete)\("([^"]*)"/g)) {
          const leaf = route[2].split("/").filter((p: string) => p !== "" && !p.startsWith("{"))[0];
          const table = leaf === undefined ? name : leaf.replace(/-/g, "_");
          if (ledgerTables.includes(table)) {
            issues.push(
              `${name}: ${route[1].toUpperCase()} ${route[2]} serves the ${table} ledger - a ledger is ` +
                "the provider's copy and has no route; the API reads the derived table rebuilt off it",
            );
            continue;
          }
          if (route[1] !== "get" && derived.includes(table)) {
            issues.push(
              `${name}: ${route[1].toUpperCase()} ${route[2]} writes the derived ${table} table - the ` +
                "derive job rewrites it whole every night and a hand-written row is gone by morning",
            );
          }
        }
      } else {
        if (!routerContent.includes("@router.post")) {
          issues.push(`${name}: router missing POST endpoint`);
        }
        // update 메서드는 스키마 의미가 정한다(PATCH=부분 갱신 / PUT=전체 교체) — 어느 쪽인지의
        // 판정은 check-backend-api-http 의 expectedUpdateMethod 소관이고, 여기서는 존재만 본다.
        if (!routerContent.includes("@router.patch") && !routerContent.includes("@router.put")) {
          issues.push(`${name}: router missing update endpoint (PATCH or PUT — the verb follows the update schema, rule://backend-api-http)`);
        }
        if (!routerContent.includes("@router.delete")) {
          issues.push(`${name}: router missing DELETE endpoint`);
        }
      }
      if (!routerContent.includes("@router.get")) {
        issues.push(`${name}: router missing GET endpoint`);
      }
      // A flat domain's row is `<name>_id`; a folder domain's row belongs to a
      // leaf, and `food_id` would name none of `food`'s four tables. The service
      // already spells it `food_raw_material_id`, so the router matches.
      const idParam = new RegExp(`\\b${name}(?:_[a-z0-9_]+)?_id: UUID`);
      // Only where a path carries an id: a ledger that publishes its page and
      // nothing by id has no parameter to type.
      const hasIdPath = /@router\.\w+\("[^"]*\{/.test(routerContent);
      if (hasIdPath && !idParam.test(routerContent)) {
        issues.push(
          `${name}: router path params must be typed UUID (${name}_id: UUID, or ` +
            `${name}_<leaf>_id: UUID on a folder domain)`,
        );
      }
      if (!routerContent.includes(`prefix="/${name}"`)) {
        issues.push(`${name}: router prefix must be "/${name}" (lowercase domain name)`);
      }
    }

    // Env: every one of the domain's model files must be imported. Per file, not
    // per domain: a table nobody imports is absent from the metadata, so
    // autogenerate writes an empty migration and the table never exists.
    if (existsSync(envPy)) {
      const envContent = readFileSync(envPy, "utf-8");
      for (const file of owned) {
        // `integration/provider.py` is the module `integration.provider`: the
        // folder is a package, so the import path carries a dot, not a slash.
        // `[\w(]` accepts the parenthesized multi-line form a four-table flat
        // module imports with — `import (` is as much a registration as `import X`.
        const module = file.replace(/\.py$/, "").split("/").join(".");
        if (!new RegExp(`from app\\.models\\.${module} import\\s*[\\w(]`).test(envContent)) {
          // premature-ok: autogenerate 는 import 없는 모델을 보지 못한다 — 이 등록은 모델 자체의 속성이다.
          issues.push(`${module}: not imported in alembic/env.py`);
        }
      }
    }

    // Main: 라우터 등록은 **라우터 파일이 생긴 뒤**에만 요구한다.
    // 모델만 만든 상태에서 "router not included" 를 띄우는 것은 첫 걸음에서 마지막 걸음을 요구하는 것이다.
    if (hasRouter && existsSync(mainPy)) {
      const mainContent = readFileSync(mainPy, "utf-8");
      const routerRegistration = new RegExp(`include_router\\(${name}\\.router(?:,|\\))`);
      if (!routerRegistration.test(mainContent)) {
        issues.push(`${name}: router not included in main.py`);
      }
    }

    // Dependencies: service DI must exist (SessionDep -> ServiceDep). A domain
    // whose service layer is a folder has one service per file, so it needs one
    // factory and one Annotated alias per file - not one named after the domain,
    // which no longer exists as a class once the service is split.
    //
    // Required **only where a router exists**, because an `Annotated[X,
    // Depends(...)]` alias has exactly one consumer: an endpoint signature.
    // Demanded of a router-less domain it produced guaranteed dead code -
    // measured: `barcode` and `batch_checkpoint` are reached only by a batch
    // job, which constructs `Service(session)` itself (rule://backend-batch),
    // and their two aliases sat unused while this rule insisted on them.
    const depsServicesPath = join(base, "dependencies", "services.py");
    if (existsSync(depsServicesPath)) {
      const depsContent = readFileSync(depsServicesPath, "utf-8");
      const serviceFiles = listDomainLayerFiles(serviceDir, name);
      const isFolder = serviceFiles.some((file) => file.includes(`${name}/`));
      const parts = isFolder
        ? serviceFiles.map((file) => {
            const leaf = (file.split("/").pop() ?? "").replace(/\.py$/, "");
            const leafCls = pascalCase(leaf);
            return { factory: `get_${name}_${leaf}_service`, cls: `${cls}${leafCls}Service` };
          })
        : [{ factory: `get_${name}_service`, cls: `${cls}Service` }];
      const routerContent = hasRouter ? readFileSync(routerPath, "utf-8") : "";
      for (const part of parts) {
        // Required of the services an endpoint injects, not of every service
        // that exists. An `Annotated[X, Depends(...)]` alias has exactly one
        // consumer — an endpoint signature — so demanding one for a service no
        // router mentions produces guaranteed dead code, and did: `barcode`
        // (no router at all) and `batch_checkpoint` (a leaf of a domain whose
        // router publishes the other three) each carried an alias nothing
        // injected, kept alive by this rule. `check-backend-contract` owns the
        // other direction, so the pair reads: declare exactly the aliases your
        // endpoints use.
        if (!routerContent.includes(part.cls)) continue;
        if (!depsContent.includes(part.factory)) {
          issues.push(`${name}: missing ${part.factory} in dependencies/services.py`);
        }
        if (!new RegExp(`${part.cls}Dep\\s*=\\s*Annotated\\[\\s*${part.cls}`).test(depsContent)) {
          issues.push(`${name}: missing ${part.cls}Dep Annotated DI in dependencies/services.py`);
        }
      }
    } else {
      // premature-ok: 프로젝트 기반 파일의 부재는 작업 순서가 아니라 설정 결함이다 — 어느 단계에서든 참이다.
      issues.push(`${name}: dependencies/services.py not found`);
    }
  }

  return issues;
}

/**
 * A row's identity and revision are its table's, never a literal the code writes.
 *
 * `version` is the optimistic-lock revision `AuditMixin` holds and `id` the key
 * the row was inserted under (the model's `default=uuid4`, or the ledger stage's
 * id minted from the natural key, `LedgerStage._row_id`). A dict that carries
 * `"version": 1` or an `"id"` built by a minting call claims a row that no table
 * holds: measured, a 발령's files were a JSON list on `food_notice` whose items
 * carried `"id": str(attachment_id(owner, position))` (a uuid5) and `"version": 1`,
 * written only so a nested read passed "every row read exposes id and version" -
 * and the screen keyed the rows by their url all the same. The answer is a
 * table (`food_notice_attachment`), whose rows have both for real.
 *
 * Refused anywhere under `app/` but the one module that mints a row's id as it
 * inserts the row: a `"version": <int>` entry, a `version=<int>` keyword, and an
 * `"id":` whose value is a call that mints one (`uuid1/3/4/5(`, `UUID(`, or a
 * `*_id(` function). Comment lines and docstrings are prose and are skipped.
 */
const ROW_ID_OWNER = "engine/ledger.py";

const LITERAL_VERSION = /["']version["']\s*:\s*\d+\b|\bversion\s*=\s*\d+\s*[,)]/;
const MINTED_ID = /["']id["']\s*:\s*(?:str\(\s*)?(?:[\w.]+\.)?(?:uuid[1345]|UUID|\w+_id)\(/;

/** The findings for one module's source, `path` relative to `app/`. */
export function mintedIdentityIssues(path: string, source: string): string[] {
  if (path === ROW_ID_OWNER) return [];
  const issues: string[] = [];
  let inDocstring = false;
  for (const [index, raw] of source.split("\n").entries()) {
    const line = raw.trim();
    const quotes = (line.match(/"""/g) ?? []).length;
    if (inDocstring || line.startsWith('"""')) {
      if (quotes === 1) inDocstring = !inDocstring;
      continue;
    }
    if (line.startsWith("#")) continue;
    const code = raw.replace(/\s#.*$/, "");
    if (LITERAL_VERSION.test(code)) {
      issues.push(
        `app/${path}:${index + 1}: writes a literal version - the revision is the one the row's ` +
          "AuditMixin holds; a constant is a row no table has. Make the data a table's rows " +
          "(backend-domain.md, 'A row's identity is its table's')",
      );
    }
    if (MINTED_ID.test(code)) {
      issues.push(
        `app/${path}:${index + 1}: mints an id into a dict - a row's id is the one its table ` +
          "inserted it under (default=uuid4, or the ledger stage's). Make the data a table's " +
          "rows (backend-domain.md, 'A row's identity is its table's')",
      );
    }
  }
  return issues;
}

const MINTED_IDENTITY_SELF_TEST: ReadonlyArray<{ name: string; path: string; code: string; fires: boolean }> = [
  {
    name: "a constant version in a derived row",
    path: "services/food/notice.py",
    code: '    return [{"name": name, "url": url, "version": 1}]\n',
    fires: true,
  },
  {
    name: "a minted id in a derived row",
    path: "services/food/notice.py",
    code: '        {"id": str(attachment_id(owner, position)), "name": name}\n',
    fires: true,
  },
  { name: "a uuid4 as an id", path: "services/x.py", code: '    row = {"id": uuid.uuid4()}\n', fires: true },
  { name: "a version keyword", path: "schemas/x.py", code: "    X(id=row.id, version=1)\n", fires: true },
  { name: "the stage minting as it inserts", path: "engine/ledger.py", code: '    {"id": self._row_id(row)}\n', fires: false },
  { name: "a row's own id and version", path: "schemas/x.py", code: '    {"id": row.id, "version": row.version}\n', fires: false },
  { name: "a screen element's name", path: "agent/roles/chat.py", code: '    {"id": f"{ref}-said", "type": "Text"}\n', fires: false },
  { name: "a field declaration", path: "engine/query.py", code: '    fields = {"id": (UUID, ...), "version": (int, ...)}\n', fires: false },
  { name: "prose", path: "services/x.py", code: '    """Never write "version": 1 here."""\n    # "id": uuid4()\n', fires: false },
];

/** Every module under `app/`, relative to it. */
function appModules(base: string, dir = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(base, dir), { withFileTypes: true })) {
    if (entry.name === "__pycache__") continue;
    const path = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...appModules(base, path));
    else if (entry.name.endsWith(".py")) found.push(path);
  }
  return found;
}

export function checkNoMintedRowIdentity(base: string): string[] {
  const issues: string[] = [];
  for (const test of MINTED_IDENTITY_SELF_TEST) {
    const found = mintedIdentityIssues(test.path, test.code).length;
    if ((found > 0) !== test.fires) {
      issues.push(`minted identity self-test '${test.name}': expected ${test.fires ? "a finding" : "silence"}, got ${found}`);
    }
  }
  if (!existsSync(base)) return issues;
  for (const path of appModules(base)) {
    issues.push(...mintedIdentityIssues(path, readFileSync(join(base, path), "utf-8")));
  }
  return issues;
}

/**
 * A paged item is a row, or says what it is instead.
 *
 * The row rule above ("every row read exposes id and version") reads classes by
 * their `*ReadResponse` name, so a class that drops the suffix is outside it.
 * Measured: a per-business aggregate answered `Page[FoodRawMaterialSupplier]`,
 * renamed from `...ReadResponse` the moment the rule fired, with an `id` spelled
 * from its words (`domestic:<licence>`). This reads what a route actually pages
 * instead: every `Page[X]` in `routers/` resolves X through its bases, and X is a
 * row when the chain declares `id: UUID` and `version: int` (or is generated off
 * a model by `read_model(`). Anything else must be named in `core/page.py`'s
 * `NOT_ROWS` with what it is - a span log, a composition, a vocabulary option -
 * where a reviewer reads the reason; a stale or row-valued entry fails too.
 */
const PAGED_ITEM = /\bPage\[\s*([A-Z]\w*)\s*\]/g;

type ClassDecl = { bases: string; body: string };

/** Every top-level class under `app/` by name: its base list and its body. */
export function classDeclarations(sources: ReadonlyMap<string, string>): Map<string, ClassDecl> {
  const classes = new Map<string, ClassDecl>();
  for (const source of sources.values()) {
    for (const hit of source.matchAll(/^class (\w+)(?:\[[^\]]*\])?\(([\s\S]*?)\):\n((?:[ \t].*\n|\n)*)/gm)) {
      classes.set(hit[1], { bases: hit[2], body: hit[3] });
    }
  }
  return classes;
}

function isRow(name: string, classes: ReadonlyMap<string, ClassDecl>, seen = new Set<string>()): boolean {
  const facts = { id: false, version: false, generated: false };
  const walk = (current: string): void => {
    if (seen.has(current)) return;
    seen.add(current);
    const decl = classes.get(current);
    if (decl === undefined) return;
    if (/\bread_model\(/.test(decl.bases)) facts.generated = true;
    if (/^\s+id: UUID\b/m.test(decl.body)) facts.id = true;
    if (/^\s+version: int\b/m.test(decl.body)) facts.version = true;
    for (const base of decl.bases.split(",").map((b) => b.trim().replace(/\[.*$/, ""))) {
      if (/^[A-Z]\w*$/.test(base) && base !== "BaseModel") walk(base);
    }
  };
  walk(name);
  return facts.generated || (facts.id && facts.version);
}

/** The `NOT_ROWS` declaration: class name -> reason. */
export function declaredNotRows(pageSource: string): Map<string, string> {
  const declared = new Map<string, string>();
  const block = /^NOT_ROWS: dict\[str, str\] = \{([\s\S]*?)^\}/m.exec(pageSource);
  if (block === null) return declared;
  for (const hit of block[1].matchAll(/"(\w+)":\s*\(?\s*"([^"]*)"/g)) declared.set(hit[1], hit[2]);
  return declared;
}

export function pagedItemIssues(
  routers: ReadonlyMap<string, string>,
  classes: ReadonlyMap<string, ClassDecl>,
  notRows: ReadonlyMap<string, string>,
): string[] {
  const issues: string[] = [];
  const paged = new Map<string, string>();
  for (const [path, source] of routers) {
    for (const hit of source.matchAll(PAGED_ITEM)) if (!paged.has(hit[1])) paged.set(hit[1], path);
  }
  for (const [name, path] of paged) {
    if (name === "Any" || !classes.has(name)) continue;
    const row = isRow(name, classes);
    if (!row && !notRows.has(name)) {
      issues.push(
        `${path}: pages ${name}, which is no row (no id: UUID and version: int through its bases) ` +
          "and is not declared in core/page.py NOT_ROWS - a paged table keys its rows by a row's " +
          "identity; store the data as rows, or declare what the item is with the reason " +
          "(backend-domain.md, 'A paged item is a row')",
      );
    }
    if (row && notRows.has(name)) {
      issues.push(`core/page.py: NOT_ROWS names ${name}, which is a row read - remove the entry`);
    }
  }
  for (const [name, reason] of notRows) {
    if (!paged.has(name)) issues.push(`core/page.py: NOT_ROWS names ${name}, which no route pages - remove the entry`);
    if (reason.trim() === "") issues.push(`core/page.py: NOT_ROWS entry ${name} gives no reason`);
  }
  return issues;
}

const PAGED_ITEM_SELF_TEST: ReadonlyArray<{ name: string; router: string; schema: string; notRows: string[]; fires: boolean }> = [
  {
    name: "a renamed aggregate with a spelled id",
    router: "-> Page[FoodRawMaterialSupplier]:",
    schema: "class FoodRawMaterialSupplier(BaseModel):\n    id: str\n    product_count: int\n",
    notRows: [],
    fires: true,
  },
  {
    name: "a row read through its base",
    router: "-> Page[XReadResponse]:",
    schema: "class XBase(BaseModel):\n    name: str\n\n\nclass XReadResponse(XBase):\n    id: UUID\n    version: int\n",
    notRows: [],
    fires: false,
  },
  {
    name: "a generated read",
    router: "-> Page[YReadResponse]:",
    schema: 'class YReadResponse(\n    read_model(Y, "YRead", ENTITY.hidden)\n):\n    """A row."""\n',
    notRows: [],
    fires: false,
  },
  {
    name: "a declared span log",
    router: "-> Page[ZCallResponse]:",
    schema: "class ZCallResponse(BaseModel):\n    id: str\n",
    notRows: ["ZCallResponse"],
    fires: false,
  },
  {
    name: "a row declared as no row",
    router: "-> Page[XReadResponse]:",
    schema: "class XReadResponse(BaseModel):\n    id: UUID\n    version: int\n",
    notRows: ["XReadResponse"],
    fires: true,
  },
];

export function checkPagedItemsAreRows(base: string): string[] {
  const issues: string[] = [];
  for (const test of PAGED_ITEM_SELF_TEST) {
    const found = pagedItemIssues(
      new Map([["routers/x.py", test.router]]),
      classDeclarations(new Map([["schemas/x.py", test.schema]])),
      new Map(test.notRows.map((name) => [name, "reason"])),
    ).length;
    if ((found > 0) !== test.fires) {
      issues.push(`paged item self-test '${test.name}': expected ${test.fires ? "a finding" : "silence"}, got ${found}`);
    }
  }
  if (!existsSync(base)) return issues;
  const sources = new Map<string, string>();
  for (const path of appModules(base)) sources.set(path, readFileSync(join(base, path), "utf-8"));
  const routers = new Map([...sources].filter(([path]) => path.startsWith("routers/")));
  issues.push(...pagedItemIssues(routers, classDeclarations(sources), declaredNotRows(sources.get("core/page.py") ?? "")));
  return issues;
}
