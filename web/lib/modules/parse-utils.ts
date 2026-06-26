/**
 * Parse a JSON array from Claude/Gemini output.
 *
 * Handles:
 * 1. Markdown code fence wrappers (```json ... ```)
 * 2. Multiple separate JSON arrays (Gemini sometimes outputs one array per
 *    category instead of a single flat array) — all are merged into one.
 * 3. Truncated output — recovers partial results by finding the last complete
 *    object and closing the array, rather than throwing on the whole response.
 */
export function parseClaudeJsonArray(raw: string): unknown[] {
  // Strip ALL code fences globally (Gemini wraps each array in its own fence)
  const clean = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim()

  // Try direct parse (single array — Claude's normal output)
  try {
    const parsed = JSON.parse(clean)
    if (Array.isArray(parsed)) return parsed
  } catch { /* truncated or malformed — attempt recovery */ }

  // Multi-array pass: Gemini often returns N separate arrays, one per category.
  // Walk the string, extract every top-level [...] block, merge into one array.
  const merged = extractAndMergeArrays(clean)
  if (merged !== null && merged.length > 0) return merged

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

/**
 * Walk `text` and extract every top-level JSON array [...].
 * Truncated arrays (unmatched brackets) are skipped rather than throwing.
 * Returns merged items, or null if nothing parseable was found.
 */
function extractAndMergeArrays(text: string): unknown[] | null {
  const results: unknown[] = []
  let i = 0

  while (i < text.length) {
    const start = text.indexOf('[', i)
    if (start === -1) break

    // Find the matching closing bracket using a depth counter
    let depth = 0
    let j = start
    let inString = false
    let escape = false

    while (j < text.length) {
      const ch = text[j]
      if (escape) { escape = false; j++; continue }
      if (ch === '\\' && inString) { escape = true; j++; continue }
      if (ch === '"') { inString = !inString; j++; continue }
      if (!inString) {
        if (ch === '[') depth++
        else if (ch === ']') { depth--; if (depth === 0) break }
      }
      j++
    }

    if (depth !== 0) { i = start + 1; continue } // unmatched — skip

    try {
      const parsed = JSON.parse(text.slice(start, j + 1))
      if (Array.isArray(parsed)) results.push(...parsed)
    } catch { /* not valid JSON — skip this block */ }

    i = j + 1
  }

  return results.length > 0 ? results : null
}
