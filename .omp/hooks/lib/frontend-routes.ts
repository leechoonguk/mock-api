/**
 * Route coverage — which endpoints exist on each side, and which are orphans.
 *
 * The two halves of this app are written by hand against each other, so an
 * endpoint can exist on exactly one side and nothing notices:
 *
 * - **Backend-only**: a route nobody calls. Measured here — the API can create
 *   and delete integration secrets, and no screen does. That is either a feature
 *   half-built or an endpoint that should not be published; both are decisions,
 *   and neither should be discovered by reading the router months later.
 * - **Frontend-only**: a call the server does not route. It answers 404 or 405
 *   at runtime, in the browser, for the user.
 * - **Dead constant**: an entry in `<X>_ENDPOINTS` no service function uses.
 *   Measured here — `INTEGRATION_ENDPOINTS.DELETE_SECRET` was declared and never
 *   called, which is what a half-built feature leaves behind.
 *
 * Every path is normalised (`/user/{user_id}` and `` `/user/${id}` `` both become
 * `/user/{}`) because the two sides name a parameter differently on purpose.
 */

// @ts-expect-error — Node builtin, not project-compiled
import { readFileSync, readdirSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { normalisePath } from "./frontend-contract.ts";
export interface RouteEntry {
  /** `GET /user/{}` — verb and normalised path, the pair a request must match. */
  signature: string;
  /** The file that declares it, for a warning that names one place to look. */
  source: string;
  /** The handler's return annotation: what the client will actually receive. */
  returns: string;
  /** Path parameters the route declares, so a client cannot build a short URL. */
  parameters: number;
  /** The handler reads a form body (`OAuth2PasswordRequestForm`, `Form(...)`). */
  form: boolean;
}

const ROUTE_DECORATOR = /^@router\.(get|post|put|patch|delete)\("([^"]*)"/gm;

const ROUTER_PREFIX = /prefix="([^"]+)"/;

const ENDPOINT_BLOCK = /export const (\w+_ENDPOINTS) = \{([\s\S]*?)\n\} as const/g;

const ENDPOINT_ENTRY = /^ {2}(\w+):\s*(?:\([^)]*\)\s*=>\s*)?[`'"]([^`'"]+)[`'"]/gm;

/**
 * A transport call and the endpoint constant it addresses.
 *
 * The type argument allows one level of nesting: list calls read `Page<Batch>`,
 * and `<[^>]*>` stops at the inner `>` — measured, it matched nothing after the
 * envelope landed and every list route was reported as having no caller while
 * the callers sat in the file being read.
 */
const SERVICE_CALL =
  /api\.(get|post|put|patch|delete)<[^<>]*(?:<[^<>]*>)?[^<>]*>\(\s*(\w+_ENDPOINTS\.\w+)/g;

/**
 * `api.stream(FOOD_ENDPOINTS.CHAT, …)` - the one verb with no response
 * generic, because a server-sent stream's events are not one model: the
 * endpoint answers many `patch` frames and one `end`. It is a POST (the
 * question is a body, and the browser's own `EventSource` cannot carry a
 * bearer token) unless the call's fourth argument names the verb:
 * `api.stream(…, 'GET')` takes a running turn up again by its id.
 * `api.download(FOOD_ENDPOINTS.CHAT_EXPORTS, …)` is the same shape - a file
 * and its name, no model - and always a POST.
 */
const STREAM_CALL =
  /api\.(?:stream|download)\(\s*(\w+_ENDPOINTS\.\w+)(?:\([^)]*\))?[^)]*?(?:,\s*'(GET|POST)')?\s*\)/g;

/** `-> IntegrationReadResponse:` at the end of a handler signature. */
const RETURN_ANNOTATION = /->\s*([^:]+):\s*$/m;

/** Every route the backend serves, across every router module. */
export function collectRoutes(projectRoot: string): RouteEntry[] {
  const directory = join(projectRoot, "backend", "app", "routers");
  const routes: RouteEntry[] = [];
  for (const file of listPython(directory)) {
    const source = readFileSync(join(directory, file), "utf-8");
    const prefix = ROUTER_PREFIX.exec(source)?.[1] ?? "";
    ROUTE_DECORATOR.lastIndex = 0;
    for (const match of source.matchAll(ROUTE_DECORATOR)) {
      const path = `${prefix}${match[2]}`;
      const handler = handlerAfter(source, match.index ?? 0);
      routes.push({
        signature: `${match[1].toUpperCase()} ${normalisePath(path)}`,
        source: `backend/app/routers/${file}`,
        returns: RETURN_ANNOTATION.exec(handler)?.[1].trim() ?? "",
        parameters: (path.match(/\{[^}]+\}/g) ?? []).length,
        form: /OAuth2\w*FormDep|OAuth2PasswordRequestForm|Form\(/.test(handler),
      });
    }
  }
  return routes;
}

