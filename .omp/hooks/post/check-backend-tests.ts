/**
 * Check-Backend-Tests Post Hook
 *
 * After tool execution, validates the backend test standard in
 * .omp/rules/backend-testing.md:
 *   1. Folder structure: tests/api/ (HTTP), tests/repositories/,
 *      tests/services/, tests/core/, tests/engine/, tests/conftest.py.
 *   2. Every CRUD domain (model in app/models/) has tests/api/test_<name>.py
 *      covering the 9 standard API cases.
 *   3. tests/conftest.py uses the real get_session() (swaps the session
 *      factory) — no dependency override.
 *   4. Every router endpoint is exercised by its api test file.
 *   5. Repository, service, core and engine modules have mirrored test files.
 *
 * The 100% coverage gate itself is enforced by `make test`
 * (--cov-fail-under=100 in pyproject.toml) — this hook checks the
 * structural standard that coverage alone cannot express.
 *
 * This is a read-only check — it does NOT block tool calls.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { aggregateDomains, belongsToAggregateDomain } from "../lib/backend-domain-structure.ts";
import { layerFiles } from "../lib/backend-layout.ts";
import { hasLayer } from "../lib/backend-domain-layers.ts";
import { touchesPath } from "../lib/hook-scope.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";

const projectRoot = resolveProjectRoot();
const testsDir = join(projectRoot, "backend", "tests");
const apiDir = join(testsDir, "api");
const repositoriesTestDir = join(testsDir, "repositories");
const servicesTestDir = join(testsDir, "services");

/**
 * Words that carry no information when they are all a docstring adds: they turn
 * "create user" into "test that the user is created" without saying why.
 */
const FILLER_WORDS: Record<string, true> = {
  test: true, tests: true, that: true, the: true, a: true, an: true, is: true, are: true,
  and: true, or: true, for: true, with: true, of: true, to: true, in: true, on: true,
  it: true, its: true, be: true, been: true, should: true, must: true, when: true, then: true,
  returns: true, return: true, check: true, checks: true, verify: true, verifies: true,
};
const coreTestDir = join(testsDir, "core");
const engineTestDir = join(testsDir, "engine");
const modelsDir = join(projectRoot, "backend", "app", "models");
const servicesDir = join(projectRoot, "backend", "app", "services");
// 요구 방향(omp-hooks.md): 테스트는 라우터가 선 뒤에 owed 다. 완성의 정의는 한 곳에서 온다.
const API_VERSION_PREFIX = "(?:/api/v\\d+)?";

/**
 * Read-only tools never change files — running the check after them wastes
 * context. Only run after tools that can modify the workspace.
 */

/** The 9 standard API cases every CRUD domain test file must cover. */
// 케이스마다 그것을 owed 로 만드는 라우터 메서드를 적는다(요구 방향 감사).
// POST+GET 만 있는 라우터에 update/delete 테스트를 요구하면 존재하지 않는 엔드포인트의 테스트를
// 요구하는 셈이다 — 실측에서 이 형태로 69건이 나갔다.
const CASE_METHOD: Record<string, RegExp | null> = {
  create: /@router\.post/, list: /@router\.get/, get: /@router\.get/, "get-404": /@router\.get/,
  update: /@router\.(put|patch)/, "update-404": /@router\.(put|patch)/,
  delete: /@router\.delete/, "delete-404": /@router\.delete/,
  "create-422": /@router\.post/,
};

const API_CASES: [string, RegExp][] = [
  ["create", /def test_create_/],
  ["list", /def test_list_/],
  ["get", /def test_get_(?!.*not_found)/],
  ["get-404", /def test_get_.*not_found/],
  ["update", /def test_update_(?!.*not_found)/],
  ["update-404", /def test_update_.*not_found/],
  ["delete", /def test_delete_(?!.*not_found)/],
  ["delete-404", /def test_delete_.*not_found/],
  ["create-422", /def test_create_.*422|status_code == 422/],
];

/**
 * The standard cases are matched by name, so a case whose assertion is gutted
 * (404 quietly becoming 200) still counts. These status codes must actually be
 * asserted somewhere in the file.
 */
const API_STATUS_ASSERTIONS = [201, 404, 422];

export default function checkBackendTests(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; content?: Array<{ type: string; text?: string }> }) => guarded("check-backend-tests", event, () => {
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!touchesPath(event, ["backend/"])) return;

    const issues = checkBackendTestsSync();
    if (issues.length === 0) {
      resetSuppression("check-backend-tests");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-backend-tests",
      issues,
      "run make check-backend-tests for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-backend-tests") };
  }));
}

