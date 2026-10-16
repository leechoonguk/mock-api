import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import {
  SRC_DIRECTORIES,
  discoverDomains,
  frontendSrc,
  label,
  pascalCase,
  readIfPresent,
} from "../lib/frontend-source.ts";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

/**
 * Check-Frontend-Domain Post Hook
 *
 * Validates the frontend 6-layer domain pattern from
 * .omp/rules/frontend-domain.md. A domain is a `<name>.service.ts`, and every
 * domain must carry the whole set:
 *
 *   types/<domain>.ts        the wire types
 *   lib/api/endpoints.ts     <DOMAIN>_ENDPOINTS
 *   lib/api/queryKeys.ts     <domain>Keys
 *   services/<domain>.service.ts   list/detail/create/update/remove
 *   hooks/use<Domain>.ts     list/detail/create/update/delete hooks
 *   sections/<domain>/       <Domain>List.tsx + <Domain>FormDialog.tsx
 *                            (no dialog when the list creates rows in the grid)
 *   pages/<Domain>Page.tsx   the route component
 *
 * A child domain (`CHILD_DOMAINS`) is reached only inside its parent's detail
 * dialog, so its screen is the tab `sections/<parent>/detail/<Parent><Domain>sTab.tsx`
 * instead of a list, a form dialog and a page. A domain in `DOMAIN_METHODS`
 * exposes only the verbs listed there, and only their hooks are owed.
 *
 * A half-built domain is the failure this prevents: a service with no hook is
 * called from a screen directly, and a screen with no page is unreachable.
 *
 * This is a read-only check — it does NOT block tool calls.
 */

/** Every CRUD verb a resource service must expose, in the order it is read. */
const SERVICE_METHODS = ["list", "detail", "create", "update", "remove"];

/** The query hook each service verb owes, given the domain's PascalCase name. */
const HOOK_FOR_METHOD: Readonly<Record<string, (name: string) => string>> = {
  list: (name) => `use${name}List`,
  detail: (name) => `use${name}`,
  create: (name) => `useCreate${name}`,
  update: (name) => `useUpdate${name}`,
  remove: (name) => `useDelete${name}`,
};

/**
 * Domains that exist only under a parent record: a project's endpoints and its
 * request logs have no screen of their own — the project detail dialog shows
 * them as tabs. Child → parent.
 */
// domain-literal: the project's two child resources; a stale entry fails here as a missing tab
const CHILD_DOMAINS: Readonly<Record<string, string>> = { endpoint: "project", log: "project" };

/**
 * Domains whose service exposes fewer verbs than CRUD. Request logs are written
 * by the mock server, never by the client: the screen lists, opens and clears
 * them, so a create or update would be a call to an endpoint that does not exist.
 */
// domain-literal: the request log is append-only from the server side
const DOMAIN_METHODS: Readonly<Record<string, readonly string[]>> = { log: ["list", "detail", "remove"] };

export default function checkFrontendDomain(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-frontend-domain", event, () => {
    if (!touchesPath(event, ["frontend/"])) return;
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;

    const issues = checkFrontendDomainSync();
    if (issues.length === 0) {
      resetSuppression("check-frontend-domain");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-frontend-domain",
      issues,
      "run make check-frontend-domain for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-frontend-domain") };
  }));
}

export function checkFrontendDomainSync(): string[] {
  const issues: string[] = [];
  if (!existsSync(frontendSrc)) return ["frontend/src/: directory not found"];

  const domains = discoverDomains();
  if (domains.length === 0) {
    return [`${label(SRC_DIRECTORIES.services)}: no <domain>.service.ts — the app has no domain`];
  }

  const endpoints = readIfPresent(join(SRC_DIRECTORIES.lib, "endpoints.ts")) ?? "";
  const queryKeys = readIfPresent(join(SRC_DIRECTORIES.lib, "queryKeys.ts")) ?? "";

  for (const domain of domains) {
    const name = pascalCase(domain);
    issues.push(...checkLayerFiles(domain, name));
    issues.push(...checkServiceMethods(domain));
    issues.push(...checkQueryHooks(domain, name));

    if (!new RegExp(`${domain.toUpperCase()}_ENDPOINTS\\s*=`).test(endpoints)) {
      issues.push(
        `frontend/src/lib/api/endpoints.ts: no ${domain.toUpperCase()}_ENDPOINTS — ` +
          `the ${domain} service would carry its URLs inline`,
      );
    }
    if (!new RegExp(`${domain}Keys\\s*=\\s*createQueryKeys`).test(queryKeys)) {
      issues.push(
        `frontend/src/lib/api/queryKeys.ts: no ${domain}Keys — ` +
          `the ${domain} hooks cannot share an invalidation key`,
      );
    }
  }

  issues.push(...checkOrphanSections(domains));
  return issues;
}

