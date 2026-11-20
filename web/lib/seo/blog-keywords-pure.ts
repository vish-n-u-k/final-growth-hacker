// Pure helpers for the blog_keywords tool (lib/seo/blog-keywords.ts): word matching, trend labels,
// topic groups, page matching, keyword placement and format guesses. No I/O, so they can be tested.

const STOP = new Set(('a an and are as at be best by can do does for free from get how i in is it my of on or ' +
  'the to top what when where which who why will with you your vs versus').split(' '))

/** Lower-case words of a keyword or text, stop words dropped, plural "s" trimmed. */
export function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(w => (w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
}

const overlap = (a: string[], b: string[]) => { const s = new Set(b); return [...new Set(a)].filter(w => s.has(w)).length }

// ── Trend from 12 months of searches ───────────────────────────────────────────

export interface Month { year: number; month: number; search_volume: number | null }
export interface Trend { label: 'rising' | 'falling' | 'steady' | 'seasonal' | 'unknown'; last_3_avg: number | null; previous_3_avg: number | null; peak_month: string | null }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function trendOf(monthly: Month[] | null | undefined): Trend {
  const m = (monthly ?? []).filter(x => typeof x.search_volume === 'number')
    .sort((a, b) => (b.year - a.year) || (b.month - a.month)) // newest first
  if (m.length < 6) return { label: 'unknown', last_3_avg: null, previous_3_avg: null, peak_month: null }
  const avg = (xs: Month[]) => Math.round(xs.reduce((s, x) => s + (x.search_volume ?? 0), 0) / xs.length)
  const last = avg(m.slice(0, 3)), prev = avg(m.slice(3, 6))
  const all = m.slice(0, 12)
  const peak = all.reduce((p, x) => ((x.search_volume ?? 0) > (p.search_volume ?? 0) ? x : p), all[0])
  const mean = avg(all)
  const seasonal = mean > 0 && (peak.search_volume ?? 0) >= mean * 2.5
  const change = prev > 0 ? (last - prev) / prev : last > 0 ? 1 : 0
  const label = seasonal ? 'seasonal' : change > 0.2 ? 'rising' : change < -0.2 ? 'falling' : 'steady'
  return { label, last_3_avg: last, previous_3_avg: prev, peak_month: `${MONTHS[peak.month - 1]} ${peak.year}` }
}

// ── Questions ────────────────────────────────────────────────────────────────

const QUESTION = /^(how|what|why|which|when|where|who|can|could|is|are|do|does|should|will|best way)\b/i
export const isQuestion = (k: string) => QUESTION.test(k.trim()) || k.includes('?')

// ── Topic groups ─────────────────────────────────────────────────────────────

export interface KwIn { keyword: string; volume: number }
export interface Group<T extends KwIn> { main: T; keywords: T[]; words: string[] }

/**
 * Groups keywords that share their main words, biggest first. A keyword joins the first group whose
 * main keyword shares 2+ words with it (or all its words, for 1–2 word keywords); otherwise it starts
 * a new group.
 */
export function groupKeywords<T extends KwIn>(list: T[]): Group<T>[] {
  // Words in most of the list ("social", "media" for a social media tool) say nothing about the
  // topic, so a keyword must also share a rarer word to join a group
  const df = new Map<string, number>()
  for (const k of list) for (const w of new Set(tokens(k.keyword))) df.set(w, (df.get(w) ?? 0) + 1)
  const common = new Set(list.length >= 5 ? [...df].filter(([, n]) => n / list.length > 0.5).map(([w]) => w) : [])
  const groups: Group<T>[] = []
  for (const k of [...list].sort((a, b) => b.volume - a.volume)) {
    const t = tokens(k.keyword)
    if (!t.length) continue
    const g = groups.find(g => {
      const o = overlap(t, g.words)
      const rare = overlap(t.filter(w => !common.has(w)), g.words)
      if (rare < 1 && t.some(w => !common.has(w)) && g.words.some(w => !common.has(w))) return false
      return o >= 2 || (o >= 1 && (t.length <= 2 || g.words.length <= 2) && o >= Math.min(t.length, g.words.length))
    })
    if (g) g.keywords.push(k)
    else groups.push({ main: k, keywords: [k], words: tokens(k.keyword) })
  }
  return groups
}

// ── Matching a topic to the site's pages ──────────────────────────────────────

export interface SitePageLite { url: string; title?: string; h1?: string }

/** Words in a URL's path ("/blog/how-to-automate-social-media-posts-free/" → automate, social, media, post). */
export const slugWords = (url: string) => { try { return tokens(decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, ' ')) } catch { return [] } }

