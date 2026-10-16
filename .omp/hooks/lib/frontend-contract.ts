/**
 * Backend ↔ frontend contract extraction.
 *
 * The frontend's TypeScript types and endpoint table are a hand-written copy of
 * the backend's Pydantic schemas and routers. A copy drifts silently: a field
 * renamed on the server keeps compiling on the client and arrives `undefined`
 * at runtime. This module reads both sides so `check-frontend-contract` can
 * compare them instead of trusting them.
 *
 * The parsers are deliberately shallow — they read the declaration syntax this
 * repository actually uses (`backend-domain.md` fixes it) and nothing more.
 */

// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync, readdirSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";

export interface TypeShape {
  name: string;
  bases: string[];
  fields: string[];
}

/** A Pydantic field line: `name: type` or `name: type = default`. */
const PY_FIELD = /^ {4}(\w+)\s*:\s*[^=\n]+/;

const PY_CLASS = /^class\s+(\w+)\(([^)]*)\)\s*:/;

/** A TypeScript interface member: `name: type` or `name?: type`. */
const TS_FIELD = /^ {2}(\w+)\??\s*:\s*.+/;

const TS_INTERFACE = /^export interface\s+(\w+)(?:\s+extends\s+([\w,\s]+))?\s*\{/;

const ROUTER_PREFIX = /prefix="([^"]+)"/;

const ROUTE_DECORATOR = /^@router\.(get|post|put|patch|delete)\("([^"]*)"/;

/**
 * Pydantic classes in one module, with their declared fields.
 *
 * `model_config` is configuration, not a field, and the check would otherwise
 * demand a `model_config` property on the TypeScript side.
 */
export function parsePydanticClasses(source: string): Map<string, TypeShape> {
  const shapes = new Map<string, TypeShape>();
  let current: TypeShape | null = null;

  for (const line of source.split("\n")) {
    const classMatch = PY_CLASS.exec(line);
    if (classMatch !== null) {
      current = {
        name: classMatch[1],
        bases: classMatch[2].split(",").map((base: string) => base.trim()).filter(Boolean),
        fields: [],
      };
      shapes.set(current.name, current);
      continue;
    }
    if (current === null) continue;
    if (/^\S/.test(line) && line.trim() !== "") {
      current = null;
      continue;
    }
    const fieldMatch = PY_FIELD.exec(line);
    if (fieldMatch !== null && fieldMatch[1] !== "model_config") {
      current.fields.push(fieldMatch[1]);
    }
  }
  return shapes;
}

export function parseTsInterfaces(source: string): Map<string, TypeShape> {
  const shapes = new Map<string, TypeShape>();
  let current: TypeShape | null = null;

  for (const line of source.split("\n")) {
    const interfaceMatch = TS_INTERFACE.exec(line);
    if (interfaceMatch !== null) {
      current = {
        name: interfaceMatch[1],
        bases: (interfaceMatch[2] ?? "")
          .split(",")
          .map((base: string) => base.trim())
          .filter(Boolean),
        fields: [],
      };
      shapes.set(current.name, current);
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("}")) {
      current = null;
      continue;
    }
    const fieldMatch = TS_FIELD.exec(line);
    if (fieldMatch !== null) current.fields.push(fieldMatch[1]);
  }
  return shapes;
}

/** Fields of a shape plus every field it inherits, following declared bases. */
export function resolveFields(name: string, shapes: Map<string, TypeShape>): Set<string> {
  const fields = new Set<string>();
  const seen = new Set<string>();
  const stack = [name];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const shape = shapes.get(current);
    if (shape === undefined) continue;
    for (const field of shape.fields) fields.add(field);
    for (const base of shape.bases) stack.push(base);
  }
  return fields;
}

/**
 * Declared constraints of one Pydantic field: what the server actually refuses.
 *
 * A form that validates more than this rejects input the API accepts (measured:
 * the integration dialog demanded `^[a-z][a-z0-9_]*$` and could not create the
 * app's own `mfds-food-safety-korea`). A form that validates less lets a value
 * reach the server and come back as a generic 422 toast with no field named.
 */
export interface YupRule {
  max?: number;
  min?: number;
  matches: boolean;
  required: boolean;
  boolean: boolean;
}

export interface FieldConstraints {
  min?: number;
  max?: number;
  pattern: boolean;
  /** No default of any kind: the server refuses the body without this field. */
  required: boolean;
  /** `ge=` / `gt=` / `le=` / `lt=` — what the server refuses for a number. */
  atLeast?: number;
  greaterThan?: number;
  atMost?: number;
  lessThan?: number;
}

