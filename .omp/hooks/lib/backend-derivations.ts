// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { layerFiles } from "./backend-layout.ts";

/**
 * The derivations of the derive jobs, read off `DERIVATIONS` the way
 * `backend-ledger-feeds.ts` reads `FEEDS`: one reader, so no check derives a
 * table from a file name, and a `Derivation(...)` the reader cannot place is
 * reported rather than dropped.
 *
 * `Derivation(<Svc>, <Svc>.rebuild_<table>)` with `<Svc>` imported from
 * `app.services.<domain>.<table>`; `domain` and `table` are `""` when the
 * service is not imported from a domain, and `rebuild` is whatever the tuple
 * names.
 *
 * `tables` is what the derivation actually writes. It is one table for a
 * `rebuild_<table>`, and for a `rebuild_<name>_family` it is every derived
 * model the service imports: a family of tables read out of one paragraph under
 * one key is written by one derivation, because four derivations reading the
 * same ledger meant four scans of it and four parses of every label (measured
 * on the import label family: six scans of a million-row ledger
 * per derive run, against two after).
 */
export interface Derivation {
  job: string;
  service: string;
  owner: string;
  rebuild: string;
  domain: string;
  table: string;
  tables: string[];
}

/** The derived model modules a family service writes, read off its own imports. */
function familyTables(backendApp: string, domain: string, module: string): string[] {
  const path = join(backendApp, "services", domain, `${module}.py`);
  if (!existsSync(path)) return []; // existence-ok: check-backend-domain reports the missing service
  const content = readFileSync(path, "utf-8");
  const tables = new Set<string>();
  const imports = new RegExp(`^from app\\.models\\.${domain}(?:\\.([a-z0-9_]+))? import ([^\\n]+)`, "gm");
  for (const hit of content.matchAll(imports)) {
    const modules = hit[1] !== undefined ? [hit[1]] : hit[2].split(",").map((m: string) => m.trim().split(/\s+as\s+/)[0]);
    for (const name of modules) {
      if (name.startsWith("ledger_") || !/^[a-z0-9_]+$/.test(name)) continue;
      tables.add(name);
    }
  }
  return [...tables];
}

/** Every derivation of one derive job module. */
export function derivationsOf(content: string, job: string, backendApp?: string): Derivation[] {
  const services = new Map<string, [string, string]>();
  for (const hit of content.matchAll(/from app\.services\.([a-z0-9_]+)\.([a-z0-9_]+) import (\w+)/g)) {
    services.set(hit[3], [hit[1], hit[2]]);
  }
  const derivations: Derivation[] = [];
  for (const hit of content.matchAll(/Derivation\(\s*(\w+),\s*(\w+)\.(rebuild_[a-z0-9_]+)\s*,?\s*\)/g)) {
    const [, service, owner, rebuild] = hit;
    const [domain, table] = services.get(service) ?? ["", ""];
    const family = rebuild.endsWith("_family") && backendApp !== undefined && domain !== "";
    const tables = family ? familyTables(backendApp, domain, table) : table === "" ? [] : [table];
    derivations.push({ job, service, owner, rebuild, domain, table, tables });
  }
  return derivations;
}

/** Every derivation of every `app/batch/derive/derive_*.py`. */
export function listDerivations(backendApp: string): Derivation[] {
  const batchDir = join(backendApp, "batch");
  if (!existsSync(batchDir)) return []; // existence-ok: check-backend-batch reports a missing batch layer
  const derivations: Derivation[] = [];
  for (const file of layerFiles(batchDir)) {
    if (!/^derive\/derive_[a-z0-9_]+\.py$/.test(file)) continue;
    const content = readFileSync(join(batchDir, file), "utf-8");
    derivations.push(...derivationsOf(content, file.split("/").pop()!.replace(/\.py$/, ""), backendApp));
  }
  return derivations;
}

/** The derived tables of one domain: what the derive jobs rebuild there, read off the tuples. */
export function derivedTablesOf(backendApp: string, domain: string): string[] {
  return listDerivations(backendApp)
    .filter((d) => d.domain === domain)
    .flatMap((d) => d.tables);
}