/** The site page that fits these words best (2+ shared words), or null = a new post. */
export function bestPage(words: string[], pages: SitePageLite[]): { url: string; shared: number } | null {
  let best: { url: string; shared: number } | null = null
  for (const p of pages) {
    const pw = [...new Set([...slugWords(p.url), ...tokens(p.title ?? ''), ...tokens(p.h1 ?? '')])]
    const shared = overlap(words, pw)
    // Most of the topic's words must be on the page, not just the generic ones ("social media")
    if (shared >= 2 && shared >= Math.ceil(new Set(words).size * 0.6) && (!best || shared > best.shared)) best = { url: p.url, shared }
  }
  return best
}

// ── Keyword placement on a page ───────────────────────────────────────────────

export interface PageFacts {
  url: string
  title: string
  meta: string
  h1: string[]
  h2: string[]
  h3: string[]
  words: number
  first_100_words: string
  image_alts: string[]
  images_without_alt: number
  internal_links: string[]
  text: string                 // body text, for mentions (kept server-side)
  error?: string
}

export type Hit = 'exact' | 'all words' | 'missing'

function hitIn(text: string, keyword: string): Hit {
  const t = text.toLowerCase()
  if (t.includes(keyword.toLowerCase())) return 'exact'
  const kw = tokens(keyword)
  const tw = new Set(tokens(text))
  return kw.length && kw.every(w => tw.has(w)) ? 'all words' : 'missing'
}

export interface PlacementCheck { place: string; found: Hit; tip?: string }

export function placement(p: PageFacts, keyword: string, typicalWords: number | null): { checks: PlacementCheck[]; score: number; mentions: number; words: number; typical_words: number | null } {
  const slug = slugWords(p.url).join(' ')
  const places: [string, string, string][] = [
    ['Title tag', p.title, 'Put the keyword near the start of the title (under 60 characters).'],
    ['Meta description', p.meta, 'Use the keyword once in a 140–160 character description that makes people click.'],
    ['H1', p.h1.join(' '), 'The main heading should say the keyword, in natural words.'],
    ['A sub-heading (H2/H3)', [...p.h2, ...p.h3].join(' | '), 'Use the keyword (or a close version) in at least one sub-heading.'],
    ['First 100 words', p.first_100_words, 'Say the keyword in the first paragraph.'],
    ['URL', slug, 'The page address should hold the main words (only change it with a redirect).'],
    ['Image alt text', p.image_alts.join(' | '), 'Describe one image with the keyword in its alt text.'],
  ]
  const checks = places.map(([place, text, tip]) => {
    const found = hitIn(text, keyword)
    return { place, found, ...(found === 'missing' ? { tip } : {}) }
  })
  const mentions = (p.text.toLowerCase().match(new RegExp(keyword.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
  const score = Math.round((checks.reduce((s, c) => s + (c.found === 'exact' ? 1 : c.found === 'all words' ? 0.6 : 0), 0) / checks.length) * 100)
  return { checks, score, mentions, words: p.words, typical_words: typicalWords }
}

// ── Format of a ranking page ──────────────────────────────────────────────────

export function formatOf(p: { title: string; h2: string[] }): string {
  const t = p.title.toLowerCase()
  const numbered = p.h2.filter(h => /^\s*\d+[.)\s]/.test(h)).length
  if (/\bvs\.?\b|versus|alternative|compare|comparison/.test(t)) return 'comparison'
  if (/^\s*\d+\s|\btop\s*\d+|\bbest\b/.test(t) || numbered >= 3) return 'list'
  if (/^how to|\bhow to\b|\bstep|guide to|tutorial/.test(t)) return 'how-to guide'
  if (/^what (is|are)\b|meaning|definition/.test(t)) return 'explainer'
  if (/template|example|ideas/.test(t)) return 'examples / templates'
  return 'article'
}

// ── Internal link suggestions ─────────────────────────────────────────────────

/** A sentence in the page's text that mentions the topic, to put the link on. */
export function anchorIn(text: string, words: string[]): string | null {
  const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.length > 30 && s.length < 260)
  let best: { s: string; n: number } | null = null
  for (const s of sentences) {
    const n = overlap(tokens(s), words)
    if (n >= Math.min(2, words.length) && (!best || n > best.n)) best = { s, n }
  }
  return best?.s ?? null
}

export const pathOf = (u: string) => { try { const x = new URL(u, 'https://site.invalid'); return x.pathname.replace(/\/+$/, '') || '/' } catch { return u } }
export const samePage = (a: string, b: string) => pathOf(a).toLowerCase() === pathOf(b).toLowerCase()
