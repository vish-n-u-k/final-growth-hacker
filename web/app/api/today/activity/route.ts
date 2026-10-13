import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandForUser } from '@/lib/server-session'
import { buildPostHogFilter } from '@/lib/posthog/filter'
import { normalizeSource } from '@/lib/posthog/source'
import { posthogForBrand } from '@/lib/posthog/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// "What happened" on Today: who visited, who signed up and where they came from, from PostHog.

export interface TodayActivity {
  connected: boolean
  days: number
  visitors: { current: number; prior: number }
  signups: {
    count: number
    prior: number
    people: { id: string; name: string; source: string; country: string; landing: string; at: string }[]
  }
  returning: number
  channels: { name: string; visitors: number }[]
  referrers: { domain: string; visitors: number }[]
  pages: { path: string; visitors: number }[]
}

// Short per-instance cache: Today can be reloaded often and each load is 7 PostHog queries.
const cache = new Map<string, { at: number; data: TodayActivity }>()
const CACHE_MS = 5 * 60_000

function pathOf(url: string): string {
  try { return new URL(url).pathname } catch { return '' }
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brand = await getBrandForUser(user.id)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const days = request.nextUrl.searchParams.get('days') === '7' ? 7 : 1
  const empty: TodayActivity = {
    connected: false, days,
    visitors: { current: 0, prior: 0 },
    signups: { count: 0, prior: 0, people: [] },
    returning: 0, channels: [], referrers: [], pages: [],
  }

  const ph = await posthogForBrand(brand.id)
  if (!ph) return NextResponse.json(empty)

  const cacheKey = `${brand.id}:${days}`
  const hit = cache.get(cacheKey)
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.data)

  const { q, meta } = ph
  const f = buildPostHogFilter(meta)
  const personAnd = f.personWhereClause.replace(/^WHERE /, 'AND ')
  const since = `now() - interval ${days} day`
  const priorFrom = `now() - interval ${days * 2} day`
  // The brand's own site shows up as a referrer on internal navigation; leave it out.
  const ownHost = (() => {
    try { return new URL(brand.websiteUrl).hostname.replace(/^www\./, '').replace(/[^a-z0-9.-]/gi, '') } catch { return '' }
  })()
  const notOwn = ownHost ? `AND properties.$referring_domain NOT ILIKE '%${ownHost}%'` : ''

  const [visitorRows, signupCountRows, signupRows, returningRows, channelRows, referrerRows, pageRows] = await Promise.all([
    q(`SELECT count(DISTINCT if(timestamp >= ${since}, person_id, null)), count(DISTINCT if(timestamp < ${since}, person_id, null))
       FROM events WHERE event = '$pageview' AND timestamp >= ${priorFrom}`),
    q(`SELECT countIf(created_at >= ${since}), countIf(created_at < ${since})
       FROM persons WHERE is_identified = 1 AND created_at >= ${priorFrom} ${personAnd}`),
    q(`SELECT coalesce(toString(properties.$name), ''), coalesce(toString(properties.$email), ''), toString(created_at),
              coalesce(toString(properties.$initial_utm_source), ''), coalesce(toString(properties.$initial_referring_domain), ''),
              coalesce(toString(properties.$geoip_country_name), ''), coalesce(toString(properties.$initial_current_url), ''), toString(id)
       FROM persons WHERE is_identified = 1 AND created_at >= ${since} ${personAnd}
       ORDER BY created_at DESC LIMIT 8`),
    q(`SELECT count(DISTINCT person_id) FROM events
       WHERE timestamp >= ${since}
       AND person_id IN (SELECT id FROM persons WHERE is_identified = 1 AND created_at < ${since} ${personAnd})`),
    q(`SELECT coalesce(properties.$channel_type, 'Unknown'), count(DISTINCT person_id) FROM events
       WHERE event = '$pageview' AND timestamp >= ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
    q(`SELECT properties.$referring_domain, count(DISTINCT person_id) FROM events
       WHERE event = '$pageview' AND timestamp >= ${since}
       AND properties.$referring_domain IS NOT NULL AND properties.$referring_domain NOT IN ('', '$direct') ${notOwn}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
    q(`SELECT properties.$pathname, count(DISTINCT person_id) FROM events
       WHERE event = '$pageview' AND timestamp >= ${since} AND properties.$pathname IS NOT NULL AND properties.$pathname != ''
       GROUP BY 1 ORDER BY 2 DESC LIMIT 4`),
  ])

  const n = (v: unknown) => Number(v ?? 0) || 0
  const data: TodayActivity = {
    connected: true,
    days,
    visitors: { current: n(visitorRows?.[0]?.[0]), prior: n(visitorRows?.[0]?.[1]) },
    signups: {
      count: n(signupCountRows?.[0]?.[0]),
      prior: n(signupCountRows?.[0]?.[1]),
      people: (signupRows ?? []).map(r => ({
        id: String(r[7]),
        name: String(r[0]) || String(r[1]) || 'Someone',
        at: String(r[2]),
        source: normalizeSource(String(r[3]), String(r[4])),
        country: String(r[5]),
        landing: pathOf(String(r[6])),
      })),
    },
    returning: n(returningRows?.[0]?.[0]),
    channels: (channelRows ?? []).map(r => ({ name: String(r[0]), visitors: n(r[1]) })).filter(c => c.visitors > 0),
    referrers: (referrerRows ?? []).map(r => ({ domain: String(r[0]).replace(/^www\./, ''), visitors: n(r[1]) })),
    pages: (pageRows ?? []).map(r => ({ path: String(r[0]), visitors: n(r[1]) })),
  }
  cache.set(cacheKey, { at: Date.now(), data })
  return NextResponse.json(data)
}
