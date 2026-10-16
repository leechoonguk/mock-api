/**
 * One repository, one table — the same convention `backend-model-files.md`
 * fixed for models, read here for the layer that queries them.
 *
 * The proxy is measured, not guessed: a repository file's own SQL is
 * `select(<Model>)` calls — bare, no dotted column — because a column
 * projection (`select(IntegrationField.id)`) is an existence/count check
 * against a foreign table, not that table's CRUD hosted in the wrong file.
 * `repositories/integration.py` before the split had three distinct bare
 * targets (`Integration`, `IntegrationOperation`, `IntegrationSecret`) and one
 * column-only exemption (`IntegrationField.id`, counting references before a
 * secret delete) — the rule below fires on the first three and is silent on
 * the fourth.
 *
 * Constructing another table's model instance is not flagged either: the
 * provider repository's `create`/`update` build `IntegrationOperation(...)` and
 * `IntegrationField(...)` objects and assign them into a relationship
 * (`operations=[...]`) in one aggregate-root transaction. That is assembly, not
 * a query — SQLAlchemy's cascade performs the inserts, the repository never
 * calls `select` on those tables.
 *
 * Not every table has a repository file. `IntegrationField` has none: every
 * field row is created inside the provider aggregate's `create`/`update`, and
 * a class with no method that anyone calls is dead code the completeness
 * contract already forbids.
 */

// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { layerFiles } from "./backend-layout.ts";

const projectRoot = existsSync(join(process.cwd(), "backend", "app"))
  ? process.cwd()
  : join(process.cwd(), "..");

const MODELS_DIR = join(projectRoot, "backend", "app", "models");
const REPOS_DIR = join(projectRoot, "backend", "app", "repositories");

const TABLENAME = /__tablename__\s*=\s*"([a-z0-9_]+)"/;
// `class Foo(Base, AuditMixin):` for a model, `class Foo:` for a plain
// repository — no base class to declare, so the parenthesised form is
// optional. A regex that required it never matched a repository class at
// all, and "at most one repository class per file" never fired (measured:
// silent on two classes appended to a clean file).
const CLASS_OPEN = /^class (\w+)(?:\([^)]*\))?:/gm;
/**
 * The whole entities one `select(...)` names: every top-level argument that is a
 * bare name - `select(Model)` and `select(Model, Other.column)` alike, never
 * `select(Model.column)`. Measured: the notice repository selected
 * `select(FoodStandard, FoodProductClassification.id)` - the standard table's
 * rows, in the notice file - and the single-argument form this read before let
 * it through, with a `# type: ignore` on the rows it returned.
 */
