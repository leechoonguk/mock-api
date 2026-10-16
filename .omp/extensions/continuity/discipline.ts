/**
 * Session Discipline — zero-base redesign from measured lessons
 * (측정 이력: `decks/harness-history`).
 *
 * Design system (every principle carries its measurement):
 *  1. Knowledge lives in docs. The rulebook checklist + Exemplar Map took the
 *     hookless REST gate to 2/2 (fixed-harness-baseline). Docs are for WHAT.
 *  2. Behavior moves only through runtime messages. Injected turn-time
 *     messages worked every time they fired (verify nudge pulled the first
 *     verification from 25+ to ~14 minutes; finish-check redirected four real
 *     finishes; red re-drives led to green recoveries). Static doc directives
 *     for tool choice or work order were adopted zero times in two campaigns
 *     and were removed. Hooks are for WHEN.
 *  3. Sickness is wall time only. Turn counts over-fire on fast turns and
 *     under-fire on slow ones (both measured); 7m stall / 12m red-age.
 *  4. Start early, guard the finish. The two green hook cells shared exactly
 *     these two levers; everything in between belongs to the model.
 *  5. Destruction is blocked, not advised (strict-* pre hooks + the verify
 *     gate). This module only nudges and cuts; it never blocks.
 *
 * 남은 신호는 둘뿐이다. 건강한 세션은 아무 메시지도 받지 않는다.
 *
 *  - REG-WATCH   배선 파일(import·라우터 등록·DI 별칭)에서 기존 등록이 사라지면 즉시 알린다.
 *    등록은 누적되는 것이라 교체는 다른 도메인을 라우팅에서 지운다. 파일별 상한이 있다.
 *  - 마감 게이트  변경 이후 프로젝트 루트 게이트가 성공하지 않았는데 세션이 끝나려 하면 막는다.
 *    빨간 게이트 위에서 "끝났다"고 선언하는 것을 잡는 장치다(END_GATE_MAX 만큼 재구동).
 *
 * 이 모듈은 밀기만 하고 막지 않는다. 컨텍스트 조작은 하지 않는다 — 창 관리는 omp 소관이다.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { resolve } from "node:path";

const FULL_GATE_RE = /\bmake\b[^|;&]*\bverify\b(?!-fast)|\bmake\b[^|;&]*\btest\b(?!-fast)/;
// 하위 디렉터리로 좁힌 게이트는 풀 게이트가 아니다. 실측: 피험자가
// `cd …/sandbox/backend && make verify` 를 11회 돌리고 루트 게이트는 0회였는데 하네스가 초록으로
// 셌고, 최종 루트 게이트는 `notice: router exists but api/notice.http is missing` 로 exit 2 였다.
const SUBDIR_GATE_RE = /\bcd\s+[^\s;&|]*\/(backend|frontend|api|decks)\b|\bmake\b[^|;&]*\s-C\s+(backend|frontend|api|decks)\b/; // full-gate command shapes (하위 디렉터리 게이트는 full 게이트가 아니다)
// 절대 상한: 성장 기반 예산만으로는 **정체된 세션**을 못 잡는다 — 축소판 첫 셀에서
// ctx 96,074·턴 183초까지 갔는데 컷이 한 번도 안 걸렸다(증가폭이 예산에 못 미쳐서다).
// 질병 컷을 되살리지 않고 같은 구멍을 막는 최소 장치다. 창을 모르면(0) 적용하지 않는다.
// 창의 이 비율을 넘으면 성장과 무관하게 컷. 셀마다 켜고 끌 수 있게 환경변수로 뺀다(0 이면 끔) —
// 하네스를 고치지 않고 같은 조건에서 두 팔을 번갈아 돌리기 위해서다(rest 분산 판정용).
const END_GATE_MAX = 2;              // red-finish re-drives
// 하드 finish-block 의 상한(실측): 퇴행 루프(툴 0, 같은 사설 반복)에 무제한
// 게이트가 물리면 차단 104회 × ~25s 로 캡을 태우고, 차단 프롬프트 자체가 ctx 를 91k 까지
// 밀어 올려 모델 창 초과 오류로 끝났다. 상한 뒤에는 빨간 채로 끝나게 둔다 — 그 행이 측정이다.
const FINISH_BLOCK_MAX = 8;
const REG_FILES = [ // registration/wiring files under watch — line-replacement is this model's chronic habit (repeated observation: services.py User->Notice wholesale swap)
  "backend/alembic/env.py",
  "backend/tests/conftest.py",
  "backend/app/dependencies/services.py",
  "backend/app/main.py",
];
const REG_WATCH_MAX = 3;             // registration-loss messages **per watched file**(실측: 세션 상한이 앞선 파일들에서 소진돼 main.py 소실 때 침묵했다 — 회귀 1건)

export function registerDiscipline(pi: any): void {
  const logPath = process.env.STUCK_RESET_LOG || "";
  const log = (s: string) => { if (logPath) { try { appendFileSync(logPath, `[continuity] ${s}\n`); } catch {} } };

  let endGateSends = 0, lastTurnAt = Date.now();
  let mutatedEver = false;
  const persisted = loadPersisted();
  let lastGateAt = persisted.lastGateAt ?? 0, lastNoticeAt = persisted.lastNoticeAt ?? 0, gateBlocks = 0, turnCount = 0;
  let lastMutationAt = 0;
  const unverified = new Set<string>();
  const srcWritten = new Set<string>();
  const testWritten = new Set<string>();
  let redSig: string | null = null;
  let redCmdTk: Set<string> | null = null;
  const regSnapshot = new Map<string, Set<string>>();
  const regWarned = new Set<string>();
  const regWarnCount = new Map<string, number>();
  for (const rel of REG_FILES) {
    try {
      const abs = resolve(process.cwd(), rel);
      if (existsSync(abs)) regSnapshot.set(rel, importLines(readFileSync(abs, "utf-8")));
    } catch {}
  }

  function regCheck(touched: string): void {
    for (const rel of REG_FILES) {
      if (!touched.endsWith(rel) && !rel.endsWith(touched) && !touched.includes(rel.split("/").pop() ?? rel)) continue;
      const snap = regSnapshot.get(rel);
      if (!snap) continue;
      try {
        const abs = resolve(process.cwd(), rel);
        if (!existsSync(abs)) continue;
        const cur = importLines(readFileSync(abs, "utf-8"));
        const dropped = [...snap].filter((l) => !cur.has(l) && !regWarned.has(l));
        if (dropped.length === 0 || (regWarnCount.get(rel) ?? 0) >= REG_WATCH_MAX) continue;
        dropped.forEach((l) => regWarned.add(l));
        regWarnCount.set(rel, (regWarnCount.get(rel) ?? 0) + 1);
        pi.sendUserMessage(`A registration line just vanished from ${rel}: \`${dropped[0]}\`${dropped.length > 1 ? ` (+${dropped.length - 1} more)` : ""}. These imports register models/behavior the rest of the code depends on — restore the line and add yours alongside it instead of replacing.`);
        log(`REG-WATCH ${rel}: ${dropped[0].slice(0, 60)}`);
      } catch {}
    }
  }

  log(`loaded discipline. endGate=${END_GATE_MAX} regWatch=${regSnapshot.size}files (context management belongs to omp)`);


  pi.on("tool_result", (event: any, _ctx: any) => {
    try {
      const content = contentText(event.content);
      if (event.isError && isPolicyBlock(content)) return;
      const f = failSig(content);
      // 서 있는 하네스 검사 경고 추적 — backend 스코프 verify 초록 위에서 종료한
      // 실측 셀(1738s)의 가짜완료 메커니즘. finish 시점에 lastGateAt 과 비교한다.
      if (/\[check-[a-z-]+\][^]{0,60}issue/.test(content)) { lastNoticeAt = Date.now(); savePersisted({ lastNoticeAt }); }
      if (/^bash/i.test(event.toolName)) {
        const cmdStr = norm(str(event.input)).slice(0, 300);
        const cmdTk = tokens(cmdStr);
        const truncated = /\|\s*(?:tail|head|grep|sed|awk|wc)\b/.test(cmdStr);
        const fullGate = !truncated && FULL_GATE_RE.test(cmdStr) && !SUBDIR_GATE_RE.test(cmdStr);
        if (!event.isError) {
          for (const wp of shellWritePaths(cmdStr)) {
            (/(^|\/)tests?\//.test(wp) ? testWritten : srcWritten).add(wp);
            unverified.add(wp); mutatedEver = true; lastMutationAt = Date.now(); regCheck(wp);
          }
        }
        // 성공한 게이트만 검증으로 센다. 실패한 게이트까지 밀면 마감 판정이 참이 되어 차단이 침묵한다
        // (실측: 마지막 게이트가 빨간 채 종료, 최종 루트 게이트 exit 2).
        if (fullGate && !event.isError && !f) {
          lastGateAt = Date.now(); unverified.clear(); savePersisted({ lastGateAt });
        }
        if (f) {
          // 시그니처 교체 = 다른 실패로 전진 중 — same-signature 시계를 절반만 남기고
          // 연장한다(총상한 RED_TOTAL_MS). 실측: gatefix-a2 에서 4개 시그니처가 12분간
          // 전진 중인데 컷이 원래 시계로 발화했다(실측 토의).
          redSig = f; redCmdTk = cmdTk; log(`red: ${f.slice(0, 100)}`);
        }
        if (!event.isError && (fullGate || (!truncated && redSig && redCmdTk && jaccard(cmdTk, redCmdTk) >= 0.5))) {
          if (f) { /* red run — not a clear */ } else {
          // 전체 게이트 성공은 가장 강한 초록 증거 — Jaccard 무관 clear.
          // 실측: 성공 셀에서 stale red 가 END-GATE 2발을 소진시켰다.
          if (redSig) log(fullGate ? "green — red cleared (full-gate success)" : "green — red cleared (same-command success)");
          redSig = null; redCmdTk = null;
          }
        }
      }
      if (!f && !event.isError && isMutating(event.toolName)) {
        mutatedEver = true;
        const path = String(event.input?.path ?? "");
        if (path) { (/(^|\/)tests?\//.test(path) ? testWritten : srcWritten).add(path); unverified.add(path); lastMutationAt = Date.now(); regCheck(path); }
        else if (/^bash/i.test(event.toolName)) regCheck(norm(str(event.input)).slice(0, 300));
        // 스키마 무관 백스톱: 패치형 결과는 입력에 path 가 없어도 결과 텍스트에
        // [path#TAG] 로 파일명을 남긴다 — 실셀에서 입력 트리거만으로 env.py
        // 회귀를 놓친 실측이 근거다.
        regCheck(content.slice(0, 500));
      }
    } catch (e) { log(`tool_result ERR ${String(e)}`); }
  });

  pi.on("turn_end", (e: any, ctx: any) => {
    try {
      turnCount++;
      const now = Date.now();
      const used = (() => { try { return ctx.getContextUsage?.()?.tokens ?? 0; } catch { return 0; } })();
      log(`turn dt=${((now - lastTurnAt) / 1000).toFixed(1)}s ctx=${used}`);   // 계측만 남긴다 — 컷은 omp 소관
      lastTurnAt = now;

      // 중단된 턴의 처리는 **중단 주체**에 따라 갈린다(실측으로 분리).
      //  - `aborted` = 사용자의 Esc. "끝냈다"가 아니므로 침묵한다 — 신호를 내면 방금 취소한
      //    작업을 다시 굴려서 Esc 가 먹지 않는 것처럼 보인다(사용자 보고 → 프루프 S1).
      //  - `error` = 런타임/제공자 오류. 여기서도 침묵했더니 **작업이 미완인 채 세션이 조용히
      //    끝났다**: 벤치 셀 하나가 18/26 산출물·게이트 빨강 상태에서 32분 만에 종료했고
      //    (캡의 1/3), 마감 개입은 0이었다. 사용자가 멈춘 것이 아니므로 마감 게이트는 살아
      //    있어야 한다 — 오류로 끊긴 턴은 재개를 요청한다(한도는 END_GATE_MAX 를 공유).
      const stopReason = String(e.message?.stopReason ?? e.stopReason ?? "");
      if (stopReason === "aborted") { log("turn interrupted (aborted, 사용자) — 신호 없음"); return; }
      if (stopReason === "error") {
        if (mutatedEver && endGateSends < END_GATE_MAX) {
          endGateSends++;
          pi.sendUserMessage(
            "The previous turn ended with a runtime error, not with your work finished. " +
            "Nothing you changed has been verified since. Re-run the verification that covers " +
            "what you touched and continue from what it reports — do not restart from scratch.",
          );
          log(`turn interrupted (error) — RESUME #${endGateSends}`);
        } else {
          log("turn interrupted (error) — 예산 소진 또는 변경 없음, 신호 없음");
        }
        return;
      }

      const prose = !(e.toolResults && e.toolResults.length);
      if (prose && endGateSends < END_GATE_MAX) {
        if (redSig) {
          endGateSends++;
          pi.sendUserMessage(`You just finished your answer, but the last observed verification result was failing:\n${redSig.slice(0, 300)}\nRe-run the verification to confirm it actually passes, and finish the remaining failures if any are left.`);
          log(`END-GATE re-drive #${endGateSends}`);
        } else if (gateBlocks >= FINISH_BLOCK_MAX) {
          log(`FINISH-RELEASE (block cap ${FINISH_BLOCK_MAX} reached — ending red is the measurement)`);
        } else if (mutatedEver && (lastGateAt < lastMutationAt || (lastNoticeAt > 0 && lastNoticeAt > lastGateAt))) {
          // 하드 finish-block(무제한·멱등): 널 블록에서 full 게이트 무실행 종료와
          // backend 스코프 초록 + 서 있는 check-* 경고 위 종료가 finish-check ×2 를
          // 통과했다(부검 실측). 게이트의 완료 정의를 기계로 집행한다.
          // 비례 규칙(변경이 작으면 타깃 검증으로 마감)은 철회했다.
          // 그 규칙은 post 훅 52개가 편집마다 돌아 하네스 검사를 이미 끝내 놓은 상태를 전제했다.
          // 그 자동 실행을 `.omp/config.yml` 의 `disabledExtensions` 로 껐으므로(실측 `make hook-report`:
          // 변이 도구 호출 1건당 3.8초, 세션당 ~570초), `make -C backend verify` 로 끝내면 52개 검사가
          // 그 세션에서 한 번도 돌지 않는다. 마감 조건은 변경 규모와 무관하게 루트 게이트 하나다(직렬 87초, 1회).
          const noticeStanding = lastNoticeAt > 0 && lastNoticeAt > lastGateAt;
          gateBlocks++;
          const why = noticeStanding
            ? "a harness check notice was raised after your last full verification run"
            : "the full verification has not run since your last change";
          let bmsg = `You are finishing, but ${why}. Run \`make verify\` from the project root end-to-end now, address anything it or a standing system-notice reports, and only then finish.`;
          if (gateBlocks >= 3) bmsg += ` The single next action is exactly: make verify`;
          pi.sendUserMessage(bmsg);
          log(`FINISH-BLOCK #${gateBlocks}`);
        }
      }
    } catch (e2) { log(`turn_end ERR ${String(e2)}`); }
  });


  pi.on("agent_end", (e: any) => {
    log(`agent_end msgs=${(e.messages||[]).length} endGate=${endGateSends} red=${redSig ? "YES" : "no"}`);
  });
}

