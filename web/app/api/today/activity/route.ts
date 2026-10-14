import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandForUser } from '@/lib/server-session'
import { buildPostHogFilter } from '@/lib/posthog/filter'
import { normalizeSource } from '@/lib/posthog/source'
import { posthogForBrand } from '@/lib/posthog/client'
import { db } from '@/lib/db'
import { brandIntegrations } from '@/lib/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { classifyChannel, rootDomain } from '@/lib/posthog/channel'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// "What happened" on Today: who visited, who signed up and where they came from, from PostHog.

export interface TodayActivity {
  connected: boolean
  error?: string // connected, but PostHog didn't answer (bad key, wrong project): don't show zeros as real
  days: number
  visitors: { current: number; prior: number }
  signups: {
    count: number
    prior: number
    people: { id: string; name: string; source: string; country: string; landing: string; at: string }[]
  }
  // Existing users who logged in during the period (PostHog $identify), newest first.
  signins: {
    count: number
    prior: number
    people: { id: string; name: string; source: string; country: string; device: string; times: number; at: string }[]
  }
  returning: number
  channels: { name: string; visitors: number }[]
  referrers: { domain: string; visitors: number }[]
  pages: { path: string; visitors: number }[]
  // PostHog covers the app; the website is measured with Google Analytics / Search Console.
  // 'connect-ga' = Google Analytics isn't connected, so nothing measures the website.
  website: { status: 'ok' | 'connect-ga'; host: string }
}

