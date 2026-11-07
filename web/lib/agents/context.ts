// Shared helpers for the AI Agents: what the agents know about the brand, JSON parsing of model
// output, and turning a plain-text email into the HTML Gmail sends.

import { createHash } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brands, brainContext, competitors, modules } from '@/lib/db/schema'

export interface BrandContext {
  id: string
  name: string
  websiteUrl: string
  domain: string
  usp: string | null
  targetAudience: string | null
  keywords: string | null
  websiteType: string | null
  summary: string | null
  limitations: string | null
  competitors: { name: string; domain: string }[]
}

export const domainOf = (url: string | null | undefined): string =>
  (url ?? '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0].toLowerCase()

/**
 * Competitors set up on the Competitor Analysis and GEO modules. Competitor Analysis only saves
 * competitors the user typed in to the competitors table; a list it suggested (and GEO's) lives in
 * the module's setup (competitor_urls, names in achievable_competitors). Read with the table, so
 * the agents and MCP always know the rivals the modules compare against.
 */
export async function moduleCompetitors(brandId: string): Promise<{ url: string; name: string | null; why: string | null; module: string }[]> {
  const setups = await db.select({ type: modules.type, requirements: modules.requirements })
    .from(modules).where(and(eq(modules.brandId, brandId), inArray(modules.type, ['competitor-analysis', 'geo']))).catch(() => [])
  const out: { url: string; name: string | null; why: string | null; module: string }[] = []
  for (const type of ['competitor-analysis', 'geo']) {
    const req = (setups.find(m => m.type === type)?.requirements as Record<string, string> | null) ?? {}
    let named: { name?: string; url?: string; why?: string }[] = []
    try { named = JSON.parse(req.achievable_competitors || '[]') } catch { /* no names cached */ }
    for (const url of (req.competitor_urls ?? '').split(/[,\n]/).map(u => u.trim()).filter(Boolean)) {
      const a = named.find(x => x.url && domainOf(x.url) === domainOf(url))
      out.push({ url, name: a?.name ?? null, why: a?.why ?? null, module: type })
    }
  }
  return out
}

export async function loadBrandContext(brandId: string): Promise<BrandContext | null> {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!brand) return null
  const [brain] = await db.select({ summary: brainContext.summary, limitations: brainContext.limitations })
    .from(brainContext).where(eq(brainContext.brandId, brandId)).limit(1).catch(() => [])
  const comps: { name: string | null; url: string }[] = await db.select({ name: competitors.name, url: competitors.url })
    .from(competitors).where(eq(competitors.brandId, brandId)).catch(() => [])
  comps.push(...(await moduleCompetitors(brandId)))
  const own = domainOf(brand.websiteUrl)
  const seen = new Set<string>()
  const list: BrandContext['competitors'] = []
  for (const c of comps) {
    const d = domainOf(c.url)
    if (!d || d === own || seen.has(d)) continue
    seen.add(d)
    const label = d.split('.')[0]
    list.push({ name: c.name || label.charAt(0).toUpperCase() + label.slice(1), domain: d })
  }
  return {
    id: brand.id,
    name: brand.name,
    websiteUrl: brand.websiteUrl,
    domain: own,
    usp: brand.usp,
    targetAudience: brand.targetAudience,
    keywords: brand.keywords,
    websiteType: brand.websiteType,
    summary: brain?.summary ?? null,
    limitations: brain?.limitations ?? null,
    competitors: list.slice(0, 6),
  }
}

// Platforms nobody pitches: social networks, search engines, app stores, hosting, link shorteners
export const PLATFORM = /(^|\.)(google|youtube|facebook|instagram|linkedin|twitter|x|tiktok|pinterest|reddit|wikipedia|medium|github|apple|microsoft|amazon|quora|wordpress|blogspot|yahoo|bing|t|bit|threads|snapchat|whatsapp|spotify|yandex|ya|baidu|duckduckgo|tinyurl|rebrand|ow|buff|lnkd|linktr|cutt|is)\.[a-z.]+$/

