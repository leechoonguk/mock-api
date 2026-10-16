/**
 * Dormancy reporting — shared by the post hooks that sometimes have nothing to
 * assert.
 *
 * A check that asserted nothing must not print the PASS a compliant one does,
 * and it must say *why* it asserted nothing, because the two reasons it is
 * allowed are not alike (rule://omp-hooks, Dormancy):
 *
 * - `absent` — the feature the check guards is not in the code (no SSE
 *   endpoint, no `app/agent/` yet). True in every environment; nothing to fix.
 * - `service` — the check compares the code with a running service this
 *   environment does not have (the database, the OSV API). True in a clean
 *   clone such as the Jenkins workspace, and only there; the same check runs
 *   in full wherever the service is up.
 *
 * Nothing else is dormancy. A check that could not read the code it guards -
 * an import that failed, a manifest that did not parse - is broken, and says
 * so as an issue. Measured: the entity manifest failed to import the app in the
 * Jenkins clone (no `.env`), `check-backend-query` reported "dormant" and
 * passed, and the screens check beside it judged 67 list screens against a
 * router that seemed to take no parameter.
 */

/** Why a check asserted nothing - the only two reasons that are not a failure. */
export type DormantCause = "absent" | "service";

const reasons = new Map<string, string>();

/**
 * Records why a hook has nothing to assert and returns the empty issue list, so
 * a hook body reads `return dormant("check-backend-sse", "absent", "no SSE endpoint")`.
 */
export function dormant(hookName: string, cause: DormantCause, reason: string): string[] {
  reasons.set(hookName, `${cause}: ${reason}`);
  return [];
}

/** The recorded reason, or null when the hook actually checked something. */
export function dormancyReason(hookName: string): string | null {
  return reasons.get(hookName) ?? null;
}

/** `PASS` line for a CLI run: compliant and dormant must not look alike. */
export function passLine(hookName: string, compliantMessage: string): string {
  const reason = reasons.get(hookName);
  return reason === null || reason === undefined
    ? `    PASS: ${compliantMessage}`
    : `    PASS: ${compliantMessage} (dormant — ${reason})`;
}
