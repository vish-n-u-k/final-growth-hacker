// Shared helpers for the AI Agents: what the agents know about the brand, JSON parsing of model
// output, and turning a plain-text email into the HTML Gmail sends.

import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { brands, brainContext, competitors } from '@/lib/db/schema'

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

export async function loadBrandContext(brandId: string): Promise<BrandContext | null> {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1)
  if (!brand) return null
  const [brain] = await db.select({ summary: brainContext.summary, limitations: brainContext.limitations })
    .from(brainContext).where(eq(brainContext.brandId, brandId)).limit(1).catch(() => [])
  const comps = await db.select({ name: competitors.name, url: competitors.url })
    .from(competitors).where(eq(competitors.brandId, brandId)).catch(() => [])
  const own = domainOf(brand.websiteUrl)
  const seen = new Set<string>()
  const list: BrandContext['competitors'] = []
  for (const c of comps) {
    const d = domainOf(c.url)
    if (!d || d === own || seen.has(d)) continue
    seen.add(d)
    list.push({ name: c.name || d.split('.')[0], domain: d })
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
