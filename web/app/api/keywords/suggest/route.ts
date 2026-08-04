import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, brandIntegrations, trackedKeywords } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { sql } from 'drizzle-orm'

export const maxDuration = 60

async function getGoogleAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const data = await res.json() as { access_token?: string; error_description?: string }
  if (!res.ok) throw new Error(data.error_description ?? 'Failed to get Google access token')
  return data.access_token!
}

async function fetchKeywordIdeas(
  accessToken: string,
  developerToken: string,
  customerId: string,
  seedKeywords: string[],
) {
  const url = `https://googleads.googleapis.com/v17/customers/${customerId}:generateKeywordIdeas`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'developer-token': developerToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      keywordSeed: { keywords: seedKeywords },
      geoTargetConstants: ['geoTargetConstants/2840'], // United States
      language: 'languageConstants/1000',              // English
      keywordPlanNetwork: 'GOOGLE_SEARCH',
      pageSize: 20,
    }),
  })
  if (!res.ok) {
    const err = await res.json() as { error?: { message?: string } }
    throw new Error(err.error?.message ?? 'Google Ads API error')
  }
  return await res.json() as {
    results?: {
      text: string
      keywordIdeaMetrics?: {
        avgMonthlySearches?: string
        competition?: string
        competitionIndex?: string
      }
    }[]
  }
}

function formatReason(metrics?: { avgMonthlySearches?: string; competition?: string; competitionIndex?: string }) {
  if (!metrics) return null
  const vol = metrics.avgMonthlySearches ? `~${Number(metrics.avgMonthlySearches).toLocaleString()} searches/mo` : null
  const comp = metrics.competition ? `${metrics.competition.toLowerCase()} competition` : null
  return [vol, comp].filter(Boolean).join(' · ') || null
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [brand] = await db.select().from(brands).where(eq(brands.userId, user.id)).limit(1)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  // Fetch Google Ads credentials
  const [adsRow] = await db
    .select({ metadata: brandIntegrations.metadata })
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'google_ads'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!adsRow) {
    return NextResponse.json({ error: 'Google Ads not connected' }, { status: 400 })
  }

  const meta = adsRow.metadata as Record<string, string>
  const { developer_token, client_id, client_secret, refresh_token, customer_id } = meta

  if (!developer_token || !client_id || !client_secret || !refresh_token || !customer_id) {
    return NextResponse.json({ error: 'Google Ads credentials incomplete' }, { status: 400 })
  }

  // Build seed keywords from brand info
  const seeds: string[] = [brand.name]
  if (brand.industry) seeds.push(brand.industry)
  if (brand.keywords) seeds.push(...brand.keywords.split(',').map(k => k.trim()).filter(Boolean).slice(0, 3))

  const accessToken = await getGoogleAccessToken(client_id, client_secret, refresh_token)
  const data = await fetchKeywordIdeas(accessToken, developer_token, customer_id.replace(/-/g, ''), seeds)

  const results = data.results ?? []

  // Fetch existing tracked keywords to avoid overwriting non-suggested statuses
  const existing = await db
    .select({ keyword: trackedKeywords.keyword, status: trackedKeywords.status })
    .from(trackedKeywords)
    .where(eq(trackedKeywords.brandId, brand.id))

  const blocked = new Set(
    existing.filter(e => e.status !== 'suggested').map(e => e.keyword.toLowerCase()),
  )

  const toUpsert = results.filter(r => r.text && !blocked.has(r.text.toLowerCase()))

  if (toUpsert.length > 0) {
    await db.insert(trackedKeywords)
      .values(toUpsert.map(r => ({
        brandId: brand.id,
        keyword: r.text,
        status: 'suggested' as const,
        source: 'google_ads',
        aiReason: formatReason(r.keywordIdeaMetrics),
        aiIntent: null,
      })))
      .onConflictDoUpdate({
        target: [trackedKeywords.brandId, trackedKeywords.keyword],
        set: {
          aiReason: sql`EXCLUDED.ai_reason`,
        },
      })
  }

  const suggestions = await db
    .select()
    .from(trackedKeywords)
    .where(and(eq(trackedKeywords.brandId, brand.id), eq(trackedKeywords.status, 'suggested')))

  return NextResponse.json({ suggestions })
}
