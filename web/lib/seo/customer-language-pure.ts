// Pure helpers for the customer_language tool (lib/seo/customer-language.ts): which searches read
// like a buyer describing a problem, checking that quotes are real, and month-on-month changes.
// No I/O, so they can be tested.

import { isQuestion, tokens } from './blog-keywords-pure'

/** A Google search that reads like someone describing a problem (a question, or 4+ words), not a brand or operator search. */
export function isProblemSearch(q: string, isBrand: (k: string) => boolean): boolean {
  const s = q.trim().toLowerCase()
  if (!s || /\b(site|inurl|intitle|related):/.test(s) || isBrand(s)) return false
  return isQuestion(s) || s.split(/\s+/).length >= 4
}

const norm = (s: string) => s.toLowerCase().replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9'"]+/g, ' ').trim()

/**
 * True when the quote really appears in what was collected (case, punctuation and spacing ignored).
 * A quote cut with "…" counts when each of its parts appears.
 */
export function quoteIsReal(quote: string, corpus: string): boolean {
  const c = norm(corpus)
  const parts = quote.split(/\.\.\.|…/).map(norm).filter(p => p.length >= 8)
  return parts.length > 0 && parts.every(p => c.includes(p))
}

/** A phrase's key for comparing months: its main words, sorted. */
export const phraseKey = (p: string) => [...new Set(tokens(p))].sort().join(' ')

export interface MonthPhrase { phrase: string; count: number; problem: string }
export interface Changes { new: MonthPhrase[]; growing: (MonthPhrase & { before: number })[]; fading: (MonthPhrase & { now: number })[] }

/** New, growing (2+ more and at least 1.5×) and fading (half or less) phrases vs the last saved month. */
export function compareMonths(now: MonthPhrase[], before: MonthPhrase[] | null): Changes | null {
  if (!before) return null
  const prev = new Map(before.map(p => [phraseKey(p.phrase), p]))
  const cur = new Map(now.map(p => [phraseKey(p.phrase), p]))
  const out: Changes = { new: [], growing: [], fading: [] }
  for (const [k, p] of cur) {
    const b = prev.get(k)
    if (!b) out.new.push(p)
    else if (p.count >= b.count + 2 && p.count >= b.count * 1.5) out.growing.push({ ...p, before: b.count })
  }
  for (const [k, b] of prev) {
    const p = cur.get(k)
    if (b.count >= 2 && (!p || p.count <= b.count / 2)) out.fading.push({ ...b, now: p?.count ?? 0 })
  }
  return out
}

/** Words buyers use (from the phrases) that the site's own wording never says. */
export function wordsMissing(phrases: string[], siteText: string): string[] {
  const site = new Set(tokens(siteText))
  const counts = new Map<string, number>()
  for (const p of phrases) for (const w of new Set(tokens(p))) if (!site.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1)
  return [...counts].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).map(([w]) => w).slice(0, 20)
}