/**
 * Constraints per field for every class in one schema module, inheritance
 * resolved: `UserCreateRequest` carries what `UserBase` declares.
 */
export function parsePydanticConstraints(source: string): Map<string, Map<string, FieldConstraints>> {
  // `code-layout.md` puts every literal in a named module constant, so the
  // declaration reads `max_length=USERNAME_MAX_LENGTH`. Reading only digits
  // silently skipped every field in `user.py` (measured: a form minimum of 4
  // against a server minimum of 8 went unreported).
  const constants = new Map<string, number>();
  for (const match of source.matchAll(/^(\w+) = (\d+)$/gm)) {
    constants.set(match[1], Number(match[2]));
  }

  const own = new Map<string, Map<string, FieldConstraints>>();
  const bases = new Map<string, string[]>();
  let current: string | null = null;
  let pending = "";
  for (const line of source.split("\n")) {
    const classMatch = PY_CLASS.exec(line);
    if (classMatch !== null) {
      current = classMatch[1];
      bases.set(current, classMatch[2].split(",").map((b: string) => b.trim()).filter(Boolean));
      own.set(current, new Map());
      pending = "";
      continue;
    }
    if (current === null) continue;
    if (/^\S/.test(line) && line.trim() !== "") {
      current = null;
      continue;
    }
    // A wrapped `Field(...)` spans lines; accumulate until the parens close.
    pending = pending === "" ? line : `${pending} ${line.trim()}`;
    if (countChar(pending, "(") > countChar(pending, ")")) continue;
    const declaration = pending;
    pending = "";

    const fieldMatch = PY_FIELD.exec(declaration);
    if (fieldMatch === null || fieldMatch[1] === "model_config") continue;
    own.get(current)!.set(fieldMatch[1], {
      min: readNumber(declaration, "min_length", constants),
      max: readNumber(declaration, "max_length", constants),
      pattern: /\bpattern\s*=/.test(declaration),
      required: isRequired(declaration),
      atLeast: readNumber(declaration, "ge", constants),
      greaterThan: readNumber(declaration, "gt", constants),
      atMost: readNumber(declaration, "le", constants),
      lessThan: readNumber(declaration, "lt", constants),
    });
  }

  const resolved = new Map<string, Map<string, FieldConstraints>>();
  for (const name of own.keys()) {
    const fields = new Map<string, FieldConstraints>();
    const seen = new Set<string>();
    const stack = [name];
    while (stack.length > 0) {
      const cls = stack.pop()!;
      if (seen.has(cls)) continue;
      seen.add(cls);
      for (const [field, constraints] of own.get(cls) ?? []) {
        if (!fields.has(field)) fields.set(field, constraints);
      }
      for (const base of bases.get(cls) ?? []) stack.push(base);
    }
    resolved.set(name, fields);
  }
  return resolved;
}

/**
 * The yup rules one form dialog declares, per field.
 *
 * Numeric arguments are resolved through the module's own constants, because
 * `code-layout.md` requires the literal to be a named constant at the top of
 * the file — so the rule reads `.max(CODE_MAX_LENGTH)`, never `.max(64)`.
 */
