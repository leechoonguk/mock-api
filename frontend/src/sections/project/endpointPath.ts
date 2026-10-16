/**
 * The rules an endpoint path obeys — one reading for the endpoint form and the
 * log panel's "save as mock", so both refuse what the server would.
 */

/** `PATH_MAX_LENGTH` in `app/schemas/endpoint.py`. */
export const PATH_MAX_LENGTH = 500

/** A `{name}` parameter segment — `matcher.py`'s own pattern. */
const PARAM_SEGMENT = /^\{[A-Za-z_][A-Za-z0-9_]*\}$/

/**
 * `pattern_problem` in `app/engine/matcher.py`, judged before the request: a
 * braced segment must be exactly `{name}`, and no name may appear twice.
 */
export function pathIsValid(path: string): boolean {
  const names = new Set<string>()
  for (const segment of path.split('/')) {
    if (!segment.includes('{') && !segment.includes('}')) continue
    if (!PARAM_SEGMENT.test(segment)) return false
    if (names.has(segment)) return false
    names.add(segment)
  }
  return true
}
