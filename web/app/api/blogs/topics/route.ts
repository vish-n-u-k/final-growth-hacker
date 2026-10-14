import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandForUser } from '@/lib/server-session'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'
import { fetchGscTopQueries } from '@/lib/modules/seo/keyword-fetchers'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Blog topic ideas for Today's blog card. Best source: Search Console searches where the site
// already shows up on page 2 or low on page 1 (positions 4–20), where a dedicated article is
// most likely to move it up. Falls back to the brand's own keywords.

export interface TopicIdea { topic: string; why: string }

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brand = await getBrandForUser(user.id)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const ideas: TopicIdea[] = []
  const seen = new Set<string>()
  const add = (topic: string, why: string) => {
    const key = topic.toLowerCase().trim()
    if (!key || seen.has(key) || ideas.length >= 4) return
    seen.add(key)
    ideas.push({ topic: topic.trim(), why })
  }

  const [gsc] = await db.select({ metadata: brandIntegrations.metadata }).from(brandIntegrations)
    .where(and(eq(brandIntegrations.brandId, brand.id), eq(brandIntegrations.provider, 'gsc_api'), eq(brandIntegrations.status, 'connected')))
    .limit(1)
  const meta = (gsc?.metadata as Record<string, string> | null) ?? {}
  if (meta.client_email && meta.private_key && brand.websiteUrl) {
    try {
      const rows = await fetchGscTopQueries(meta.client_email, meta.private_key, brand.websiteUrl, 100)
      const brandWord = brand.name.toLowerCase().split(/\s+/)[0]
      rows
        .filter(r => r.position > 3 && r.position <= 20 && r.impressions >= 5 && !r.query.toLowerCase().includes(brandWord))
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, 3)
        .forEach(r => add(r.query, `People search this ${r.impressions.toLocaleString()} times; you rank #${Math.round(r.position)}`))
    } catch {
      // No Search Console data yet: fall back to keywords below.
    }
  }

  for (const k of (brand.keywords ?? '').split(/[,\n]/)) add(k, 'One of your brand keywords')

  return NextResponse.json({ ideas })
}