export function parseYupRules(source: string): Map<string, YupRule> {
  const constants = new Map<string, number>();
  // `export const` is the same declaration: a screen that edits in place reads
  // the length from the form that owns it rather than retyping it, and the
  // export keyword was enough to make every rule in the file unreadable.
  for (const match of source.matchAll(/^(?:export )?const (\w+) = (\d+)$/gm)) {
    constants.set(match[1], Number(match[2]));
  }

  // Tolerant of formatting: `yup\n  .object({` is the same program, and an
  // exact-string marker turned the whole parity family off for that dialog —
  // measured, PASS with every comparison gone.
  const schemaStart = source.search(/yup\s*\.\s*object\s*\(\{/);
  const rules = new Map<string, YupRule>();
  if (schemaStart === -1) return rules;
  const schema = source.slice(schemaStart);

  // Field entries start at a fixed indent inside the object literal; the next
  // one is where the previous field's chain ends.
  const entry = /^ {8}(\w+):/gm;
  const starts: { field: string; index: number }[] = [];
  for (const match of schema.matchAll(entry)) {
    starts.push({ field: match[1], index: match.index! });
  }
  starts.forEach(({ field, index }, position: number) => {
    const end = position + 1 < starts.length ? starts[position + 1].index : schema.length;
    const chain = schema.slice(index, end);
    rules.set(field, {
      max: readCall(chain, "max", constants),
      min: readCall(chain, "min", constants),
      // `.email()` and `.url()` are patterns yup ships; only `.matches()` spells
      // one out, and reading just that reported a form rule as missing.
      matches: /\.matches\(|\.email\(|\.url\(/.test(chain),
      required: /\.required\(/.test(chain),
      // A checkbox always submits true or false, so "required" has no meaning
      // for it — yup spells that `.defined()`, and demanding `.required()`
      // here would ask a form to refuse a value the control cannot produce.
      boolean: /yup\s*\.boolean\(/.test(chain),
    });
  });
  return rules;
}

/**
 * Field names whose *shape* a service validates, not just their length.
 *
 * Two idioms this repository uses: a compiled pattern (`CODE_PATTERN.fullmatch(code)`)
 * and a parse (`urlsplit(base_url)` followed by a raise). Both are invisible in
 * the Pydantic schema, which is exactly how a form ended up with no pattern
 * while the API refused `BAD Code` with a 422.
 */
export function parseServiceShapeRules(source: string): Set<string> {
  const fields = new Set<string>();
  for (const match of source.matchAll(/\b[A-Z][A-Z0-9_]*_PATTERN\.fullmatch\(\s*(?:\w+\.)?(\w+)/g)) {
    fields.add(match[1]);
  }
  for (const match of source.matchAll(/\burlsplit\(\s*(?:\w+\.)?(\w+)/g)) {
    fields.add(match[1]);
  }
  return fields;
}

/**
 * Field names whose **shape** the schema parses in Python rather than declaring
 * in a `pattern=`.
 *
 * A `@field_validator` that hands the value to a parser is the schema declaring
 * a shape: `cron` goes through `_validated_cron`, and a malformed expression is a
 * 422 from the model that caps its length. Reading only `pattern=` made that
 * invisible and reported the batch dialog as rejecting input the API accepts —
 * input the API refuses.
 *
 * A validator that checks **membership** is not a shape and is deliberately not
 * read: `code` must name a job in `BATCH_JOBS`, which no regex can mirror and no
 * form should try to. So the body must reach a parser — a `validated_*` call
 * (module-private `_validated_*` too), a
 * `*_PATTERN` match, or a URL split — before the field counts as shaped.
 */
export function parseSchemaValidatorFields(source: string): Set<string> {
  const fields = new Set<string>();
  const decorators = [...source.matchAll(/@field_validator\(\s*["'](\w+)["']/g)];
  decorators.forEach((match: RegExpMatchArray, index: number) => {
    const from = match.index ?? 0;
    const to = decorators[index + 1]?.index ?? source.length;
    const body = source.slice(from, to);
    if (/\b_?validated_\w+\(|[A-Z][A-Z0-9_]*_PATTERN\b|\.fullmatch\(|\burlsplit\(/.test(body)) {
      fields.add(match[1]);
    }
  });
  return fields;
}

/**
 * Whether the server refuses a body that omits this field.
 *
 * Required is the **absence of a default**, which is not the same as the absence
 * of `Field(...)`: `code: str = Field(max_length=64)` declares constraints and
 * no default, so it is required. `= None`, `= Field(default=...)` and a bare
 * literal are the three ways a field stops being.
 */
function isRequired(declaration: string): boolean {
  const assignment = /^\s*\w+\s*:\s*[^=\n]+=\s*(.*)$/.exec(declaration);
  if (assignment === null) return true;
  const value = assignment[1].trim();
  if (value.startsWith("Field(")) return !/\bdefault\s*=/.test(value);
  return false;
}

function readNumber(
  declaration: string,
  key: string,
  constants: Map<string, number>,
): number | undefined {
  const match = new RegExp(`\\b${key}\\s*=\\s*(\\w+)`).exec(declaration);
  if (match === null) return undefined;
  const argument = match[1];
  if (/^\d+$/.test(argument)) return Number(argument);
  return constants.get(argument);
}

function readCall(chain: string, method: string, constants: Map<string, number>): number | undefined {
  const match = new RegExp(`\\.${method}\\(\\s*(\\w+)`).exec(chain);
  if (match === null) return undefined;
  const argument = match[1];
  if (/^\d+$/.test(argument)) return Number(argument);
  return constants.get(argument);
}

function countChar(text: string, char: string): number {
  let count = 0;
  for (const c of text) if (c === char) count += 1;
  return count;
}

/**
 * Route paths a router module declares, normalised so a path parameter's name
 * cannot make two identical routes look different: `/{user_id}` → `/{}`.
 */
export function parseRoutePaths(source: string): Set<string> {
  const prefixMatch = ROUTER_PREFIX.exec(source);
  const prefix = prefixMatch === null ? "" : prefixMatch[1];
  const paths = new Set<string>();
  for (const line of source.split("\n")) {
    const routeMatch = ROUTE_DECORATOR.exec(line);
    if (routeMatch === null) continue;
    paths.add(normalisePath(`${prefix}${routeMatch[2]}`));
  }
  return paths;
}

/**
 * Endpoint paths the frontend table declares. A template literal's `${...}`
 * substitution is the frontend's spelling of a path parameter, so it collapses
 * to the same `{}` the backend side does.
 */
export function parseEndpointPaths(source: string): Set<string> {
  const paths = new Set<string>();
  for (const match of source.matchAll(/[`'"](\/[^`'"]*)[`'"]/g)) {
    paths.add(normalisePath(match[1]));
  }
  return paths;
}

export function normalisePath(path: string): string {
  return path.replace(/\$\{[^}]+\}/g, "{}").replace(/\{[^}]+\}/g, "{}");
}

export function readBackendModule(projectRoot: string, ...segments: string[]): string | null {
  const source = readBackendModuleRaw(projectRoot, ...segments);
  return source === null ? null : expandAnnotatedAliases(projectRoot, source);
}

/**
 * A field typed with an imported `Annotated` alias (`name: MfdsText = None`,
 * `MfdsText = Annotated[str | None, BeforeValidator(...)]` in `schemas/mfds.py`)
 * is, on the wire, its inner type: the validator runs on the way in and the
 * response carries a `str | None`. Substitute the inner type into every
 * annotation so the field parsers read what the client receives. The alias
 * module is found from the import line, never named here; an alias the module
 * does not declare as `Annotated[...]` is left as written and reported by the
 * parser as unread, which is the honest answer.
 */
function expandAnnotatedAliases(projectRoot: string, source: string): string {
  const aliases = new Map<string, string>();
  for (const hit of source.matchAll(/^from app\.((?:\w+\.)*\w+) import (\([^)]*\)|[^\n]+)$/gm)) {
    const modulePath = join(projectRoot, "backend", "app", ...hit[1].split("."));
    if (!existsSync(`${modulePath}.py`)) continue; // existence-ok: a package import, not an alias module
    const module = readFileSync(`${modulePath}.py`, "utf-8");
    for (const name of hit[2].replace(/[()]/g, "").split(",").map((n: string) => n.trim())) {
      if (!/^\w+$/.test(name)) continue;
      const declared = new RegExp(`^${name}\\s*=\\s*Annotated\\[\\s*([^,]+?)\\s*,`, "m").exec(module);
      if (declared !== null) aliases.set(name, declared[1]);
    }
  }
  if (aliases.size === 0) return source;
  return source.replace(/^(\s+\w+\s*:\s*)(\w+)(\s*(?:=|$))/gm, (line: string, head: string, type: string, tail: string) => {
    const inner = aliases.get(type);
    return inner === undefined ? line : `${head}${inner}${tail}`;
  });
}

function readBackendModuleRaw(projectRoot: string, ...segments: string[]): string | null {
  const path = join(projectRoot, "backend", "app", ...segments);
  if (existsSync(path)) return readFileSync(path, "utf-8");

  // A domain that grew into a folder is still one domain: `schemas/batch.py`
  // became `schemas/batch/{schedule,run,step,checkpoint}.py`, and reading only
  // the flat path returned null — so `checkValidationParity` returned early and
  // **two of the three domains were never compared at all**. The check kept
  // passing; it had simply stopped applying, which is this harness's one
  // silent failure mode (`omp-hooks.md` → Measure The Domain, Never Name It).
  const folder = path.replace(/\.py$/, "");
  if (!existsSync(folder)) return null;
  const modules = readdirSync(folder)
    .filter((file: string) => file.endsWith(".py") && file !== "__init__.py")
    .sort();
  if (modules.length === 0) return null;
  return modules.map((file: string) => readFileSync(join(folder, file), "utf-8")).join("\n");
}
