/**
 * A body as a reader wants it: JSON indented, anything else as it came.
 *
 * Mock bodies and request bodies are text on the wire, and most of them are
 * JSON on one line. Indenting is presentation only — `null` says the text is
 * not JSON, so a caller can keep it verbatim or say why it could not format.
 */

const JSON_INDENT = 2

export function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, JSON_INDENT)
  } catch {
    return null
  }
}
