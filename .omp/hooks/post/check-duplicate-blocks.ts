/**
 * Check-Duplicate-Blocks Post Hook
 *
 * Validates duplicate-blocks.md: 편집 직후, 방금 쓴 파일에 같은 줄 묶음이 두 벌이면
 * 즉시 알린다 — 게이트까지 기다리면 도메인 검사의 2차 증상(순번 어긋남 등)이 먼저 보여
 * 원인을 가린다(재번호 루프 실측).
 *
 * This is a read-only check — it does NOT block tool calls.
 */

// @ts-expect-error — Node builtin, not project-compiled
import { isAbsolute, join, relative } from "node:path";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync } from "node:fs";
import { guarded } from "../lib/hook-visibility.ts";
import { printRuleHint } from "../lib/hook-rule-hint.ts";
import { buildSafeWarning, wrapWarning, resetSuppression } from "../lib/hook-safety-guard.ts";
import { FILE_EDIT_TOOLS } from "../lib/hook-mutating-tools.ts";
import { writtenPaths } from "../lib/hook-tool-paths.ts";
import { checkFileForDuplicates, scanTree } from "../lib/hook-duplicate-blocks.ts";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { resolveProjectRoot } from "../lib/hook-project-root.ts";

const projectRoot = resolveProjectRoot();
// 파일을 쓰는 툴만 본다(bash 는 writtenPaths 가 어차피 빈 배열) — read-only 필터 계약상 이름은 MUTATING_TOOLS.
const MUTATING_TOOLS = new Set<string>(FILE_EDIT_TOOLS);

export default function checkDuplicateBlocks(pi: ExtensionAPI): void {
  pi.on("tool_result", (event: { toolName?: string; input?: Record<string, unknown>; content?: Array<{ type: string; text?: string }> }) => guarded("check-duplicate-blocks", event, () => {
    // hook-scope: global — 어느 경로의 파일이든 방금 쓴 그 파일만 본다(경로는 writtenPaths 가 좁힌다)
    if (event.toolName && !MUTATING_TOOLS.has(event.toolName)) return;
    if (!event.toolName) return;
    const issues: string[] = [];
    for (const p of writtenPaths(String(event.toolName ?? ""), event.input ?? {})) {
      if (p.includes(".omp/")) continue;
      const abs = isAbsolute(p) ? p : join(projectRoot, p);
      const display = isAbsolute(p) ? relative(projectRoot, p) : p;
      issues.push(...checkFileForDuplicates(abs, display));
    }
    if (issues.length === 0) { resetSuppression("check-duplicate-blocks"); return; }
    const warning = buildSafeWarning(event.toolName, "check-duplicate-blocks", issues,
      "run make check-duplicate-blocks for details");
    if (warning === null) return;
    console.error(warning);
    return { content: wrapWarning(warning, event.content, "check-duplicate-blocks") };
  }));
}

// Direct execution (make check-duplicate-blocks): scan the tree and print results.
if (typeof process !== "undefined" && process.argv[1]?.endsWith("check-duplicate-blocks.ts")) {
  const issues = scanTree(projectRoot);
  console.log("==> check-duplicate-blocks");
  if (issues.length === 0) {
    console.log("    PASS: no duplicated block runs in source files");
  } else {
    for (const issue of issues) console.log(`    FAIL: ${issue}`);
    printRuleHint("check-duplicate-blocks");
    console.log(`    ${issues.length} issue(s) found`);
    process.exit(1);
  }
}
