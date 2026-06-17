/**
 * Parse a JSON array from Claude output.
 *
 * Handles:
 * 1. Markdown code fence wrappers (```json ... ```)
 * 2. Truncated output — recovers partial results by finding the last complete
 *    object and closing the array, rather than throwing on the whole response.
 */
export function parseClaudeJsonArray(raw: string): unknown[] {
  const clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  // Try direct parse
  try {
    return JSON.parse(clean) as unknown[]
  } catch { /* truncated or malformed — attempt recovery */ }

  // Recovery pass 1: last `},` marks the end of a complete array item
  const lastItemEnd = clean.lastIndexOf('},')
  if (lastItemEnd !== -1) {
    try {
      return JSON.parse(clean.slice(0, lastItemEnd + 1) + ']') as unknown[]
    } catch { /* fall through */ }
  }

  // Recovery pass 2: last `}` as a final item with no trailing comma
  const lastClose = clean.lastIndexOf('}')
  if (lastClose !== -1) {
    try {
      return JSON.parse(clean.slice(0, lastClose + 1) + ']') as unknown[]
    } catch { /* fall through */ }
  }

  throw new Error(clean.slice(0, 300))
}