/**
 * A docstring that restates the function name is noise: `"""Test create user."""`
 * on `test_create_user` tells a reader nothing the signature did not. Ruff's
 * pydocstyle owns *presence* (D100/D103, pyproject.toml); this owns *substance*,
 * which no linter can judge — the words must not be the name rearranged.
 */
function checkDocstringSubstance(testsDir: string): string[] {
  const issues: string[] = [];
  for (const file of walkPython(testsDir)) {
    const source = readFileSync(file, "utf-8");
    const label = relative(file);
    for (const match of source.matchAll(/^def (\w+)\([^)]*\)[^\n]*:\n\s+"""([^"\n]*)/gm)) {
      const [, name, summary] = match;
      const nameWords = new Set<string>(
        name.replace(/^test_/, "").split("_").filter((word: string) => word.length > 2),
      );
      const summaryWords = new Set<string>(
        summary.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean),
      );
      const extra = [...summaryWords].filter((word: string) => !nameWords.has(word) && !FILLER_WORDS[word]);
      if (extra.length === 0) {
        const line = source.slice(0, match.index ?? 0).split("\n").length;
        issues.push(
          `${label}:${line}: ${name} docstring "${summary.trim()}" only restates the name — ` +
            "say why the case is part of the contract, or what would break without it",
        );
      }
    }
  }
  return issues;
}

function checkBackendTestsSync(): string[] {
  const issues: string[] = [];
  const aggregates = aggregateDomains();

  if (!existsSync(testsDir)) {
    issues.push("backend/tests/ directory not found");
    return issues;
  }
  if (!existsSync(modelsDir)) {
    issues.push("backend/app/models/ directory not found");
    return issues;
  }

  // --- 0. Folder structure ---
  for (const [dir, label] of [
    [apiDir, "tests/api/ (HTTP API tests)"],
    [repositoriesTestDir, "tests/repositories/ (repository unit tests)"],
    [servicesTestDir, "tests/services/ (service unit tests)"],
    [coreTestDir, "tests/core/ (core unit tests)"],
    [engineTestDir, "tests/engine/ (engine unit tests)"],
  ] as const) {
    if (!existsSync(dir)) {
      issues.push(`${label} directory missing`);
    }
  }

  // --- 1. Every domain has tests/api/test_<domain>.py ---
  //
  // Domains come from `services/`, not from model files: one table per model file
  // is the model rule (`backend-model-files.md`), so `models/request_log.py`
  // is a table, never a domain of its own unless a service owns it.
  if (existsSync(apiDir) && existsSync(servicesDir)) {
    const apiFiles = new Set(readdirSync(apiDir).filter((f: string) => f.endsWith(".py")));
    // layer-flat-ok: the unit here is a domain, not a file — a folder domain is
    // one domain with one API test file, and `belongsToAggregateDomain` already
    // excludes it, so descending would demand `test_<folder>/<file>.py`.
    for (const f of readdirSync(servicesDir)) {
      if (!f.endsWith(".py") || f === "__init__.py") continue;
      const name = f.replace(/\.py$/, "");
      if (belongsToAggregateDomain(name, aggregates)) continue;
      // 요구 방향(감사 실측): 라우터가 서기 전에는 테스트를 요구하지 않는다. 모델 파일 하나에
      // 10케이스 HTTP 스위트를 요구하는 것은 트리거 시점에 **충족 불가능**한 요구였고, 실측상 191세션 중
      // 125세션에 걸쳐 이 목록이 모델에게 작업 큐로 읽혔다. 완성 계약은 커버리지 100% 게이트가 지킨다.
      if (!hasLayer(projectRoot, "router", name)) continue;
      const testFile = `test_${name}.py`;
      if (!apiFiles.has(testFile)) {
        issues.push(`domain '${name}' has no tests/api/test_${name}.py — add the standard CRUD test file`);
      }
    }
  }

  // --- 2. Each model-backed API test file covers the 9 standard API cases ---
  if (existsSync(apiDir)) {
    for (const f of readdirSync(apiDir)) {
      if (!f.startsWith("test_") || !f.endsWith(".py")) continue;
      const name = f.replace(/^test_|\.py$/g, "");
      if (belongsToAggregateDomain(name, aggregates)) continue;
      if (!existsSync(join(modelsDir, `${name}.py`))) continue;
      const content = readFileSync(join(apiDir, f), "utf-8");
      const routerPath = join(projectRoot, "backend", "app", "routers", `${name}.py`);
      const routerSrc = existsSync(routerPath) ? readFileSync(routerPath, "utf-8") : "";
      for (const [label, re] of API_CASES) {
        const method = CASE_METHOD[label];
        if (method && !method.test(routerSrc)) continue; // 그 엔드포인트가 없으면 그 테스트도 없다
        if (!re.test(content)) {
          issues.push(`tests/api/${f}: router declares this endpoint but the standard case '${label}' is missing (${re})`);
        }
      }
      for (const code of API_STATUS_ASSERTIONS) {
        if (!content.includes(`status_code == ${code}`)) {
          issues.push(
            `tests/api/${f}: no assertion on status ${code} — a standard case exists in ` +
              "name only when its status assertion is missing",
          );
        }
      }
    }
  }

  issues.push(...checkDocstringSubstance(testsDir));

  // --- 3. conftest uses the real get_session() (no dependency override) ---
  const conftestPath = join(testsDir, "conftest.py");
  if (existsSync(conftestPath)) {
    const conftest = readFileSync(conftestPath, "utf-8");
    if (conftest.includes("dependency_overrides")) {
      issues.push("conftest.py uses dependency_overrides — swap async_session_factory instead (real get_session())");
    }
    if (!conftest.includes("async_session_factory")) {
      issues.push("conftest.py does not swap async_session_factory — the real get_session() lifecycle is untested");
    }
    // Hermetic environment: pydantic-settings reads os.environ before the
    // .env file, so an exported root .env made settings tests pass in one
    // terminal and fail in another. The names must come from the model, not a
    // hardcoded list, or a new field silently reintroduces the leak.
    const isolates =
      /monkeypatch\.delenv/.test(conftest) && /Settings\.model_fields/.test(conftest);
    if (!isolates) {
      issues.push(
        "conftest.py has no autouse fixture clearing Settings.model_fields from os.environ — " +
          "ambient env vars leak into settings tests and make the same commit green in one " +
          "shell and red in another",
      );
    }
  } else {
    issues.push("tests/conftest.py missing");
  }

  // --- 4. Router endpoints ↔ api test path coverage ---
  const routersDir = join(projectRoot, "backend", "app", "routers");
  if (existsSync(routersDir) && existsSync(apiDir)) {
    for (const f of readdirSync(routersDir)) {
      if (!f.endsWith(".py") || f === "__init__.py") continue;
      const name = f.replace(/\.py$/, "");
      const testPath = join(apiDir, `test_${name}.py`);
      if (!existsSync(testPath)) continue; // missing file already flagged in check 1
      const routerContent = readFileSync(join(routersDir, f), "utf-8");
      const testContent = readFileSync(testPath, "utf-8");
      const prefixMatch = routerContent.match(/prefix\s*=\s*"([^"]+)"/);
      const prefix = prefixMatch ? prefixMatch[1] : `/${name}`;
      for (const m of routerContent.matchAll(/@router\.(get|post|put|delete)\("([^"]*)"\)/g)) {
        const method = m[1].toUpperCase();
        const path = m[2] === "/" ? `${prefix}/` : `${prefix}${m[2]}`;
        // A parameterised path is exercised through an f-string that carries the
        // literal head up to its first `{`: `/project/{project_id}` as `f"/api/v1/project/{`,
        // and `/project/{project_id}/endpoints` as `f"/api/v1/project/{`.
        // Matching only `<prefix>/{` missed every sub-resource path.
        const head = path.split("{")[0];
        const pathRe = new RegExp(
          `[\"']${API_VERSION_PREFIX}${escapeRegExp(path)}[\"']|f[\"']${API_VERSION_PREFIX}${escapeRegExp(head)}\\{`,
        );
        if (!pathRe.test(testContent)) {
          issues.push(`tests/api/test_${name}.py: endpoint ${method} ${path} not exercised — add a test hitting this path`);
        }
      }
    }
  }

  // --- 5. Repository modules ↔ tests/repositories/<same path> ---
  // The test tree mirrors the source tree: `repositories/<folder>/<table>.py`
  // is tested by `tests/repositories/<folder>/test_<table>.py`. Reading only
  // the top level made a folder invisible - the loop found no `.py` files and
  // reported success on nothing.
  const reposSrcDir = join(projectRoot, "backend", "app", "repositories");
  if (existsSync(reposSrcDir) && existsSync(repositoriesTestDir)) {
    for (const f of layerFiles(reposSrcDir)) {
      const name = f.replace(/\.py$/, "").split("/").pop() ?? "";
      const domain = f.includes("/") ? f.split("/")[0] : name;
      if (belongsToAggregateDomain(domain, aggregates)) continue;
      // 요구 방향(감사 실측): 라우터가 서기 전에는 테스트를 요구하지 않는다. 모델 파일 하나에
      // 10케이스 HTTP 스위트를 요구하는 것은 트리거 시점에 **충족 불가능**한 요구였고, 실측상 191세션 중
      // 125세션에 걸쳐 이 목록이 모델에게 작업 큐로 읽혔다. 완성 계약은 커버리지 100% 게이트가 지킨다.
      if (!hasLayer(projectRoot, "router", domain)) continue;
      const repoTestPath = join(repositoriesTestDir, testPathFor(f));
      if (!existsSync(repoTestPath)) {
        issues.push(
          `repository module '${f}' has no tests/repositories/${testPathFor(f)} — ` +
            "add repository unit tests",
        );
      }
    }
  }

  // --- 6. Service modules ↔ tests/services/<same path> ---
  // Every service module must have a matching test file, and every public
  // method must be referenced there. HTTP tests alone cannot cover
  // service-layer contracts (NotFoundError raising, transaction boundaries,
  // IntegrityError on duplicates).
  if (existsSync(servicesDir) && existsSync(servicesTestDir)) {
    for (const f of layerFiles(servicesDir)) {
      const serviceDomain = f.includes("/") ? f.split("/")[0] : f.replace(/\.py$/, "");
      // 요구 방향(감사 실측): 라우터가 서기 전에는 테스트를 요구하지 않는다. 모델 파일 하나에
      // 10케이스 HTTP 스위트를 요구하는 것은 트리거 시점에 **충족 불가능**한 요구였고, 실측상 191세션 중
      // 125세션에 걸쳐 이 목록이 모델에게 작업 큐로 읽혔다. 완성 계약은 커버리지 100% 게이트가 지킨다.
      if (!hasLayer(projectRoot, "router", serviceDomain)) continue;
      const relativeTest = testPathFor(f);
      const servicesTestPath = join(servicesTestDir, relativeTest);
      if (!existsSync(servicesTestPath)) {
        issues.push(
          `service module '${f}' has no tests/services/${relativeTest} — add service unit tests`,
        );
        continue;
      }
      const content = readFileSync(join(servicesDir, f), "utf-8");
      const servicesTestContent = readFileSync(servicesTestPath, "utf-8");
      for (const m of content.matchAll(/^    async def (\w+)\(/gm)) {
        const method = m[1];
        // The claim is that a service's **surface** is tested. A `_` helper is
        // not surface: naming it in a test pins an implementation detail the
        // privacy prefix exists to hide, and the coverage gate already proves
        // its lines run.
        if (method.startsWith("_")) continue;
        if (!servicesTestContent.includes(method)) {
          issues.push(
            `service method '${method}' (${f}) not tested — add a test in ` +
              `tests/services/${relativeTest}`,
          );
        }
      }
    }
  }

  // --- 7. Core and engine modules ↔ tests/<layer>/ ---
  // Every module in app/core/ (exceptions, settings, logging, page) and
  // app/engine/ (the path matcher, the body templating)
  // must have a matching test file in tests/<layer>/ — this is infrastructure
  // that HTTP tests exercise only indirectly.
  for (const layer of ["core", "engine"]) {
    const layerSrcDir = join(projectRoot, "backend", "app", layer);
    if (!existsSync(layerSrcDir)) continue;
    for (const f of layerFiles(layerSrcDir)) {
      const name = f.replace(/\.py$/, "");
      if (!existsSync(join(testsDir, layer, `test_${name}.py`))) {
        issues.push(`${layer} module '${name}' has no tests/${layer}/test_${name}.py — add ${layer} unit tests`);
      }
    }
  }

  return issues;
}

/** Escapes regex special characters for literal matching. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every test module, so the docstring check sees the same files pytest does. */
function walkPython(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__pycache__") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walkPython(path));
    else if (entry.name.endsWith(".py") && entry.name !== "__init__.py") found.push(path);
  }
  return found;
}

function relative(path: string): string {
  return path.startsWith(projectRoot) ? path.slice(projectRoot.length + 1) : path;
}

// Direct execution (make check-backend-tests): run the check and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-backend-tests.ts")) {
  const issues = checkBackendTestsSync();
  console.log("==> check-backend-tests");
  if (issues.length === 0) {
    console.log("    PASS: backend test standard valid (api/repositories/services/core/engine, 9 cases, conftest)");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-backend-tests");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}

/**
 * `<folder>/<table>.py` → `<folder>/test_<table>.py`: the test tree mirrors
 * the source tree, so a reader finds a module's test at the module's own path.
 */
function testPathFor(sourceRelativePath: string): string {
  const parts = sourceRelativePath.split("/");
  const file = parts.pop() ?? "";
  return [...parts, `test_${file}`].join("/");
}
