/**
 * 도메인이 어디까지 섰는지만 답한다 — 정책은 없다.
 *
 * 요구 방향 계약(omp-hooks.md, Demand direction)을 여러 검사가 각자 구현하면 같은 질문에 서로 다른
 * 답을 낸다. 실측 감사에서 이미 세 갈래로 갈리고 있었다: 도메인 구조 검사는
 * `existsSync(routers/x.py)`, api-http 검사는 `include_router` 정규식, 테스트 검사는 앵커 자체가 없었다.
 * 그래서 "완성"의 정의를 한 곳에 둔다.
 */
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readFileSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";

export type Layer = "model" | "schema" | "repository" | "service" | "router";

const DIR: Record<Layer, string> = {
  model: "models", schema: "schemas", repository: "repositories", service: "services", router: "routers",
};

/** `backend/app` 의 절대 경로. 검사들이 제각기 계산하던 것을 한 번만 만든다. */
export function appDir(projectRoot: string): string {
  return join(projectRoot, "backend", "app");
}

/** 도메인 `name` 의 해당 계층 파일이 있는가. */
export function hasLayer(projectRoot: string, layer: Layer, name: string): boolean {
  return existsSync(join(appDir(projectRoot), DIR[layer], `${name}.py`));
}

/**
 * 라우터가 `main.py` 에 실제로 마운트됐는가 — 도메인이 응답하기 시작하는 시점.
 * 두 형태를 모두 인정한다: `app.include_router(x.router)` 와 `api_router.include_router(x.router)`.
 */
export function isMounted(projectRoot: string, name: string): boolean {
  const mainPy = join(appDir(projectRoot), "main.py");
  if (!existsSync(mainPy)) return false;
  try {
    return new RegExp(`include_router\\(\\s*${name}\\.router`).test(readFileSync(mainPy, "utf-8"));
  } catch { return false; }
}
