import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

async function hogqlRows(
  host: string, projectId: string, apiKey: string, query: string,
): Promise<unknown[][] | null> {
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { kind: 'HogQLQuery', query } }),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null
    const data = await res.json() as { results?: unknown[][] }
    return data.results ?? null
  } catch { return null }
}

function normalizeSource(utmSource: string, referringDomain: string): string {
  const src = (utmSource || referringDomain || '').toLowerCase()
  if (!src || src === '(direct)' || src === 'direct') return 'Direct'
  if (src.includes('facebook') || src.includes('fb') || src === 'instagram') return src.includes('instagram') ? 'Instagram' : 'Facebook'
  if (src.includes('google')) return 'Google'
  if (src.includes('linkedin')) return 'LinkedIn'
  if (src.includes('twitter') || src.includes('t.co') || src === 'x') return 'Twitter/X'
  if (src.includes('youtube')) return 'YouTube'
  if (src.includes('tiktok')) return 'TikTok'
  // strip www. and return domain root
  const domain = referringDomain.replace(/^www\./, '').split('/')[0]
  return domain || utmSource || 'Direct'
}

function getStatus(lastSeenIso: string | null): 'active' | 'dormant' | 'churned' | 'new' {
  if (!lastSeenIso) return 'new'
  const diffDays = (Date.now() - new Date(lastSeenIso).getTime()) / 86_400_000
  if (diffDays <= 7) return 'active'
  if (diffDays <= 30) return 'dormant'
  return 'churned'
}

function relativeTime(isoStr: string): string {
  const diffMs = Date.now() - new Date(isoStr).getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD < 30) return `${diffD}d ago`
  const diffMo = Math.floor(diffD / 30)
  return `${diffMo}mo ago`
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = request.nextUrl.searchParams.get('brandId')
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })

  const [brand] = await db.select().from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.userId, user.id))).limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [phInt] = await db.select().from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brandId),
      eq(brandIntegrations.provider, 'posthog'),
      eq(brandIntegrations.status, 'connected'),
    )).limit(1)

  if (!phInt?.apiKey) return NextResponse.json({ connected: false, users: [] })

  const meta = (phInt.metadata as Record<string, string> | null) ?? {}
  const projectId = meta['project_id']
  const host = (meta['posthog_host'] ?? 'https://us.posthog.com').replace(/\/$/, '')
  if (!projectId) return NextResponse.json({ connected: false, users: [] })

  const key = phInt.apiKey

  const [personRows, activityRows] = await Promise.all([
    // All identified users, most recent first
    hogqlRows(host, projectId, key, `
      SELECT
        id,
        coalesce(toString(properties.$email), ''),
        coalesce(toString(properties.$name), ''),
        toString(created_at),
        coalesce(toString(properties.$initial_referring_domain), ''),
        coalesce(toString(properties.$initial_utm_source), ''),
        coalesce(toString(properties.$initial_utm_medium), ''),
        coalesce(toString(properties.$geoip_country_name), ''),
        coalesce(toString(properties.$initial_current_url), '')
      FROM persons
      WHERE is_identified = 1
      ORDER BY created_at DESC
      LIMIT 300
    `),
    // Per-person activity: total events + last seen
    hogqlRows(host, projectId, key, `
      SELECT
        person_id,
        count() as total_events,
        countIf(event = '$pageview') as pageviews,
        toString(max(timestamp)) as last_seen
      FROM events
      WHERE person_id IN (
        SELECT id FROM persons WHERE is_identified = 1
      )
      AND timestamp >= now() - interval 90 day
      GROUP BY person_id
    `),
  ])

  // Build activity map keyed by person_id
  const activityMap = new Map<string, { totalEvents: number; pageviews: number; lastSeen: string }>()
  for (const r of activityRows ?? []) {
    activityMap.set(String(r[0]), {
      totalEvents: Number(r[1]),
      pageviews: Number(r[2]),
      lastSeen: String(r[3]),
    })
  }

  const users = (personRows ?? []).map(r => {
    const userId        = String(r[0])
    const email         = String(r[1])
    const name          = String(r[2])
    const signedUpAt    = String(r[3])
    const referringDomain = String(r[4])
    const utmSource     = String(r[5])
    const utmMedium     = String(r[6])
    const country       = String(r[7])
    const initialUrl    = String(r[8])

    const activity = activityMap.get(userId)
    const lastSeen = activity?.lastSeen ?? null
    const source   = normalizeSource(utmSource, referringDomain)
    const status   = getStatus(lastSeen)

    return {
      userId,
      email,
      name,
      signedUpAt,
      signedUpRel: relativeTime(signedUpAt),
      source,
      utmMedium,
      country,
      initialUrl,
      lastSeen,
      lastSeenRel: lastSeen ? relativeTime(lastSeen) : null,
      status,
      totalEvents: activity?.totalEvents ?? 0,
      pageviews: activity?.pageviews ?? 0,
    }
  })

  return NextResponse.json({ connected: true, users })
}