// ---- helpers (details after the entry point — check-code-layout) ----
function importLines(content: string): Set<string> {
  // 감시 줄 = import + DI 별칭(*Dep = Annotated[...]) + 라우터 등록(include_router).
  // import 만으로는 services.py 의 Dep 교체·main.py 의 라우터 소실을 못 본다(실측).
  return new Set(content.split("\n").map((l) => l.trim()).filter((l) =>
    /^(from\s+\S+\s+import\b|import\s+\S)/.test(l)
    || /^\w+Dep\s*=\s*Annotated\b/.test(l)
    || /\binclude_router\(/.test(l)));
}

// 프롬프트 간 상태(실측): 인터랙티브에서 프롬프트 하나 = omp 프로세스 하나라
// lastGateAt·브리핑 여부가 매 프롬프트 초기화됐다. 4프롬프트 세션에서 p2·p3 이 게이트를 15회
// 돌았는데 p4 가 "이 세션은 풀 검증을 한 번도 안 돌렸다"며 다시 막았다. 벤치 러너는 셀마다
// .omp/state 를 지우므로 셀은 영향을 받지 않는다.
const STATE_DIR = ".omp/state";
const STATE_FILE = `${STATE_DIR}/discipline.json`;
type Persisted = { briefedAt?: number; lastGateAt?: number; lastNoticeAt?: number };
function loadPersisted(): Persisted {
  try { return JSON.parse(readFileSync(STATE_FILE, "utf-8")) as Persisted; } catch { return {}; }
}
function savePersisted(patch: Persisted): void {
  try {
    const cur = loadPersisted();
    const next: Persisted = {
      briefedAt: Math.max(cur.briefedAt ?? 0, patch.briefedAt ?? 0) || undefined,
      lastGateAt: Math.max(cur.lastGateAt ?? 0, patch.lastGateAt ?? 0) || undefined,
      lastNoticeAt: Math.max(cur.lastNoticeAt ?? 0, patch.lastNoticeAt ?? 0) || undefined,
    };
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(next));
  } catch { /* 훅·확장은 절대 던지지 않는다 */ }
}

