import { writtenPaths } from "../lib/hook-tool-paths.ts";
import { APP_LAYERS, layerDepthViolation, layoutViolation } from "../lib/backend-layout.ts";

/**
 * Strict-Backend-App-Structure Pre Hook
 *
 * Enforces the documented backend folder structure (backend-layout.md):
 * files may only be created inside recognized locations. Anything else —
 * a new directory under backend/, or a stray file outside the structure —
 * is blocked at write/edit time.
 *
 * Recognized locations:
 *   - backend/app/<allowedDir>/...  (the layers `lib/backend-layout.ts`
 *     declares in `APP_LAYERS`)
 *   - backend/app/main.py, backend/app/__init__.py (app root files only)
 *   - backend/tests/, backend/alembic/, backend/scripts/ (standard backend dirs)
 *
 * Blocked:
 *   - backend/app/<unknownDir>/...     — new directory under app/ (e.g. adapters/)
 *   - backend/app/<stray>.py           — loose file at app root (only main.py
 *     and __init__.py are allowed)
 *   - backend/<unknownDir>/...         — new directory under backend/ outside the
 *     standard set (e.g. backend/api/, backend/workers/)
 *
 * To add/remove directories: edit the allowlists below. No other logic changes.
 */
const allowedBackendDirs: Record<string, true> = {
  app: true,
  tests: true,
  alembic: true,
  scripts: true,
};

const allowedAppRootFiles: Record<string, true> = {
  "main.py": true,
  "__init__.py": true,
};

export default function strictBackendAppStructure(pi: ExtensionAPI): void {
  pi.on("tool_call", (event: { toolName: string; input: Record<string, unknown> }, _ctx: unknown) => {
    for (const path of writtenPaths(event.toolName, event.input)) {
      const blocked = structureViolation(path);
      if (blocked !== null) return blocked;
    }
  });
}

/**
 * The structure decision for one path, or null when it is allowed.
 *
 * Split out of the handler so both payload shapes reach the same rules: `write`
 * carries one `path`, `edit` names its files inside the patch, and reading only
 * `input.path` let every `edit` through (measured).
 */
function structureViolation(path: string): { block: true; reason: string } | null {
  // backend/app/<subdir>/... — known app subdirectories only.
  // The directory set and each layer's depth come from one declaration
  // (`lib/backend-layout.ts`) — the same one the read-side traversal and the
  // hook meta-check derive from, so the write gate cannot drift from what the
  // scans assume. Before the depth rule, `routers/sub/x.py` passed this gate
  // and would then have been seen by no router scan at all.
  const appMatch = path.match(/(?:^|\/)backend\/app\/([^/]+\/.*)$/)
  if (appMatch) {
    const appRelative = appMatch[1]
    const subdir = appRelative.split("/")[0]
    if (APP_LAYERS[subdir] === undefined) {
      return {
        block: true,
        reason: `\`${subdir}\` — backend/app/ 하위에 새 디렉토리 생성 금지\n\n기존 구조만 사용하세요:\n  ${Object.keys(APP_LAYERS).join(", ")}`,
      }
    }
    const depth = layerDepthViolation(appRelative)
    if (depth !== null) {
      return { block: true, reason: `\`backend/app/${appRelative}\` — ${depth}` }
    }
    const layout = layoutViolation(appRelative)
    if (layout !== null) {
      return { block: true, reason: `\`backend/app/${appRelative}\` — ${layout}` }
    }
    return null
  }

  // backend/app/<file> — only main.py and __init__.py live at the app root.
  const appFileMatch = path.match(/(?:^|\/)backend\/app\/([^/]+)$/)
  if (appFileMatch) {
    const file = appFileMatch[1]
    if (!allowedAppRootFiles[file]) {
      return {
        block: true,
        reason: `\`backend/app/${file}\` — app 루트에는 main.py와 __init__.py만 허용\n\n모듈은 표준 디렉토리 안에 두세요:\n  ${Object.keys(APP_LAYERS).join(", ")}`,
      }
    }
    return null
  }

  // backend/<subdir>/... — standard backend directories only.
  const backendMatch = path.match(/(?:^|\/)backend\/([^/]+)\//)
  if (backendMatch) {
    const subdir = backendMatch[1]
    if (!allowedBackendDirs[subdir]) {
      return {
        block: true,
        reason: `\`backend/${subdir}\` — backend/ 하위 비표준 위치 생성 금지\n\n인정 위치만 사용하세요:\n  app, tests, alembic, scripts\n\n(.http 파일은 저장소 루트 api/ 디렉토리)`,
      }
    }
  }

  return null
}
