import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { writtenPaths } from "../lib/hook-tool-paths.ts";
import { SRC_LAYOUT, sourceFileViolation } from "../lib/frontend-source.ts";

/**
 * Strict-Frontend-App-Structure Pre Hook
 *
 * The frontend twin of `strict-backend-app-structure`: a file may only be
 * created inside the declared `frontend/src/` layout. The declaration is
 * `SRC_LAYOUT` in `lib/frontend-source.ts` — the same module every frontend
 * scan reads its directories from, so the gate cannot drift from what the
 * checks assume.
 *
 * Until this hook existed nothing refused `frontend/src/adapters/x.ts`: the
 * recursive scans would still *see* such a file (unlike the backend, where a
 * flat scan went blind), but every convention keyed on directory role —
 * sections are screens, lib/api is the transport, pages are thin — silently
 * fails to apply to a directory no rule names.
 *
 * Only creation under `frontend/src/` is gated. Files outside `src/` (configs,
 * `package.json`, `nginx.conf`) have their own owners.
 */
export default function strictFrontendAppStructure(pi: ExtensionAPI): void {
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
 * Exported for direct execution: a pre-hook edit binds from the next session,
 * so the logic is proven by running this function, not by the gate that loaded
 * before it existed.
 */
export function structureViolation(path: string): { block: true; reason: string } | null {
  const inside = path.match(/(?:^|\/)frontend\/src\/([^/]+)(\/)?(.*)$/);
  if (inside === null) return null;

  const [, name, isDirectory, rest] = inside;
  if (isDirectory !== undefined) {
    if (SRC_LAYOUT.directories[name] !== undefined) {
      const misnamed = sourceFileViolation(`${name}/${rest}`);
      return misnamed === null ? null : { block: true, reason: `\`frontend/src/${name}/${rest}\` — ${misnamed}` };
    }
    return {
      block: true,
      reason:
        `\`frontend/src/${name}/\` — src/ 하위에 새 디렉토리 생성 금지\n\n` +
        `선언된 구조만 사용하세요 (lib/frontend-source.ts SRC_LAYOUT):\n` +
        `  ${Object.keys(SRC_LAYOUT.directories).join(", ")}`,
    };
  }

  if (SRC_LAYOUT.rootFiles[name] !== undefined) return null;
  return {
    block: true,
    reason:
      `\`frontend/src/${name}\` — src 루트에는 선언된 파일만 허용\n\n` +
      `  ${Object.keys(SRC_LAYOUT.rootFiles).join(", ")}\n\n` +
      `모듈은 표준 디렉토리 안에 두세요.`,
  };
}
