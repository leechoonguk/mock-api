import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

/**
 * Strict-Command-Routing Pre Hook
 *
 * All commands that have a `make` target must use `make <target>`.
 * Direct tool invocations (ruff, pytest, pyright, npx, docker-compose)
 * and port killing are blocked.
 *
 * A full gate (`make verify`, `make test`) additionally may not have its output
 * truncated by a pipe. Two separate failures come from the same shape:
 * `make verify | tail` returns **tail's** exit code, so a red gate reads green;
 * and the session's own finish gate refuses to count a truncated run as a
 * verification, so the model is asked to verify again after every answer. That
 * is a measured loop — six `make verify | tail` runs in one session, each one
 * green, each one followed by the same "run make verify" notice.
 *
 * Denylist patterns are anchored to a command boundary (line start, or after
 * `&&` / `||` / `;` / `|` / `(`, with optional `sudo`). A binary path used as
 * an argument — e.g. `ls backend/.venv/bin/ruff` — is NOT an invocation and
 * is not blocked.
 *
 * To add/remove rules: modify the denylist array. No other logic changes needed.
 */

/**
 * A project-root full gate. `-fast` variants are excluded for the same reason
 * `continuity/discipline.ts` excludes them: they are a subset, not the gate.
 */
const FULL_GATE = /\bmake\b[^|;&]*\b(?:verify|test)\b(?!-fast)/;

/** The filters that drop a gate's lines and its exit code with them. */
const GATE_TRUNCATION = /\|\s*(?:tail|head|grep|sed|awk|wc)\b/;

export default function strictCommandRouting(pi: ExtensionAPI): void {
  pi.on("tool_call", (event: { toolName?: string; input?: Record<string, unknown> }) => {
    // 실행 채널은 셋이다: bash, eval(파이썬/JS 본문에서 subprocess.run·execSync), hub(op:start).
    // bash 만 보면 전수 점검 기준 32% 가 샌다(차단 185 vs 우회 87).
    const tool = String(event.toolName ?? "");
    if (!/^(bash|eval)$/.test(tool)) return;

    const cmd = String((event.input as any)?.command ?? (event.input as any)?.code ?? "");

    // eval 본문에서는 라우팅 대상이 인용부호 안에 들어간다(`subprocess.run(["pytest", …])`) — 셸용
    // 패턴이 못 잡는다. 전수 점검: eval 로 85건/25세션이 우회했다. 실행 함수 + 대상 도구가
    // 같은 본문에 있으면 막고, 셸과 같은 안내(make 타깃)를 준다.
    if (tool === "eval") {
      const runner = /\b(subprocess\.(?:run|call|check_output|Popen)|execSync|spawnSync|os\.system)\b/;
      const routed = /\b(pytest|ruff|pyright|alembic|npm|npx|docker[-\s]compose)\b/;
      if (runner.test(cmd) && routed.test(cmd)) {
        return {
          block: true,
          reason:
            "도구를 eval 본문에서 직접 실행하지 않는다 — 셸에서 막히는 것과 같은 우회다. " +
            "프로젝트의 make 타깃을 쓰세요(`make verify`, `make test-fast t=\"tests/...\"`, `make lint`, `make migrate-gen m=\"...\"`).",
        };
      }
    }

    // --- Full gate: never truncated ---
    // 허용목록보다 먼저다. `make verify | tail` 은 `make ` 로 시작하므로 아래 allowlist 가
    // 그대로 통과시켰고, 그래서 이 두 실패가 같은 세션에서 동시에 일어났다: 파이프의
    // 종료코드가 게이트의 것을 덮어 빨간 게이트가 초록으로 읽히고, 마감 게이트는 잘린
    // 실행을 검증으로 세지 않아 답변마다 "make verify 를 돌려라" 를 되풀이한다.
    if (FULL_GATE.test(cmd) && GATE_TRUNCATION.test(cmd)) {
      return {
        block: true,
        reason:
          "게이트 출력을 파이프로 자르지 않는다 — `make verify | tail` 은 tail 의 종료코드를 " +
          "돌려주므로 빨간 게이트가 초록으로 보이고, 세션의 마감 게이트도 잘린 실행을 " +
          "검증으로 세지 않아 같은 요구가 반복된다.\n\n  → `make verify` 를 그대로 실행하세요" +
          "(출력이 길면 결과가 artifact 로 남는다).",
      };
    }

    // --- Allowlist ---
    if (cmd.startsWith("make ")) return;

    // --- Denylist (patterns anchored to a command boundary) ---
    for (const rule of denylist) {
      if (rule.pattern.test(cmd)) {
        return {
          block: true,
          reason: `\`${rule.desc}\` — 직접 실행 금지\n\nmake 타겟을 사용하세요:\n  → \`${rule.target}\``,
        };
      }
    }
  });
}

