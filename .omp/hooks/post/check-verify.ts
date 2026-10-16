import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
// @ts-expect-error — Node builtin, not project-compiled
import { spawnSync } from "node:child_process";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { tmpdir } from "node:os";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";
import { buildSafeWarning, resetSuppression, wrapWarning } from "../lib/hook-safety-guard.ts";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { MUTATING_TOOLS_NO_BASH as MUTATING_TOOLS } from "../lib/hook-mutating-tools.ts";

declare const process: {
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
};

/**
 * Check-Verify Post Hook
 *
 * Runs backend and frontend verification after a source-changing tool result.
 *
 * bash is deliberately NOT a trigger: `make <target>` already runs its own
 * quality gates, and running a competing `make verify` from the hook while
 * the agent's make runs would race pytest/ruff and produce transient
 * failures. Source changes happen through write/edit/ast_edit — those are
 * the triggers.
 */
const cwd = process.cwd();
const projectRoot = existsSync(join(cwd, "backend", "app")) && existsSync(join(cwd, "frontend", "src"))
  ? cwd
  : existsSync(join(cwd, "..", "backend", "app")) && existsSync(join(cwd, "..", "frontend", "src"))
  ? join(cwd, "..")
  : cwd;

/**
 * Success is cheap to re-confirm later; a failure is not. Holding the same
 * 5-minute silence after a red verify meant the next five minutes of edits got
 * no feedback at all, so failure re-checks quickly.
 */
const THROTTLE_MS = 5 * 60 * 1000;
const FAILURE_THROTTLE_MS = 90 * 1000; // A/B 결론(벤치 스로틀 실험): 스로틀은 이 게이트의 지렛대가 아니다.
// 30초로 되돌린 셀쌍은 integration TIMEOUT(산출물 8/6, 자체 게이트 3회)·rest TIMEOUT(14/15) 였고,
// 90초 셀쌍은 integration TIMEOUT(11/6, 게이트 5회)·rest 1461초 15/15(역대 최속) 였다.
// 즉 30초가 발견을 앞당긴다는 증거가 없고, 비용(1회 1.8~7.7초의 실제 make)만 3배다 — 90초 유지.
let lastRunAt = 0;
let lastRunFailed = false;

/** Lines worth quoting: what failed, not the 200 lines of progress before it. */
const DIAGNOSTIC_LINE = /FAILED|ERROR|error:|Error:|error TS|Coverage failure|assert|make: \*\*\*/;
const MAX_DIAGNOSTIC_LINES = 3;

export default function checkVerify(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: {
    toolName?: string;
    input?: Record<string, unknown>;
    content?: Array<{ type: string; text?: string }>;
  }) => guarded("check-verify", event, () => {
    // hook-scope: global — 전체 게이트 — 무엇을 고쳤든 프로젝트 검증이 대상이다
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (isMakeCommand(event.input)) return;

    const now = Date.now();
    const throttle = lastRunFailed ? FAILURE_THROTTLE_MS : THROTTLE_MS;
    if (now - lastRunAt < throttle) return;
    lastRunAt = now;

    const issues = runVerify();
    lastRunFailed = issues.length > 0;
    if (issues.length === 0) {
      resetSuppression("check-verify");
      return;
    }
    const warning = buildSafeWarning(
      event.toolName,
      "check-verify",
      issues,
      "run make check-verify for details",
    );
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-verify") };
  }));
}

function isMakeCommand(input: Record<string, unknown> | undefined): boolean {
  if (!input) return false;
  // Defensive: a make command on any triggering tool's input already ran its
  // own gates — never spawn a competing nested verify.
  return /^\s*make(?:\s|$)/.test(String(input.command ?? ""));
}

/**
 * The exit status alone ("make verify failed (exit 2)") sent every reader to run
 * the command by hand. The tail of the child's own output names the failing
 * test, rule or type error directly.
 */
function diagnose(dir: string, status: number, output: string): string {
  const label = dir === projectRoot ? "root" : dir.split("/").pop();
  const diagnosis = output
    .split("\n")
    .filter((line: string) => DIAGNOSTIC_LINE.test(line))
    .slice(-MAX_DIAGNOSTIC_LINES)
    .map((line: string) => line.trim())
    .join(" | ");
  return `${label}: make verify failed (exit ${status})` + (diagnosis === "" ? "" : ` — ${diagnosis}`);
}

/** Single-quoted for `sh`, with the one escape that shape needs. */
function shellQuote(value: string): string {
  return `'${value.split("'").join(`'\\''`)}'`;
}

/**
 * The two gates overlap in wall time, never in what they touch: backend reads
 * `backend/` and runs its suite against an in-memory sqlite engine per test
 * (tests/conftest.py), frontend reads `frontend/` and writes its own `dist`.
 * Serially they add up — measured 41s + 11s = 52.3s, which was 61% of the whole
 * 85s `make verify`. Run side by side, the gate costs the longer of the two.
 *
 * `sh` does the waiting because the handler must stay synchronous: `guarded()`
 * times and classifies the body it wraps, and a returned promise would settle
 * after the hook already reported. Each side's output and exit status land in
 * its own file, so the per-side label and diagnostic tail survive the overlap
 * — a merged stream would attribute the frontend's error to the backend.
 */
function runGates(dirs: string[]): string[] {
  const scratch = mkdtempSync(join(tmpdir(), "check-verify-"));
  try {
    const jobs = dirs.map((dir: string, index: number) => ({
      dir,
      log: join(scratch, `${index}.log`),
      status: join(scratch, `${index}.status`),
    }));
    const script = jobs
      .map((job) =>
        `( make -C ${shellQuote(job.dir)} verify >${shellQuote(job.log)} 2>&1; ` +
          `echo $? >${shellQuote(job.status)} ) &`,
      )
      .join("\n");
    spawnSync("sh", ["-c", `${script}\nwait`], { encoding: "utf-8" });

    const issues: string[] = [];
    for (const job of jobs) {
      // A missing status file means `sh` never ran the job at all — reported as a
      // failure, because a gate that did not run is not a gate that passed.
      const status = existsSync(job.status) ? Number.parseInt(readFileSync(job.status, "utf-8").trim(), 10) : NaN;
      if (status === 0) continue;
      const output = existsSync(job.log) ? readFileSync(job.log, "utf-8") : "";
      issues.push(diagnose(job.dir, status, output));
    }
    return issues;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function runVerify(): string[] {
  const issues: string[] = [];
  const dirs: string[] = [];

  for (const name of ["backend", "frontend"]) {
    const dir = join(projectRoot, name);
    if (existsSync(join(dir, "Makefile"))) dirs.push(dir);
    else issues.push(`${name}/Makefile: not found`);
  }
  issues.push(...runGates(dirs));

  return issues;
}

if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-verify.ts")) {
  const issues = runVerify();
  console.log("==> check-verify");
  if (issues.length === 0) {
    console.log("    PASS: backend + frontend make verify passed");
    process.exit(0);
  }
  for (const issue of issues) {
    console.log(`    FAIL: ${issue}`);
  }
  printRuleHint("check-verify");
  console.log(`    ${issues.length} issue(s) found`);
  process.exit(1);
}