/**
 * Every layer that is one file per domain; a child domain owes its parent's tab
 * instead of a list, a form dialog and a page.
 *
 * The form dialog is required *unless* the list creates its rows in the grid. A
 * screen whose whole record is a row — a few scalars, all editable — makes the row
 * the form: `+` opens a draft row, saving it is the create, and a dialog beside
 * that would be a second surface asking for the same fields, drifting in order
 * and in lengths the moment either side changed. The exemption is read from the
 * list itself (a draft row that saves through `processRowUpdate`), so deleting
 * the dialog without moving creation into the grid still fails here.
 */
function checkLayerFiles(domain: string, name: string): string[] {
  const issues: string[] = [];
  const parent = CHILD_DOMAINS[domain];
  const required = [join(SRC_DIRECTORIES.types, `${domain}.ts`), join(SRC_DIRECTORIES.queryHooks, `use${name}.ts`)];
  if (parent !== undefined) {
    const parentName = pascalCase(parent);
    required.push(join(SRC_DIRECTORIES.sections, parent, "detail", `${parentName}${name}sTab.tsx`));
  } else {
    const listPath = join(SRC_DIRECTORIES.sections, domain, `${name}List.tsx`);
    const list = readIfPresent(listPath) ?? "";
    const createsInGrid = /\bisNew\b/.test(list) && /processRowUpdate/.test(list);
    issues.push(...checkCreateSurface(domain, name, list, createsInGrid));
    required.push(
      listPath,
      ...(createsInGrid ? [] : [join(SRC_DIRECTORIES.sections, domain, `${name}FormDialog.tsx`)]),
      join(SRC_DIRECTORIES.pages, `${name}Page.tsx`),
    );
  }
  for (const path of required) {
    if (!existsSync(path)) {
      issues.push(`${label(path)}: missing — the ${domain} domain is incomplete`);
    }
  }
  return issues;
}

/**
 * Where a record is created is decided by the record, not by taste.
 *
 * **Is every field of the create an editable column?** Then the row *is* the
 * form and the dialog is a second surface asking for the same fields: a record
 * of three scalars that are all editable columns opens a draft row on `+`. When
 * one field cannot be a cell the dialog stays — a project's multiline
 * `description`, an endpoint's header map.
 *
 * Documented, the criterion was still a matter of opinion: a domain of three
 * scalars could keep a dialog and nothing would say so. It is read from the two
 * files that already state it — the create request type and the list's editable
 * columns — so the answer moves the moment either does.
 */
function checkCreateSurface(
  domain: string,
  name: string,
  list: string,
  createsInGrid: boolean,
): string[] {
  const types = readIfPresent(join(SRC_DIRECTORIES.types, `${domain}.ts`));
  if (types === null || list === "") return [];

  const created = requestFields(types, `${name}CreateRequest`);
  if (created.length === 0) return [];

  const editable = editableColumns(list);
  const rowHoldsTheRecord = created.every((field) => editable.has(field));
  if (rowHoldsTheRecord && !createsInGrid) {
    return [
      `frontend/src/sections/${domain}/${name}List.tsx: every field of ${name}CreateRequest ` +
        `(${created.join(", ")}) is an editable column, so the row is the form — create the ` +
        "row in the grid instead of in a dialog that asks for what the row already shows",
    ];
  }
  if (!rowHoldsTheRecord && createsInGrid) {
    const missing = created.filter((field) => !editable.has(field));
    return [
      `frontend/src/sections/${domain}/${name}List.tsx: creates rows in the grid, but ` +
        `${missing.join(", ")} of ${name}CreateRequest is no editable column — a draft row ` +
        "cannot carry it, so the create belongs in the dialog",
    ];
  }
  return [];
}

