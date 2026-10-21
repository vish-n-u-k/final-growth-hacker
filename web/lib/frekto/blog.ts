// ── Blog articles via Frekto (POST /generate/blog) ───────────────────────────
// Frekto writes a 400–600 word article with web research and, unless told not to, schedules it
// for tomorrow: as a LinkedIn post ('linkedin') or on the blog CMS connected in Frekto
// ('blog_mcp'). It answers straight away (no job polling).

import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { frektoHttpError, frektoNetworkError } from '@/lib/frekto/errors'

const FREKTO_BASE = 'https://api.frekto.ai'

/** draft = write only; linkedin / blog = write and schedule for tomorrow on that destination. */
export type FrektoBlogMode = 'draft' | 'linkedin' | 'blog'

export interface FrektoBlog {
  jobId: string
  heading: string
  body: string
  hashtags: string[]
  metaDescription: string
  primaryKeyword: string
  platform: 'linkedin' | 'blog_mcp'
  scheduled: boolean
}

export async function getFrektoKey(brandId: string): Promise<string | null> {
  const [row] = await db.select({ apiKey: brandIntegrations.apiKey }).from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brandId), eq(brandIntegrations.provider, 'frekto'), eq(brandIntegrations.status, 'connected')))
    .limit(1)
  return row?.apiKey ?? null
}

export async function generateFrektoBlog(apiKey: string, topic: string, mode: FrektoBlogMode): Promise<FrektoBlog | { error: string }> {
  const platform = mode === 'blog' ? 'blog_mcp' : 'linkedin'
  let res: Response
  try {
    res = await fetch(`${FREKTO_BASE}/generate/blog`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        topic: topic.slice(0, 300),
        platform,
        // Frekto schedules for tomorrow by default; "just write it" must not post anything.
        ...(mode === 'draft' ? { schedule: false } : {}),
      }),
      signal: AbortSignal.timeout(55_000),
    })
  } catch (e) {
    return { error: frektoNetworkError(e, 'write the article') }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (mode === 'blog' && /cms|blog|integration|connect/i.test(text)) {
      return { error: 'Frekto has no blog connected yet. In Frekto, go to Settings → Integrations and connect your blog, then try again.' }
    }
    return { error: frektoHttpError(res.status, text, 'write the article') }
  }
  const d = await res.json().catch(() => null) as {
    job_id?: string; status?: string; wants_schedule?: boolean; heading?: string; body?: string
    hashtags?: string[]; meta_description?: string; primary_keyword?: string; error?: string
  } | null
  if (!d?.body || !d.heading) return { error: d?.error ? `Frekto couldn't write the article: ${d.error}` : 'Frekto sent back an empty article. Try again.' }
  return {
    jobId: d.job_id ?? '',
    heading: d.heading,
    body: d.body,
    hashtags: d.hashtags ?? [],
    metaDescription: d.meta_description ?? '',
    primaryKeyword: d.primary_keyword ?? '',
    platform,
    scheduled: mode !== 'draft' && d.wants_schedule !== false,
  }
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').slice(0, 80) || 'article'
}
