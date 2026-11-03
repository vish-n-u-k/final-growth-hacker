import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { posthogForBrand } from '@/lib/posthog/client'
import { classifyChannel, hostOfUrl, rootDomain } from '@/lib/posthog/channel'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET /api/analytics/new-visitors?brandId=…&period=1d|7d|30d
// People PostHog first saw in the period: where they landed, how they got there, their browser,
// device and country, and whether they signed up. Read from each one's first pageview.

type Count = { name: string; visitors: number; signedUp: number }
export type NewVisitor = {
  at: string; landing: string; channel: string; from: string
  browser: string; os: string; device: string; country: string; pages: number; signedUp: boolean
}

const s = (v: unknown) => (v == null ? '' : String(v))

function tally(rows: { key: string; signedUp: boolean }[], limit: number): Count[] {
  const m = new Map<string, Count>()
  for (const r of rows) {
    const c = m.get(r.key) ?? { name: r.key, visitors: 0, signedUp: 0 }
    c.visitors++
    if (r.signedUp) c.signedUp++
    m.set(r.key, c)
  }
  return [...m.values()].sort((a, b) => b.visitors - a.visitors).slice(0, limit)
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const brandId = request.nextUrl.searchParams.get('brandId')
  if (!brandId) return NextResponse.json({ error: 'brandId required' }, { status: 400 })
  const [brand] = await db.select().from(brands).where(and(eq(brands.id, brandId), eq(brands.userId, user.id))).limit(1)
  if (!brand) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const ph = await posthogForBrand(brand.id)
  if (!ph) return NextResponse.json({ connected: false })

  const period = request.nextUrl.searchParams.get('period')
  const days = period === '1d' ? 1 : period === '30d' ? 30 : 7

  // One row per new person: their first pageview in the period (= the landing), plus page count.
  // "New" = PostHog created the person in the period.
  const rows = await ph.q(`
    SELECT
      min(timestamp),
      argMin(coalesce(toString(properties.$host), ''), timestamp),
      argMin(coalesce(toString(properties.$pathname), ''), timestamp),
      argMin(coalesce(toString(properties.$referring_domain), ''), timestamp),
      argMin(coalesce(toString(properties.utm_source), ''), timestamp),
      argMin(coalesce(toString(properties.utm_medium), ''), timestamp),
      argMin(coalesce(toString(properties.utm_campaign), ''), timestamp),
      argMin(if(isNotNull(properties.gclid) OR isNotNull(properties.fbclid) OR isNotNull(properties.msclkid), 1, 0), timestamp),
      argMin(coalesce(toString(properties.$browser), ''), timestamp),
      argMin(coalesce(toString(properties.$os), ''), timestamp),
      argMin(coalesce(toString(properties.$device_type), ''), timestamp),
      argMin(coalesce(toString(properties.$geoip_country_name), ''), timestamp),
      count(),
      any(if(isNotNull(person.properties.email) OR isNotNull(person.properties.$email), 1, 0))
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - interval ${days} day
      AND person.created_at >= now() - interval ${days} day
    GROUP BY person_id
    ORDER BY min(timestamp) DESC
    LIMIT 20000
  `)
  if (rows === null) return NextResponse.json({ connected: true, error: 'query_failed' })

  const ownHost = brand.websiteUrl ? hostOfUrl(brand.websiteUrl.startsWith('http') ? brand.websiteUrl : `https://${brand.websiteUrl}`) : ''
  const ownRoot = ownHost ? rootDomain(ownHost) : ''
  // Show the host in front of the page only when visits land on more than one site (website + app)
  const hosts = new Set(rows.map(r => s(r[1]).replace(/^www\./, '')).filter(Boolean))
  const multiHost = hosts.size > 1

  const visitors: NewVisitor[] = rows.map(r => {
    const host = s(r[1]).replace(/^www\./, '')
    const path = s(r[2]) || '/'
    const ref = s(r[3]).replace(/^www\./, '')
    const utmSource = s(r[4]), utmMedium = s(r[5]), campaign = s(r[6])
    const channel = classifyChannel({ referringDomain: ref, utmSource, utmMedium, paidClick: Number(r[7]) === 1 }, ownRoot, ownHost)
    const from = utmSource
      ? [utmSource, campaign].filter(Boolean).join(' · ')
      : ref && ref !== '$direct' ? ref : 'Direct / typed in'
    return {
      at: s(r[0]),
      landing: multiHost && host ? `${host}${path}` : path,
      channel, from,
      browser: s(r[8]) || 'Unknown',
      os: s(r[9]) || 'Unknown',
      device: s(r[10]) || 'Unknown',
      country: s(r[11]) || 'Unknown',
      pages: Number(r[12]) || 1,
      signedUp: Number(r[13]) === 1,
    }
  })

  const by = (k: (v: NewVisitor) => string, limit = 8) => tally(visitors.map(v => ({ key: k(v), signedUp: v.signedUp })), limit)
  const total = visitors.length

  return NextResponse.json({
    connected: true,
    days,
    total,
    signedUp: visitors.filter(v => v.signedUp).length,
    onePage: visitors.filter(v => v.pages <= 1).length,
    landing: by(v => v.landing, 10),
    channels: by(v => v.channel),
    sources: by(v => v.from, 10).filter(c => c.name !== 'Direct / typed in'),
    browsers: by(v => v.browser),
    os: by(v => v.os),
    devices: by(v => v.device),
    countries: by(v => v.country),
    recent: visitors.slice(0, 50),
    truncated: total >= 20000,
  })
}