/** The field names of one request interface, as `types/<domain>.ts` declares them. */
function requestFields(types: string, interfaceName: string): string[] {
  const start = types.indexOf(`export interface ${interfaceName} {`);
  if (start === -1) return [];
  const end = types.indexOf("\n}", start);
  const body = types.slice(start, end === -1 ? types.length : end);
  return [...body.matchAll(/^ {2}(\w+)\??:/gm)].map((match: RegExpMatchArray) => match[1]);
}

/**
 * The columns a row can be typed into.
 *
 * A column the grid renders but never edits does not hold a field: a project's
 * `slug` is on the list and is read-only there, because it is the mocked URL.
 */
function editableColumns(list: string): Set<string> {
  const fields = new Set<string>();
  // A column names its field either way: spread from the COLUMN table
  // (`...sized('email')`, the list standard) or spelled (`field: 'email'`).
  const columns = [...list.matchAll(/(?:\.\.\.sized\('|field: ')(\w+)'/g)];
  for (const [index, match] of columns.entries()) {
    const from = match.index ?? 0;
    const to = columns[index + 1]?.index ?? list.length;
    if (/editable: true/.test(list.slice(from, to))) fields.add(match[1]);
  }
  return fields;
}

function checkServiceMethods(domain: string): string[] {
  const issues: string[] = [];
  const path = join(SRC_DIRECTORIES.services, `${domain}.service.ts`);
  // existence-ok: domains are discovered from this very file, so it exists by construction.
  const content = readIfPresent(path);
  if (content === null) return issues;

  const methods = DOMAIN_METHODS[domain] ?? SERVICE_METHODS;
  for (const method of methods) {
    if (!new RegExp(`\\b${method}\\s*:`).test(content)) {
      issues.push(
        `${label(path)}: no ${method}() — this service covers ` +
          `${methods.join("/")}, so a screen never builds a URL itself`,
      );
    }
  }
  return issues;
}

function checkQueryHooks(domain: string, name: string): string[] {
  const issues: string[] = [];
  const path = join(SRC_DIRECTORIES.queryHooks, `use${name}.ts`);
  // existence-ok: the presence loop above reports every missing per-domain file.
  const content = readIfPresent(path);
  if (content === null) return issues;

  const required = (DOMAIN_METHODS[domain] ?? SERVICE_METHODS).map((method) => HOOK_FOR_METHOD[method](name));
  for (const hook of required) {
    if (!new RegExp(`export function ${hook}\\b`).test(content)) {
      issues.push(`${label(path)}: no exported ${hook} — the ${domain} domain is incomplete`);
    }
  }
  return issues;
}

/** A section directory with no service is a screen wired to nothing. */
function checkOrphanSections(domains: string[]): string[] {
  const issues: string[] = [];
  if (!existsSync(SRC_DIRECTORIES.sections)) return issues;

  // domain-literal: the one screen that reaches no API of its own - a cross-domain overview; a wrong entry fails loudly here, it never passes silently
  const known = new Set([...domains, "dashboard"]);
  for (const entry of readdirSync(SRC_DIRECTORIES.sections, { withFileTypes: true })) {
    if (!entry.isDirectory() || known.has(entry.name)) continue;
    issues.push(
      `frontend/src/sections/${entry.name}/: no ${entry.name}.service.ts — ` +
        "a section with no service reaches the API some other way",
    );
  }
  return issues;
}

// Direct execution (make check-frontend-domain): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-frontend-domain.ts")) {
  const issues = checkFrontendDomainSync();
  console.log("==> check-frontend-domain");
  if (issues.length === 0) {
    console.log("    PASS: every frontend domain carries all 6 layers");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-frontend-domain");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