/**
 * A rival's own site: its domain, any subdomain of it (blog.hootsuite.com), or a hosted page named
 * after it (predis.crisp.help, buffer.zendesk.com).
 */
export function isRivalSite(domain: string, rivals: { domain: string }[]): boolean {
  const labels = domain.split('.')
  const sub = new Set(labels.slice(0, -2))
  return rivals.some(r => {
    if (domain === r.domain || domain.endsWith(`.${r.domain}`)) return true
    const name = r.domain.split('.')[0]
    return name.length >= 4 && sub.has(name)
  })
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
/** The site's own name: blog.hootsuite.com → hootsuite, example.co.uk → example. */
export function siteLabel(domain: string): string {
  const parts = domain.split('.')
  const i = parts.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(parts[parts.length - 2]) ? parts.length - 3 : parts.length - 2
  return parts[Math.max(0, i)] ?? domain
}
/**
 * Products AI answers recommend as options like the brand (in 2+ answers, so one stray mention
 * doesn't count): rivals even when they aren't in the saved competitor list (Hootsuite, SocialBee).
 */
export function namedRivals(answers: { brands: string[]; others?: string[] }[], brand: string): Set<string> {
  const n = new Map<string, number>()
  for (const a of answers) for (const name of new Set([...a.brands, ...(a.others ?? [])].map(squash))) if (name.length >= 3) n.set(name, (n.get(name) ?? 0) + 1)
  n.delete(squash(brand))
  // "Predis.ai" / "Later App" should match predis.ai / later.com, so the suffix is dropped too
  return new Set([...n].filter(([, c]) => c >= 2).flatMap(([k]) => [k, k.replace(/(ai|app|hq|io)$/, '')]).filter(k => k.length >= 3))
}
export const isNamedRival = (domain: string, named: Set<string>) => named.has(squash(siteLabel(domain)))

/** A short "about us" block for prompts. */
export function brandBlock(b: BrandContext): string {
  return [
    `Brand: ${b.name} (${b.websiteUrl})`,
    b.usp ? `What it does / why it's different: ${b.usp}` : null,
    b.targetAudience ? `Who it's for: ${b.targetAudience}` : null,
    b.keywords ? `Keywords: ${b.keywords}` : null,
    b.summary ? `Notes: ${b.summary.slice(0, 600)}` : null,
    b.limitations ? `What it does NOT offer: ${b.limitations.slice(0, 400)}` : null,
  ].filter(Boolean).join('\n')
}

/**
 * The brand for the Lead Agent's prompts. With `full` off (Search settings → "Use my brand profile"
 * off) only what the product is: name, website, what it does and doesn't offer. Who it's for,
 * keywords and notes are left out, so the search settings alone say who to look for.
 */
export function leadBrandBlock(b: BrandContext, full: boolean): string {
  if (full) return brandBlock(b)
  return [
    `Brand: ${b.name} (${b.websiteUrl})`,
    b.usp ? `What it does: ${b.usp}` : null,
    b.limitations ? `What it does NOT offer: ${b.limitations.slice(0, 400)}` : null,
  ].filter(Boolean).join('\n')
}

export const idOf = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)

/** First JSON array/object in a model reply, or null. */
export function parseJsonLoose<T>(raw: string, kind: 'array' | 'object'): T | null {
  const [open, close] = kind === 'array' ? ['[', ']'] : ['{', '}']
  const start = raw.indexOf(open)
  const end = raw.lastIndexOf(close)
  if (start === -1 || end <= start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) as T } catch { return null }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Plain text (blank line = paragraph) → simple HTML for Gmail. */
export function textToHtml(text: string): string {
  return text.trim().split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('')
}

export const firstName = (name: string | undefined) => {
  const f = (name ?? '').trim().split(/\s+/)[0]
  return f && /^[\p{L}'-]{2,}$/u.test(f) ? f : ''
}

export const daysFrom = (iso: string, days: number) => new Date(Date.parse(iso) + days * 86_400_000).toISOString()