/**
 * The first path segment of every router prefix the backend serves
 * (`/user/{user_id}` → `user`), which is exactly the set of segments a screen
 * or service must never write as a literal.
 *
 * Measured from `backend/app/routers/*.py`, never enumerated. A regex naming
 * the four routers that happened to exist
 * (`/(?:auth|user|batch|integration)/`) stops detecting the fifth the day it
 * is added — silently, because the check still passes on every file.
 */
export function routerPathSegments(projectRoot: string): Set<string> {
  const directory = join(projectRoot, "backend", "app", "routers");
  const segments = new Set<string>();
  for (const file of listPython(directory)) {
    const source = readFileSync(join(directory, file), "utf-8");
    const prefix = ROUTER_PREFIX.exec(source)?.[1];
    const segment = (prefix ?? `/${file.replace(/\.py$/, "")}`).split("/").filter(Boolean)[0];
    if (segment !== undefined) segments.add(segment);
  }
  return segments;
}

/** The `async def …(…) -> T:` block that follows one decorator. */
function handlerAfter(source: string, offset: number): string {
  const start = source.indexOf("async def", offset);
  if (start === -1) return "";
  const end = source.indexOf('"""', start);
  return source.slice(start, end === -1 ? Math.min(source.length, start + 600) : end);
}

/** `USER_ENDPOINTS.LIST` → `/user/`, for every declared endpoint constant. */
export function collectEndpointConstants(endpointsSource: string): Map<string, string> {
  const constants = new Map<string, string>();
  ENDPOINT_BLOCK.lastIndex = 0;
  for (const block of endpointsSource.matchAll(ENDPOINT_BLOCK)) {
    ENDPOINT_ENTRY.lastIndex = 0;
    for (const entry of block[2].matchAll(ENDPOINT_ENTRY)) {
      constants.set(`${block[1]}.${entry[1]}`, normalisePath(entry[2]));
    }
  }
  return constants;
}

/**
 * Every request the frontend actually issues, keyed by signature.
 *
 * Read from the service layer only: `frontend-api-layer.md` confines transport
 * to `lib/api/services/`, so a call anywhere else is that rule's violation, not
 * a coverage question.
 */
export function collectServiceCalls(
  servicesDirectory: string,
  constants: Map<string, string>,
  reachable?: Set<string>,
): { calls: Map<string, string>; usedKeys: Set<string> } {
  const calls = new Map<string, string>();
  const usedKeys = new Set<string>();
  for (const file of listTypeScript(servicesDirectory)) {
    const source = readFileSync(join(servicesDirectory, file), "utf-8");
    const service = `${file.replace(".service.ts", "")}Service`;
    STREAM_CALL.lastIndex = 0;
    for (const match of source.matchAll(STREAM_CALL)) {
      usedKeys.add(match[1]);
      const path = constants.get(match[1]);
      if (path === undefined) continue;
      const symbol = `${service}.${functionAt(source, match.index ?? 0)}`;
      if (reachable !== undefined && !reachable.has(symbol)) continue;
      calls.set(`${(match[2] ?? "POST").toUpperCase()} ${path}`, `frontend/src/lib/api/services/${file}`);
    }
    SERVICE_CALL.lastIndex = 0;
    for (const match of source.matchAll(SERVICE_CALL)) {
      usedKeys.add(match[2]);
      const path = constants.get(match[2]);
      if (path === undefined) continue;
      // A call inside a function nothing above it uses does not reach the route.
      // Measured: the frontend has no operation feature, yet the execute route
      // looked covered because a service function and a hook existed for it.
      const symbol = `${service}.${functionAt(source, match.index ?? 0)}`;
      if (reachable !== undefined && !reachable.has(symbol)) continue;
      calls.set(`${match[1].toUpperCase()} ${path}`, `frontend/src/lib/api/services/${file}`);
    }
  }
  return { calls, usedKeys };
}

/** The service function whose body contains one offset. */
function functionAt(source: string, offset: number): string {
  const entries = [...source.slice(0, offset).matchAll(/^ {2}(\w+):/gm)];
  return entries.length === 0 ? "" : entries[entries.length - 1][1];
}

function listPython(directory: string): string[] {
  try {
    return readdirSync(directory).filter(
      (file: string) => file.endsWith(".py") && file !== "__init__.py",
    );
  } catch {
    return [];
  }
}

function listTypeScript(directory: string): string[] {
  try {
    return readdirSync(directory).filter((file: string) => file.endsWith(".ts"));
  } catch {
    return [];
  }
}
