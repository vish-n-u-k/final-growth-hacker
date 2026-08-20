import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export interface PlatformStats {
  provider: string        // 'instagram' | 'facebook' | 'linkedin' | 'pinterest'
  name: string
  connected: boolean
  handle?: string
  followers?: number
  impressions7d?: number
  reach7d?: number
  engagements7d?: number
  saves7d?: number
  clicks7d?: number
  recentPosts?: { caption: string; likes: number; comments: number; date: string }[]
  error?: string
}

function dateStr(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10)
}

function fmt7d(since: number) {
  return `${since}&until=${Math.floor(Date.now() / 1000)}`
}

// ── Instagram ─────────────────────────────────────────────────────────────────

async function fetchInstagram(accessToken: string, meta: Record<string, string>): Promise<PlatformStats> {
  const igId = meta.instagram_id
  const pageToken = meta.page_access_token || accessToken

  if (!igId || !pageToken) {
    return {
      provider: 'instagram', name: 'Instagram', connected: true,
      handle: meta.instagram_username ? `@${meta.instagram_username}` : undefined,
      followers: meta.instagram_followers ? parseInt(meta.instagram_followers) : undefined,
      error: 'No Instagram Business account linked to this Facebook Page.',
    }
  }

  const base = 'https://graph.facebook.com/v21.0'
  const since = Math.floor((Date.now() - 7 * 864e5) / 1000)

  try {
    const [insightsRes, mediaRes] = await Promise.all([
      fetch(`${base}/${igId}/insights?metric=impressions,reach&period=day&since=${since}&until=${Math.floor(Date.now() / 1000)}&access_token=${pageToken}`, { signal: AbortSignal.timeout(12000) }),
      fetch(`${base}/${igId}/media?fields=caption,timestamp,like_count,comments_count&limit=5&access_token=${pageToken}`, { signal: AbortSignal.timeout(12000) }),
    ])

    let impressions7d = 0, reach7d = 0
    if (insightsRes.ok) {
      const d = await insightsRes.json() as { data?: { name: string; values: { value: number }[] }[] }
      for (const row of d.data ?? []) {
        const total = row.values.reduce((s, v) => s + (v.value || 0), 0)
        if (row.name === 'impressions') impressions7d = total
        if (row.name === 'reach') reach7d = total
      }
    }

    let recentPosts: PlatformStats['recentPosts'] = []
    if (mediaRes.ok) {
      const d = await mediaRes.json() as { data?: { caption?: string; like_count?: number; comments_count?: number; timestamp?: string }[] }
      recentPosts = (d.data ?? []).map(p => ({
        caption: (p.caption ?? '').replace(/\n/g, ' ').slice(0, 70),
        likes: p.like_count ?? 0,
        comments: p.comments_count ?? 0,
        date: p.timestamp ? new Date(p.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '',
      }))
    }

    return {
      provider: 'instagram', name: 'Instagram', connected: true,
      handle: meta.instagram_username ? `@${meta.instagram_username}` : undefined,
      followers: meta.instagram_followers ? parseInt(meta.instagram_followers) : undefined,
      impressions7d, reach7d, recentPosts,
    }
  } catch {
    return {
      provider: 'instagram', name: 'Instagram', connected: true,
      followers: meta.instagram_followers ? parseInt(meta.instagram_followers) : undefined,
      error: 'Could not fetch live analytics. Token may need refreshing.',
    }
  }
}

// ── Facebook Page ─────────────────────────────────────────────────────────────

async function fetchFacebook(accessToken: string, meta: Record<string, string>): Promise<PlatformStats> {
  const pageId = meta.page_id
  const pageToken = meta.page_access_token || accessToken

  if (!pageId || !pageToken) {
    return { provider: 'facebook', name: 'Facebook', connected: true, error: 'No Facebook Page found.' }
  }

  const base = 'https://graph.facebook.com/v21.0'
  const since = Math.floor((Date.now() - 7 * 864e5) / 1000)

  try {
    const [pageRes, insightsRes] = await Promise.all([
      fetch(`${base}/${pageId}?fields=fan_count,followers_count&access_token=${pageToken}`, { signal: AbortSignal.timeout(12000) }),
      fetch(`${base}/${pageId}/insights?metric=page_impressions,page_reach&period=day&since=${since}&until=${Math.floor(Date.now() / 1000)}&access_token=${pageToken}`, { signal: AbortSignal.timeout(12000) }),
    ])

    let followers: number | undefined
    if (pageRes.ok) {
      const d = await pageRes.json() as { fan_count?: number; followers_count?: number }
      followers = d.followers_count ?? d.fan_count
    }

    let impressions7d = 0, reach7d = 0
    if (insightsRes.ok) {
      const d = await insightsRes.json() as { data?: { name: string; values: { value: number }[] }[] }
      for (const row of d.data ?? []) {
        const total = row.values.reduce((s, v) => s + (Number(v.value) || 0), 0)
        if (row.name === 'page_impressions') impressions7d = total
        if (row.name === 'page_reach') reach7d = total
      }
    }

    return {
      provider: 'facebook', name: 'Facebook', connected: true,
      handle: meta.page_name,
      followers, impressions7d, reach7d,
    }
  } catch {
    return { provider: 'facebook', name: 'Facebook', connected: true, error: 'Could not fetch live analytics.' }
  }
}

// ── LinkedIn ──────────────────────────────────────────────────────────────────

async function fetchLinkedIn(accessToken: string, meta: Record<string, string>): Promise<PlatformStats> {
  const orgId = meta.org_id
  if (!orgId) {
    return { provider: 'linkedin', name: 'LinkedIn', connected: true, handle: meta.profile_name, error: 'No organization page found.' }
  }

  const orgUrn = orgId.startsWith('urn:') ? orgId : `urn:li:organization:${orgId}`
  const headers = { Authorization: `Bearer ${accessToken}`, 'LinkedIn-Version': '202401' }

  try {
    const [followerRes, shareRes] = await Promise.all([
      fetch(`https://api.linkedin.com/v2/networkSizes/${encodeURIComponent(orgUrn)}?edgeType=CompanyFollowedByMember`, { headers, signal: AbortSignal.timeout(12000) }),
      fetch(`https://api.linkedin.com/v2/organizationalEntityShareStatistics?q=organizationalEntity&organizationalEntity=${encodeURIComponent(orgUrn)}&timeIntervals.timeGranularityType=DAY&timeIntervals.timeRange.start=${Date.now() - 7 * 864e5}&timeIntervals.timeRange.end=${Date.now()}`, { headers, signal: AbortSignal.timeout(12000) }),
    ])

    let followers: number | undefined = meta.org_followers ? parseInt(meta.org_followers) : undefined
    if (followerRes.ok) {
      const d = await followerRes.json() as { firstDegreeSize?: number }
      followers = d.firstDegreeSize ?? followers
    }

    let impressions7d = 0, engagements7d = 0
    if (shareRes.ok) {
      const d = await shareRes.json() as { elements?: { totalShareStatistics?: { impressionCount?: number; clickCount?: number; likeCount?: number; commentCount?: number } }[] }
      for (const el of d.elements ?? []) {
        const s = el.totalShareStatistics ?? {}
        impressions7d  += s.impressionCount ?? 0
        engagements7d  += (s.clickCount ?? 0) + (s.likeCount ?? 0) + (s.commentCount ?? 0)
      }
    }

    return {
      provider: 'linkedin', name: 'LinkedIn', connected: true,
      handle: meta.org_name ?? meta.profile_name,
      followers, impressions7d, engagements7d,
    }
  } catch {
    return {
      provider: 'linkedin', name: 'LinkedIn', connected: true,
      handle: meta.org_name ?? meta.profile_name,
      followers: meta.org_followers ? parseInt(meta.org_followers) : undefined,
      error: 'Could not fetch live analytics.',
    }
  }
}

// ── Pinterest ─────────────────────────────────────────────────────────────────

async function fetchPinterest(accessToken: string, meta: Record<string, string>): Promise<PlatformStats> {
  try {
    const start = dateStr(7)
    const end = dateStr(0)

    const res = await fetch(
      `https://api.pinterest.com/v5/user_account/analytics?start_date=${start}&end_date=${end}&metric_types=IMPRESSION,SAVE,PIN_CLICK`,
      { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(12000) },
    )

    let impressions7d = 0, saves7d = 0, clicks7d = 0
    if (res.ok) {
      const d = await res.json() as { all?: { daily_metrics?: { data_status: string; impressions?: number; saves?: number; pin_clicks?: number }[] } }
      for (const day of d.all?.daily_metrics ?? []) {
        if (day.data_status !== 'COMPLETE') continue
        impressions7d += day.impressions ?? 0
        saves7d       += day.saves ?? 0
        clicks7d      += day.pin_clicks ?? 0
      }
    }

    return {
      provider: 'pinterest', name: 'Pinterest', connected: true,
      handle: meta.username ? `@${meta.username}` : undefined,
      followers: meta.followers ? parseInt(meta.followers) : undefined,
      impressions7d, saves7d, clicks7d,
    }
  } catch {
    return {
      provider: 'pinterest', name: 'Pinterest', connected: true,
      handle: meta.username ? `@${meta.username}` : undefined,
      followers: meta.followers ? parseInt(meta.followers) : undefined,
      error: 'Could not fetch live analytics.',
    }
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

const NOT_CONNECTED: Record<string, PlatformStats> = {
  instagram: { provider: 'instagram', name: 'Instagram', connected: false },
  facebook:  { provider: 'facebook',  name: 'Facebook',  connected: false },
  linkedin:  { provider: 'linkedin',  name: 'LinkedIn',  connected: false },
  pinterest: { provider: 'pinterest', name: 'Pinterest', connected: false },
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ platforms: Object.values(NOT_CONNECTED) })

  const integrations = await db.select().from(brandIntegrations).where(
    and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.status, 'connected'),
      inArray(brandIntegrations.provider, ['meta_oauth', 'instagram_oauth', 'linkedin_oauth', 'pinterest_oauth']),
    ),
  )

  const intMap = new Map(integrations.map(i => [i.provider, i]))
  // instagram_oauth takes priority; fall back to meta_oauth if IG was connected via Facebook
  const igInteg   = intMap.get('instagram_oauth') ?? intMap.get('meta_oauth')
  const metaInteg = intMap.get('meta_oauth')
  const liInteg   = intMap.get('linkedin_oauth')
  const pinInteg  = intMap.get('pinterest_oauth')

  const results = await Promise.all([
    igInteg
      ? fetchInstagram(igInteg.accessToken ?? '', (igInteg.metadata ?? {}) as Record<string, string>)
      : Promise.resolve(NOT_CONNECTED.instagram),
    metaInteg
      ? fetchFacebook(metaInteg.accessToken ?? '', (metaInteg.metadata ?? {}) as Record<string, string>)
      : Promise.resolve(NOT_CONNECTED.facebook),
    liInteg
      ? fetchLinkedIn(liInteg.accessToken ?? '', (liInteg.metadata ?? {}) as Record<string, string>)
      : Promise.resolve(NOT_CONNECTED.linkedin),
    pinInteg
      ? fetchPinterest(pinInteg.accessToken ?? '', (pinInteg.metadata ?? {}) as Record<string, string>)
      : Promise.resolve(NOT_CONNECTED.pinterest),
  ])

  return NextResponse.json({ platforms: results })
}
