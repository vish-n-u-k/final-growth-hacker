import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { CampaignBrief } from '@/components/MetaAdLaunchPanel'

export const maxDuration = 120

const GRAPH = 'https://graph.facebook.com/v23.0'

// All requests use Authorization header — token never goes in request body
function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
}

async function graphGet(path: string, token: string): Promise<unknown> {
  const res = await fetch(`${GRAPH}${path}`, { headers: authHeaders(token) })
  const data = await res.json() as { error?: { message: string; code?: number } }
  if (!res.ok || data.error) {
    console.error(`[launch-campaign] graphGet ${path} failed:`, JSON.stringify(data.error))
    throw new Error(data.error?.message ?? `Graph API GET error on ${path}: ${res.status}`)
  }
  return data
}

async function graphPost(path: string, body: Record<string, unknown>, token: string): Promise<unknown> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  })
  const data = await res.json() as { id?: string; error?: { message: string; code?: number; error_subcode?: number; error_user_msg?: string } }
  if (!res.ok || data.error) {
    console.error(`[launch-campaign] graphPost ${path} failed:`, JSON.stringify(data.error))
    throw new Error(data.error?.message ?? `Graph API error on ${path}: ${res.status}`)
  }
  return data
}

// Resolve interest name → Meta interest ID via targeting search
// Falls back to omitting interests entirely if lookup fails (safer than sending bad data)
async function resolveInterestIds(names: string[], token: string): Promise<{ id: string; name: string }[]> {
  const results: { id: string; name: string }[] = []
  for (const name of names) {
    try {
      const res = await fetch(
        `${GRAPH}/search?type=adinterest&q=${encodeURIComponent(name)}&limit=1&locale=en_US`,
        { headers: authHeaders(token) },
      )
      const data = await res.json() as { data?: { id: string; name: string }[] }
      const match = data.data?.[0]
      if (match) {
        results.push({ id: match.id, name: match.name })
        console.log(`[launch-campaign] interest "${name}" → id ${match.id} ("${match.name}")`)
      } else {
        console.warn(`[launch-campaign] no interest found for "${name}", skipping`)
      }
    } catch (e) {
      console.warn(`[launch-campaign] interest lookup failed for "${name}":`, e)
    }
  }
  return results
}

// All objectives map to OUTCOME_TRAFFIC + LINK_CLICKS — the only combination confirmed
// to work without pixel event data or special account setup. User can change in Ads Manager.
const OBJECTIVE_MAP: Record<string, string> = {
  CONVERSIONS: 'OUTCOME_TRAFFIC',
  TRAFFIC: 'OUTCOME_TRAFFIC',
  LEAD_GENERATION: 'OUTCOME_TRAFFIC',
  AWARENESS: 'OUTCOME_TRAFFIC',
}

const OPTIMIZATION_GOAL_MAP: Record<string, string> = {
  OUTCOME_TRAFFIC: 'LINK_CLICKS',
}

const BILLING_EVENT_MAP: Record<string, string> = {
  LINK_CLICKS: 'IMPRESSIONS',
}

// Minor unit multiplier per currency (most are ×100, some are ×1)
// https://developers.facebook.com/docs/marketing-api/currencies
const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF'])

function budgetInMinorUnits(amountUsd: number, currency: string): number {
  // If account currency is not USD, we're passing the same numeric value but in the
  // account's currency. The brief's dailyBudgetUsd is treated as the face value.
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())
    ? Math.round(amountUsd)
    : Math.round(amountUsd * 100)
}

