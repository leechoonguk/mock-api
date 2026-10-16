/**
 * One table, one model class, one file.
 *
 * The rule exists because the alternative was measured here: four integration
 * tables shared `models/integration.py`, and everything that reads models by
 * file had to special-case that name. `check-backend-domain` skipped it from the
 * field-pattern rules ("the integration aggregate contains relationships"), the
 * domain checker treated a model file as a domain and so needed an exception list,
 * and the file grew to 261 lines holding five unrelated schemas.
 *
 * Split, each of those workarounds disappeared: the field rule learned
 * `relationship()` instead of skipping a file, and a domain became what it always
 * was — the stack whose service exists, owning the tables named after it.
 *
 * What is checked, per file in `backend/app/models/`:
 *
 * | Rule | Why |
 * |---|---|
 * | one `__tablename__` per file | two tables in one file is what forced every reader to special-case the name |
 * | the file is named after its table | a reader looking for `integration_call` opens `integration_call.py`, and the domain checker can find a table without a registry |
 * | one mapped class per file | a second mapped class is a second table wearing the first one's file |
 *
 * `base.py` declares no table (it holds the declarative base and the mixins), so
 * it is exempt by measurement rather than by name: files with no `__tablename__`
 * are not table files.
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

/** `class X(Base, AuditMixin):` — a mapped class declares a table. */
const MAPPED_CLASS = /^class (\w+)\(([^)]*)\)/gm;

const TABLENAME = /__tablename__\s*=\s*"([a-z0-9_]+)"/g;

export function checkModelFilesSync(): string[] {
  if (!existsSync(MODELS_DIR)) return [];
  const issues: string[] = [];
  const flatSiblings = new Map<string, string[]>();

  for (const file of layerFiles(MODELS_DIR).sort()) {
    const content = readFileSync(join(MODELS_DIR, file), "utf-8");
    const tables = [...content.matchAll(new RegExp(TABLENAME.source, "g"))].map((m) => m[1]);
    if (tables.length === 0) continue;

    // `integration/provider.py` maps `integration_provider`: the folder is the
    // domain, the file is the rest of the table name. Repeating the prefix
    // inside the folder (`integration/integration_provider.py`) is a stutter
    // that says nothing the path did not already say.
    const [folder, stem] = file.includes("/")
      ? [file.split("/")[0], file.split("/")[1].replace(/\.py$/, "")]
      : [null, file.replace(/\.py$/, "")];
    const expected = folder === null ? stem : `${folder}_${stem}`;

    if (tables.length > 1) {
      issues.push(
        `models/${file}: declares ${tables.length} tables (${tables.join(", ")}) - one table ` +
          "per file, named after the table, or every reader of models has to special-case " +
          "this filename (backend-model-files.md)",
      );
      continue;
    }
    if (tables[0] !== expected) {
      const suggestion =
        folder === null
          ? `models/${tables[0]}.py`
          : `models/${folder}/${tables[0].replace(new RegExp(`^${folder}_`), "")}.py`;
      issues.push(
        `models/${file}: maps table "${tables[0]}" - the file is named after its table ` +
          `(minus the folder's domain prefix), so this is ${suggestion}`,
      );
    }

    if (folder === null) {
      const domain = stem.includes("_") ? stem.slice(0, stem.indexOf("_")) : stem;
      if (!flatSiblings.has(domain)) flatSiblings.set(domain, []);
      flatSiblings.get(domain)!.push(file);
    }

    const classes = [...content.matchAll(new RegExp(MAPPED_CLASS.source, "gm"))]
      .filter((match) => /\bBase\b/.test(match[2]))
      .map((match) => match[1]);
    if (classes.length > 1) {
      issues.push(
        `models/${file}: declares ${classes.length} mapped classes (${classes.join(", ")}) - ` +
          "a second mapped class is a second table wearing this one's file",
      );
    }
  }

  // A domain with several tables keeps them in its own folder. Flat siblings
  // (`integration_provider.py`, `integration_secret.py`, ...) put five files of
  // one domain in a directory every other domain has one file in, and every
  // reader then has to reconstruct the grouping from the prefix.
  for (const [domain, files] of flatSiblings) {
    if (files.length < 2) continue;
    issues.push(
      `models/: ${domain} owns ${files.length} files (${files.join(", ")}) - a domain with ` +
        `more than one table keeps them in models/${domain}/, named after the table minus ` +
        "the domain prefix (backend-model-files.md)",
    );
  }
  return issues;
}