// Short per-instance cache: Today can be reloaded often and each load is 9 PostHog queries.
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
    signins: { count: 0, prior: 0, people: [] },
    returning: 0, channels: [], referrers: [], pages: [],
    website: { status: 'ok', host: '' },
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
  const ownRoot = ownHost ? rootDomain(ownHost) : ''
  // One person = one email: the same human can end up as several PostHog persons.
  const personKey = `coalesce(nullIf(toString(properties.$email), ''), toString(id))`

  // Sign-ins only count people who already had an account, so they don't repeat the signups.
  const existingUsers = `person_id IN (SELECT id FROM persons WHERE is_identified = 1 AND created_at < ${since} ${personAnd})`

  const [visitorRows, signupCountRows, signupRows, returningRows, channelRows, referrerRows, pageRows, gaRows, signinCountRows, signinRows] = await Promise.all([
    q(`SELECT count(DISTINCT if(timestamp >= ${since}, person_id, null)), count(DISTINCT if(timestamp < ${since}, person_id, null))
       FROM events WHERE event = '$pageview' AND timestamp >= ${priorFrom}`),
    q(`SELECT count(DISTINCT if(created_at >= ${since}, ${personKey}, null)), count(DISTINCT if(created_at < ${since}, ${personKey}, null))
       FROM persons WHERE is_identified = 1 AND created_at >= ${priorFrom} ${personAnd}`),
    q(`SELECT coalesce(toString(properties.$name), ''), coalesce(toString(properties.$email), ''), toString(created_at),
              coalesce(toString(properties.$initial_utm_source), ''), coalesce(toString(properties.$initial_referring_domain), ''),
              coalesce(toString(properties.$geoip_country_name), ''), coalesce(toString(properties.$initial_current_url), ''), toString(id)
       FROM persons WHERE is_identified = 1 AND created_at >= ${since} ${personAnd}
       ORDER BY created_at DESC LIMIT 40`),
    q(`SELECT count(DISTINCT person_id) FROM events
       WHERE timestamp >= ${since}
       AND person_id IN (SELECT id FROM persons WHERE is_identified = 1 AND created_at < ${since} ${personAnd})`),
    q(`SELECT argMin(coalesce(toString(properties.$referring_domain), ''), timestamp),
              argMin(coalesce(toString(properties.utm_source), ''), timestamp),
              argMin(coalesce(toString(properties.utm_medium), ''), timestamp),
              argMin(if(isNotNull(properties.gclid) OR isNotNull(properties.fbclid) OR isNotNull(properties.msclkid), 1, 0), timestamp)
       FROM events WHERE event = '$pageview' AND timestamp >= ${since} GROUP BY person_id LIMIT 20000`),
    q(`SELECT properties.$referring_domain, count(DISTINCT person_id) FROM events
       WHERE event = '$pageview' AND timestamp >= ${since}
       AND properties.$referring_domain IS NOT NULL AND properties.$referring_domain NOT IN ('', '$direct') ${notOwn}
       GROUP BY 1 ORDER BY 2 DESC LIMIT 5`),
    q(`SELECT properties.$pathname, count(DISTINCT person_id) FROM events
       WHERE event = '$pageview' AND timestamp >= ${since} AND properties.$pathname IS NOT NULL AND properties.$pathname != ''
       GROUP BY 1 ORDER BY 2 DESC LIMIT 4`),
    // Is Google Analytics (the website's tracker) connected?
    db.select({ id: brandIntegrations.id }).from(brandIntegrations)
      .where(and(eq(brandIntegrations.brandId, brand.id), inArray(brandIntegrations.provider, ['ga4_api', 'google_analytics']), eq(brandIntegrations.status, 'connected')))
      .limit(1).catch(() => []),
    q(`SELECT count(DISTINCT if(timestamp >= ${since}, person_id, null)), count(DISTINCT if(timestamp < ${since}, person_id, null))
       FROM events WHERE event = '$identify' AND timestamp >= ${priorFrom} AND ${existingUsers}`),
    q(`SELECT toString(person_id), toString(max(timestamp)), count(),
              any(coalesce(toString(person.properties.$name), '')), any(coalesce(toString(person.properties.$email), '')),
              any(coalesce(toString(person.properties.$initial_utm_source), '')), any(coalesce(toString(person.properties.$initial_referring_domain), '')),
              any(coalesce(toString(properties.$geoip_country_name), '')), any(coalesce(toString(properties.$device_type), ''))
       FROM events WHERE event = '$identify' AND timestamp >= ${since} AND ${existingUsers}
       GROUP BY person_id ORDER BY max(timestamp) DESC LIMIT 8`),
  ])

  const n = (v: unknown) => Number(v ?? 0) || 0
  if (visitorRows === null && signupCountRows === null && pageRows === null) {
    return NextResponse.json({ ...empty, connected: true, error: 'PostHog isn\'t responding, so this can\'t be shown. Check the PostHog key and project in Settings → Integrations.' })
  }

  // Newest first, one row per email (duplicates of the same person are dropped).
  const seenPeople = new Set<string>()
  const signupPeople = (signupRows ?? []).filter(r => {
    const email = String(r[1]).toLowerCase()
    const id = `id:${String(r[7])}`
    if (seenPeople.has(id) || (email && seenPeople.has(email))) return false
    seenPeople.add(id)
    if (email) seenPeople.add(email)
    return true
  })

  const channelCounts = new Map<string, number>()
  for (const r of channelRows ?? []) {
    const ch = classifyChannel({ referringDomain: String(r[0] ?? ''), utmSource: String(r[1] ?? ''), utmMedium: String(r[2] ?? ''), paidClick: n(r[3]) === 1 }, ownRoot, ownHost)
    channelCounts.set(ch, (channelCounts.get(ch) ?? 0) + 1)
  }
  const channels = [...channelCounts].map(([name, visitors]) => ({ name, visitors })).sort((a, b) => b.visitors - a.visitors).slice(0, 6)

  const website: TodayActivity['website'] = { status: ownHost && (gaRows as unknown[]).length === 0 ? 'connect-ga' : 'ok', host: ownHost }

  // Where a person first came from, in words: their own website or the app itself rather than a raw domain.
  const sourceFor = (utm: string, refDomain: string) => {
    const ref = refDomain.toLowerCase().replace(/^www\./, '')
    if (!utm && ownHost && ref === ownHost) return 'your website'
    if (!utm && ownRoot && ref && ref !== '$direct' && rootDomain(ref) === ownRoot) return 'the app'
    return normalizeSource(utm, refDomain)
  }

  const data: TodayActivity = {
    connected: true,
    days,
    visitors: { current: n(visitorRows?.[0]?.[0]), prior: n(visitorRows?.[0]?.[1]) },
    signups: {
      count: n(signupCountRows?.[0]?.[0]),
      prior: n(signupCountRows?.[0]?.[1]),
      people: signupPeople.slice(0, 8).map(r => ({
        id: String(r[7]),
        name: String(r[0]) || String(r[1]) || 'Someone',
        at: String(r[2]),
        source: sourceFor(String(r[3]), String(r[4])),
        country: String(r[5]),
        landing: pathOf(String(r[6])),
      })),
    },
    signins: {
      count: n(signinCountRows?.[0]?.[0]),
      prior: n(signinCountRows?.[0]?.[1]),
      people: (signinRows ?? []).map(r => ({
        id: String(r[0]),
        at: String(r[1]),
        times: n(r[2]),
        name: String(r[3]) || String(r[4]) || 'Someone',
        source: sourceFor(String(r[5]), String(r[6])),
        country: String(r[7]),
        device: String(r[8]),
      })),
    },
    returning: n(returningRows?.[0]?.[0]),
    channels,
    referrers: (referrerRows ?? []).map(r => ({ domain: String(r[0]).replace(/^www\./, ''), visitors: n(r[1]) })),
    pages: (pageRows ?? []).map(r => ({ path: String(r[0]), visitors: n(r[1]) })),
    website,
  }
  cache.set(cacheKey, { at: Date.now(), data })
  return NextResponse.json(data)
}