function isVideo(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { moduleId: string; brief: CampaignBrief; imageUrls: string[] }
  const { moduleId, brief, imageUrls } = body

  if (!moduleId || !brief || !imageUrls?.length) {
    return NextResponse.json({ error: 'moduleId, brief, and imageUrls are required' }, { status: 400 })
  }

  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1)
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId)).limit(1)
  if (!brand || brand.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [metaInt] = await db
    .select()
    .from(brandIntegrations)
    .where(and(
      eq(brandIntegrations.brandId, brand.id),
      eq(brandIntegrations.provider, 'meta_ads'),
      eq(brandIntegrations.status, 'connected'),
    ))
    .limit(1)

  if (!metaInt?.accessToken) {
    return NextResponse.json({ error: 'Meta Ads is not connected. Go to Settings → Integrations.' }, { status: 400 })
  }

  const accessToken = metaInt.accessToken
  const meta = metaInt.metadata as Record<string, string> | null
  const adAccountId = meta?.['ad_account_id'] ?? ''
  const pageId = meta?.['page_id'] ?? (mod.requirements as Record<string, string> | null)?.['page_id'] ?? ''

  console.log('[launch-campaign] adAccountId:', adAccountId || '(empty)')
  console.log('[launch-campaign] pageId:', pageId || '(empty)')
  console.log('[launch-campaign] brief.objective:', brief?.objective)
  console.log('[launch-campaign] imageUrls:', imageUrls)

  if (!adAccountId) return NextResponse.json({ error: 'Ad account ID not found. Re-connect Meta Ads in Settings.' }, { status: 400 })
  if (!pageId) return NextResponse.json({ error: 'Facebook Page ID is required. Add it in Settings → Meta Ads → Page ID.' }, { status: 400 })

  const actId = `act_${adAccountId.replace(/^act_/, '')}`
  const graphObjective = OBJECTIVE_MAP[brief.objective] ?? 'OUTCOME_TRAFFIC'
  const optimizationGoal = OPTIMIZATION_GOAL_MAP[graphObjective] ?? 'LINK_CLICKS'
  const billingEvent = BILLING_EVENT_MAP[optimizationGoal] ?? 'IMPRESSIONS'
  const siteUrl = brand.websiteUrl ?? 'https://example.com'

  try {
    // 0. Fetch account currency + minimum daily budget
    const accountInfo = await graphGet(`/${actId}?fields=currency,min_daily_budget`, accessToken) as { currency?: string; min_daily_budget?: number }
    const currency = accountInfo.currency ?? 'USD'
    const minDailyBudget = accountInfo.min_daily_budget ?? 0  // already in minor units
    console.log('[launch-campaign] account currency:', currency, 'min_daily_budget:', minDailyBudget)

    // 0b. Fetch first pixel for this ad account (needed for OUTCOME_SALES / OUTCOME_LEADS)
    let pixelId: string | null = null
    try {
      const pixelData = await graphGet(`/${actId}/adspixels?fields=id,name&limit=1`, accessToken) as { data?: { id: string; name: string }[] }
      pixelId = pixelData.data?.[0]?.id ?? null
      console.log('[launch-campaign] pixelId:', pixelId ?? '(none found)')
    } catch (e) {
      console.warn('[launch-campaign] could not fetch pixel:', e)
    }

    // 0c. Resolve interest names → IDs
    const resolvedInterests = await resolveInterestIds(brief.audience.interests, accessToken)

    // 1. Create campaign
    console.log('[launch-campaign] step 1 — creating campaign, objective:', graphObjective)
    const campaign = await graphPost(`/${actId}/campaigns`, {
      name: brief.campaignName,
      objective: graphObjective,
      status: 'PAUSED',
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    }, accessToken) as { id: string }
    console.log('[launch-campaign] step 1 done — campaignId:', campaign.id)

    // 2. Create ad set
    const targeting: Record<string, unknown> = {
      age_min: brief.audience.ageMin,
      age_max: brief.audience.ageMax,
      genders: brief.audience.genders,
      geo_locations: { countries: brief.audience.countries },
      targeting_automation: { advantage_audience: 0 },
    }
    if (resolvedInterests.length > 0) {
      targeting.interests = resolvedInterests.map((i) => ({ id: i.id }))
    }

    const rawBudget = budgetInMinorUnits(brief.dailyBudgetUsd, currency)
    const dailyBudget = Math.max(rawBudget, minDailyBudget + 1)
    console.log('[launch-campaign] step 2 — creating ad set, budget:', dailyBudget, currency, '(raw:', rawBudget, 'min:', minDailyBudget, ')')
    const adSet = await graphPost(`/${actId}/adsets`, {
      name: `${brief.campaignName} — Ad Set`,
      campaign_id: campaign.id,
      daily_budget: dailyBudget,
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      status: 'PAUSED',
    }, accessToken) as { id: string }
    console.log('[launch-campaign] step 2 done — adSetId:', adSet.id)

    // 3 + 4. Upload media and build creative spec
    const usingVideo = isVideo(imageUrls[0])
    let creativeSpec: Record<string, unknown>

    if (usingVideo) {
      console.log('[launch-campaign] step 3 — uploading', imageUrls.length, 'video(s)')
      const videoIds: string[] = await Promise.all(
        imageUrls.map(async (url) => {
          const uploadData = await graphPost(`/${actId}/advideos`, { file_url: url }, accessToken) as { id?: string }
          console.log('[launch-campaign] video upload response:', JSON.stringify(uploadData))
          if (!uploadData.id) throw new Error('No video ID returned from Meta')
          return uploadData.id
        }),
      )
      console.log('[launch-campaign] step 3 done — videoIds:', videoIds)

      // Poll for auto-generated thumbnail — Meta needs a few seconds to process the video
      let thumbnailUrl: string | null = null
      for (let attempt = 0; attempt < 6; attempt++) {
        await new Promise((r) => setTimeout(r, 3000))
        try {
          const thumbData = await graphGet(`/${videoIds[0]}/thumbnails?fields=uri&limit=1`, accessToken) as { data?: { uri: string }[] }
          thumbnailUrl = thumbData.data?.[0]?.uri ?? null
          console.log(`[launch-campaign] thumbnail attempt ${attempt + 1}:`, thumbnailUrl ?? '(none yet)')
          if (thumbnailUrl) break
        } catch (e) {
          console.warn(`[launch-campaign] thumbnail attempt ${attempt + 1} failed:`, e)
        }
      }
      if (!thumbnailUrl) {
        throw new Error('Video thumbnail not ready after 18 seconds. Try again in a moment — Meta is still processing the video.')
      }

      if (brief.creative.adType === 'carousel' && videoIds.length > 1) {
        console.warn('[launch-campaign] carousel video creative not yet implemented — using first video as single ad')
      }

      // Single video creative
      creativeSpec = {
        object_story_spec: {
          page_id: pageId,
          video_data: {
            video_id: videoIds[0],
            title: brief.adCopy.headline,
            message: brief.adCopy.body,
            call_to_action: { type: brief.adCopy.cta, value: { link: siteUrl } },
            ...(thumbnailUrl ? { image_url: thumbnailUrl } : {}),
          },
        },
      }
    } else {
      console.log('[launch-campaign] step 3 — uploading', imageUrls.length, 'image(s)')
      const imageHashes: string[] = await Promise.all(
        imageUrls.map(async (url) => {
          const uploadData = await graphPost(`/${actId}/adimages`, { url }, accessToken) as { images?: Record<string, { hash: string }> }
          console.log('[launch-campaign] image upload response:', JSON.stringify(uploadData))
          const images = uploadData.images ?? {}
          const firstKey = Object.keys(images)[0]
          if (!firstKey) throw new Error('No image hash returned from Meta')
          return images[firstKey].hash
        }),
      )
      console.log('[launch-campaign] step 3 done — imageHashes:', imageHashes)

      if (brief.creative.adType === 'carousel' && imageHashes.length > 1) {
        creativeSpec = {
          object_story_spec: {
            page_id: pageId,
            link_data: {
              message: brief.adCopy.body,
              link: siteUrl,
              call_to_action: { type: brief.adCopy.cta, value: { link: siteUrl } },
              child_attachments: imageHashes.map((hash, i) => ({
                link: siteUrl,
                name: `${brief.adCopy.headline} ${i + 1}`,
                image_hash: hash,
                call_to_action: { type: brief.adCopy.cta },
              })),
            },
          },
        }
      } else {
        creativeSpec = {
          object_story_spec: {
            page_id: pageId,
            link_data: {
              message: brief.adCopy.body,
              name: brief.adCopy.headline,
              image_hash: imageHashes[0],
              link: siteUrl,
              call_to_action: { type: brief.adCopy.cta, value: { link: siteUrl } },
            },
          },
        }
      }
    }

    // 4. Create ad creative
    console.log('[launch-campaign] step 4 — creating creative')
    const creative = await graphPost(`/${actId}/adcreatives`, {
      name: `${brief.campaignName} — Creative`,
      ...creativeSpec,
    }, accessToken) as { id: string }
    console.log('[launch-campaign] step 4 done — creativeId:', creative.id)

    // 5. Create ad
    console.log('[launch-campaign] step 5 — creating ad')
    const ad = await graphPost(`/${actId}/ads`, {
      name: `${brief.campaignName} — Ad`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    }, accessToken) as { id: string }
    console.log('[launch-campaign] step 5 done — adId:', ad.id)

    const cleanAccountId = adAccountId.replace(/^act_/, '')
    return NextResponse.json({
      campaignId: campaign.id,
      adSetId: adSet.id,
      creativeId: creative.id,
      adId: ad.id,
      adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${cleanAccountId}`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Meta campaign creation failed'
    console.error('[launch-campaign] failed:', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
