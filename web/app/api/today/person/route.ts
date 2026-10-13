import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getBrandForUser } from '@/lib/server-session'
import { posthogForBrand } from '@/lib/posthog/client'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Everything PostHog knows about one person, for the signup details on Today.

export interface PersonDetail {
  name: string
  email: string
  signedUpAt: string
  foundVia: string            // plain-English "how they found you"
  source: { utmSource: string; utmMedium: string; utmCampaign: string; referrer: string; landing: string }
  location: { country: string; city: string }
  device: { type: string; os: string; browser: string }
  activity: { events: number; sessions: number; pageviews: number; firstSeen: string; lastSeen: string }
  recent: { at: string; label: string }[]
}

const SEARCH = ['google', 'bing', 'duckduckgo', 'yahoo', 'baidu', 'yandex', 'ecosia', 'brave']
const SOCIAL: [string, string][] = [
  ['facebook', 'Facebook'], ['instagram', 'Instagram'], ['linkedin', 'LinkedIn'], ['lnkd.in', 'LinkedIn'],
  ['t.co', 'X (Twitter)'], ['twitter', 'X (Twitter)'], ['x.com', 'X (Twitter)'], ['reddit', 'Reddit'],
  ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['pinterest', 'Pinterest'], ['producthunt', 'Product Hunt'],
  ['news.ycombinator', 'Hacker News'], ['chatgpt', 'ChatGPT'], ['perplexity', 'Perplexity'],
]

function foundVia(p: { utmSource: string; utmMedium: string; utmCampaign: string; domain: string }, ownHost: string): string {
  const campaign = p.utmCampaign ? ` (campaign “${p.utmCampaign}”)` : ''
  if (p.utmSource) {
    const medium = /cpc|paid|ads?$/i.test(p.utmMedium) ? 'an ad on' : p.utmMedium === 'email' ? 'an email from' : 'a link from'
    return `Clicked ${medium} ${p.utmSource}${campaign}`
  }
  const d = p.domain.toLowerCase().replace(/^www\./, '')
  if (!d || d === '$direct') return 'Came directly (typed your address, a bookmark or an app link)'
  if (ownHost && d.endsWith(ownHost)) return 'Came from your website'
  const engine = SEARCH.find(s => d.includes(s))
  if (engine) return `Found you on ${engine[0].toUpperCase()}${engine.slice(1)} search`
  const social = SOCIAL.find(([k]) => d.includes(k))
  if (social) return `Clicked a link on ${social[1]}`
  return `Clicked a link on ${d}`
}

const EVENT_LABELS: Record<string, string> = {
  $pageview: 'Viewed', $identify: 'Signed in', $screen: 'Opened screen',
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const brand = await getBrandForUser(user.id)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Invalid person' }, { status: 400 })

  const ph = await posthogForBrand(brand.id)
  if (!ph) return NextResponse.json({ error: 'PostHog is not connected' }, { status: 404 })

  const [personRows, activityRows, recentRows] = await Promise.all([
    ph.q(`SELECT coalesce(toString(properties.$name), ''), coalesce(toString(properties.$email), ''), toString(created_at),
                 coalesce(toString(properties.$initial_utm_source), ''), coalesce(toString(properties.$initial_utm_medium), ''),
                 coalesce(toString(properties.$initial_utm_campaign), ''), coalesce(toString(properties.$initial_referring_domain), ''),
                 coalesce(toString(properties.$initial_referrer), ''), coalesce(toString(properties.$initial_current_url), ''),
                 coalesce(toString(properties.$geoip_country_name), ''), coalesce(toString(properties.$geoip_city_name), ''),
                 coalesce(toString(properties.$initial_device_type), toString(properties.$device_type), ''),
                 coalesce(toString(properties.$initial_os), toString(properties.$os), ''),
                 coalesce(toString(properties.$initial_browser), toString(properties.$browser), '')
          FROM persons WHERE id = '${id}' LIMIT 1`),
    ph.q(`SELECT count(), count(DISTINCT $session_id), countIf(event = '$pageview'), toString(min(timestamp)), toString(max(timestamp))
          FROM events WHERE person_id = '${id}' AND timestamp >= now() - interval 90 day`),
    ph.q(`SELECT toString(timestamp), event, coalesce(toString(properties.$pathname), '')
          FROM events WHERE person_id = '${id}' AND timestamp >= now() - interval 90 day
          AND event NOT IN ('$autocapture', '$pageleave', '$web_vitals', '$feature_flag_called', '$set', '$exception', '$rageclick', '$dead_click', '$heatmap')
          ORDER BY timestamp DESC LIMIT 12`),
  ])

  const r = personRows?.[0]
  if (!r) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const s = (i: number) => String(r[i] ?? '')
  const ownHost = (() => {
    try { return new URL(brand.websiteUrl).hostname.replace(/^www\./, '') } catch { return '' }
  })()
  const a = activityRows?.[0] ?? []

  const detail: PersonDetail = {
    name: s(0),
    email: s(1),
    signedUpAt: s(2),
    foundVia: foundVia({ utmSource: s(3), utmMedium: s(4), utmCampaign: s(5), domain: s(6) }, ownHost),
    source: { utmSource: s(3), utmMedium: s(4), utmCampaign: s(5), referrer: s(7) === '$direct' ? '' : s(7), landing: s(8) },
    location: { country: s(9), city: s(10) },
    device: { type: s(11), os: s(12), browser: s(13) },
    activity: {
      events: Number(a[0] ?? 0) || 0,
      sessions: Number(a[1] ?? 0) || 0,
      pageviews: Number(a[2] ?? 0) || 0,
      firstSeen: String(a[3] ?? ''),
      lastSeen: String(a[4] ?? ''),
    },
    recent: (recentRows ?? []).map(e => {
      const event = String(e[1])
      const path = String(e[2])
      const label = event in EVENT_LABELS
        ? `${EVENT_LABELS[event]}${path ? ` ${path}` : ''}`
        : event.replace(/^\$/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
      return { at: String(e[0]), label }
    }),
  }
  return NextResponse.json(detail)
}