export function selectedEntities(source: string): string[] {
  const found: string[] = [];
  for (const hit of source.matchAll(/\bselect\(/g)) {
    let depth = 1;
    let end = hit.index + hit[0].length;
    const args: string[] = [];
    let start = end;
    while (end < source.length && depth > 0) {
      const char = source[end];
      if (char === "(" || char === "[" || char === "{") depth += 1;
      else if (char === ")" || char === "]" || char === "}") depth -= 1;
      if ((char === "," && depth === 1) || depth === 0) {
        args.push(source.slice(start, end));
        start = end + 1;
      }
      end += 1;
    }
    for (const arg of args) {
      const name = /^\s*(\w+)\s*$/.exec(arg);
      if (name !== null) found.push(name[1]);
    }
  }
  return found;
}

const SELECT_SELF_TEST: ReadonlyArray<{ name: string; code: string; entities: string[] }> = [
  { name: "a bare entity", code: "select(FoodStandard)", entities: ["FoodStandard"] },
  {
    name: "an entity beside a column",
    code: "select(FoodStandard, FoodProductClassification.id)\n.outerjoin(X)",
    entities: ["FoodStandard"],
  },
  { name: "an entity after a column, across lines", code: "select(\n    A.id,\n    B,\n)", entities: ["B"] },
  { name: "columns only", code: "select(A.id, func.count(B.id), B.name)", entities: [] },
  { name: "a projection of a count", code: "select(func.count()).select_from(A)", entities: [] },
];

function selectSelfTest(): string[] {
  return SELECT_SELF_TEST.filter(
    (test) => selectedEntities(test.code).join(",") !== test.entities.join(","),
  ).map((test) => `select self-test '${test.name}': read ${JSON.stringify(selectedEntities(test.code))}`);
}
/** A class is a repository if it takes a session — the one thing every one does. */
const REPOSITORY_INIT = /def __init__\(self,\s*session:/;

/** Every model class this codebase declares, mapped to the table it owns. */
function tableByModelClass(): Map<string, string> {
  const byClass = new Map<string, string>();
  if (!existsSync(MODELS_DIR)) return byClass;
  for (const file of layerFiles(MODELS_DIR)) {
    const content = readFileSync(join(MODELS_DIR, file), "utf-8");
    const table = TABLENAME.exec(content)?.[1];
    if (table === undefined) continue;
    for (const match of content.matchAll(new RegExp(CLASS_OPEN.source, "gm"))) {
      byClass.set(match[1], table);
    }
  }
  return byClass;
}

export function checkRepositoryFilesSync(): string[] {
  if (!existsSync(REPOS_DIR)) return [];
  const issues: string[] = [...selectSelfTest()];
  const tableOf = tableByModelClass();
  const knownTables = new Set(tableOf.values());

  const flatSiblings = new Map<string, string[]>();

  for (const file of layerFiles(REPOS_DIR).sort()) {
    // `integration/provider.py` queries `integration_provider`, the same
    // folder-is-the-domain naming the model layer uses.
    const [folder, leaf] = file.includes("/")
      ? [file.split("/")[0], file.split("/")[1].replace(/\.py$/, "")]
      : [null, file.replace(/\.py$/, "")];
    const stem = folder === null ? leaf : `${folder}_${leaf}`;
    const content = readFileSync(join(REPOS_DIR, file), "utf-8");

    if (!knownTables.has(stem)) {
      issues.push(
        `repositories/${file}: names table "${stem}", which no model file declares - ` +
          "a repository file is named after the table it queries (minus the folder's " +
          "domain prefix)",
      );
    }

    if (folder === null) {
      const domain = leaf.includes("_") ? leaf.slice(0, leaf.indexOf("_")) : leaf;
      if (!flatSiblings.has(domain)) flatSiblings.set(domain, []);
      flatSiblings.get(domain)!.push(file);
    }

    const foreignTables = new Set<string>();
    for (const entity of selectedEntities(content)) {
      const table = tableOf.get(entity);
      if (table !== undefined && table !== stem) foreignTables.add(table);
    }
    for (const table of [...foreignTables].sort()) {
      issues.push(
        `repositories/${file}: selects the whole ${table} table - that table has its own ` +
          "repository file (or should), and a full-entity select of it here is that table's " +
          "CRUD hosted in the wrong file. A column projection (select(Model.column), an " +
          "existence or count check) is not this rule; an entity beside a column is - " +
          "select(Other, X.col) selects Other's rows too",
      );
    }

    // Each class's own body, not "from here to end of file" - the latter would
    // let a second class's __init__ make the first class look like a repository
    // too, once there is more than one class in the file.
    const classStarts = [...content.matchAll(new RegExp(CLASS_OPEN.source, "gm"))];
    const repositoryClasses = classStarts
      .filter((match, index) => {
        const start = match.index ?? 0;
        const end = classStarts[index + 1]?.index ?? content.length;
        return REPOSITORY_INIT.test(content.slice(start, end));
      })
      .map((match) => match[1]);
    if (repositoryClasses.length > 1) {
      issues.push(
        `repositories/${file}: declares ${repositoryClasses.length} repository classes ` +
          `(${repositoryClasses.join(", ")}) - one repository per file, named after its table`,
      );
    }
  }

  for (const [domain, files] of flatSiblings) {
    if (files.length < 2) continue;
    issues.push(
      `repositories/: ${domain} owns ${files.length} files (${files.join(", ")}) - a domain ` +
        `with more than one repository keeps them in repositories/${domain}/ ` +
        "(backend-repository-files.md)",
    );
  }
  return issues;
}
