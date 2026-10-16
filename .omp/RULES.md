# Sticky Rules

## Session Safety

Never modify `AGENTS.md` or any `.omp/` file without explicit user request.
Never commit or push unless the user explicitly asks in the current turn. This
one is mechanical, not advisory: `strict-publish-consent.ts` reads the session's
own entries and blocks the command. Publish with `make commit m="…"` and
`make push`, which run `make verify` first.

## Harness Integrity

When modifying the harness (`.omp/` files, hooks, rules, MCP/LSP config), always reference OMP official documentation (`omp://`) first. The harness is the backbone of your development workflow — changes here affect every session. Read `omp://` docs (settings, hooks, rules, tools, SDK) to understand current behavior before touching anything. Never guess how the harness works; verify against the official guide.

## Workflow

Before creating or editing files in an area, read that area's rulebook entries
via `rule://<name>` — they are listed in the system prompt with their globs.
Discovering requirements up front is faster than rediscovering them one verify
failure at a time. When a verify failure names a rule area, read that rule
before retrying.

Keep the todo list stateful while debugging: after each verification run, record
which check is failing and the next single step — it is the task's memory across
context resets and compactions.

An additive task must not wipe existing code: prefer targeted edits over
full-file rewrites of existing files, and never truncate a file with `>`.
Never replace an existing import line with yours — add it alongside; existing
imports register models and behavior other code depends on. Never strip an
existing `with`/`try` wrapper while keeping the code it wraps.

Run the verification after wiring each layer or file group, not only at the
end — failures discovered early are cheaper than one pile at the finish.
Before declaring work done, run `make verify` once more and confirm it is green.

## Working pattern

- 프로젝트 루트에서 전체 검증을 돌린다. 하위 디렉터리(`backend/`, `frontend/`) 안에서 돌린 게이트는 그것이 아니다 —
  루트에만 있는 검사가 배선·요청 파일·레이아웃을 본다.
- 한 계층이 서면 그 계층의 테스트를 곧바로 쓴다. 끝에 몰아서 쓰지 않는다.
- 마이그레이션은 프로젝트의 생성 명령으로만, 실제 메시지를 붙여 만든다.
- 배선 파일(import·라우터 등록·DI 별칭)에 이미 다른 항목이 있으면 **나란히 추가**한다. 기존 줄을 교체하지 않는다.
- 게이트 출력을 `head`/`tail`/`grep` 으로 자르지 않는다. 파이프는 파이프의 종료코드를 돌려주므로 빨간 게이트가
  초록으로 보인다.
- 검증을 언제 처음 돌리느냐보다 **어떤 순서로 쌓느냐**가 결과를 가른다. 시계를 보지 말고 계층 단위로 확인한다.