// 셸로 만든 파일도 변경이다 — 이 모델은 edit/write 대신 `cat > path <<'EOF'` 를 쓴다(실측: 한
// 프롬프트에서 11회). 집계에서 빠지면 변경 규모 기반 신호가 전부 어긋난다.
const SHELL_WRITE_RE = /(?:>>?|\btee\b\s+(?:-a\s+)?)\s*(["']?)([\w./@-]+\.[A-Za-z0-9]+)\1/g;
function shellWritePaths(cmd: string): string[] {
  const out: string[] = [];
  for (const m of cmd.matchAll(SHELL_WRITE_RE)) {
    const q = m[2];
    if (!q || /^\/dev\//.test(q) || /^\/tmp\//.test(q)) continue;
    out.push(q.replace(/^\.\//, ""));
  }
  return out;
}
const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const str = (x: any) => (typeof x === "string" ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })());
const contentText = (c: any): string => Array.isArray(c) ? c.map((x: any) => (x && typeof x.text === "string") ? x.text : "").join("\n") : (typeof c === "string" ? c : str(c));
const tokens = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9_]+/g) ?? []);
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
function failSig(content: string): string | null {
  const fails = (content.match(/^\s*(FAIL|ERROR|FAILED|Traceback|AssertionError)[:\s].*$/gim) ?? []).map(norm).sort();
  return fails.length ? fails.join(" | ") : null;
}
function isPolicyBlock(content: string): boolean {
  return /\bBlocked\b|use the .*? tool instead|instead of (cat|head|tail|grep|ls|sed|awk)|not (allowed|permitted)|requires approval|use `?(read|edit|write|grep)`? (tool )?instead/i.test(content);
}
function isMutating(toolName: string): boolean {
  return /^(write|edit|create|apply_patch|str_replace|bash|notebook)/i.test(toolName);
}