/**
 * Anchors the given binary name to a command boundary (start or after `&&`, `||`, `;`, `|`, `(`, optional `sudo`).
 * Allows whitespace-free relative-path prefixes (`backend/`, `./`, `repo/pkg/`), but never an argument word —
 * e.g. `ls backend/.venv/bin/ruff` stays unblocked because `ls ` (with space) cannot be part of the prefix.
 */
const atCmdStart = (bin: string) => `(?:^|[&|;()]\\s*)(?:sudo\\s+)?(?:[^\\s&|;()]+/)*${bin}\\b`;

const denylist: Array<{
  desc: string;
  pattern: RegExp;
  target: string;
}> = [
  {
    desc: "Alembic 직접 실행",
    pattern: new RegExp(`${atCmdStart("\\.venv/bin/alembic")}(?:\\s|$)`),
    target: "make migrate",
  },
  {
    // ruff 자동수정·포맷터가 alembic 을 건드리면 기존 마이그레이션 37개가 통째로
    // 재서식된다(실측, +2256/-2413 순수 포맷 처닝). 마이그레이션은 불변.
    desc: "Ruff 자동수정/포맷을 alembic 에 실행",
    pattern: /\bruff\b[^|;&]*(?:--fix|\bformat\b)[^|;&]*\balembic\b|\bruff\b[^|;&]*\balembic\b[^|;&]*(?:--fix|\bformat\b)/,
    target: "make fix (app/tests 한정)",
  },
  {
    // 실측: `python` not found → which python3 → 상대 .venv 경로 실패 →
    // 절대경로, 0.5m 우회. 어포던스는 있으므로 라우팅으로 바로 안내한다.
    desc: "bare python/pytest 직접 실행",
    // bare 는 경로 없는 호출만이다. atCmdStart 의 경로 접두를 쓰면 `backend/.venv/bin/python -c` 까지
    // 걸려, **이 규칙의 안내문이 권하는 바로 그 명령**을 자기가 막는다(전수 점검: 17건/10세션).
    // `.venv/bin/pytest` 도 여기서 먼저 걸려 아래 전용 규칙의 올바른 안내를 못 받았다(55건).
    pattern: /(?:^|[&|;()\n]\s*)(?:sudo\s+)?(?:python3?|pytest)\b(?:\s|$)/,
    target: 'make test-fast t="..." (단발 파이썬은 backend/.venv/bin/python 절대경로)',
  },
  {
    desc: "Pytest 직접 실행",
    pattern: new RegExp(`${atCmdStart("\\.venv/bin/pytest")}(?:\\s|$)`),
    target: "make test",
  },
  {
    desc: "Ruff 직접 실행",
    pattern: new RegExp(`${atCmdStart("\\.venv/bin/ruff")}(?:\\s|$)`),
    target: "make lint",
  },
  {
    desc: "Pyright 직접 실행",
    pattern: new RegExp(`${atCmdStart("\\.venv/bin/pyright")}(?:\\s|$)`),
    target: "make typecheck",
  },
  {
    desc: "Script 직접 실행",
    pattern: new RegExp(`${atCmdStart("(?:npx|bash|sh)")}\\s+\\S*scripts/`),
    target: "make <target>",
  },
  {
    desc: "npx tool 직접 실행",
    pattern: new RegExp(`${atCmdStart("npx")}\\s+(?:vite|eslint|tsc)\\b`),
    target: "make <target>",
  },
  {
    desc: "Docker compose 직접 실행",
    pattern: new RegExp(`${atCmdStart("docker")}\\s+compose\\b`),
    target: "make <target>",
  },
  {
    desc: "포트 killing",
    pattern: new RegExp(`${atCmdStart("lsof")}\\s+-ti:\\d+\\s*\\|\\s*xargs\\s+kill\\b`),
    target: "make down",
  },
];
