import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { db } from '@/lib/db'
import { brands, modules, brandIntegrations } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { CampaignBrief } from '@/components/MetaAdLaunchPanel'

export const maxDuration = 60

const GRAPH = 'https://graph.facebook.com/v23.0'

async function graphPost(path: string, body: Record<string, unknown>, token: string): Promise<unknown> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, access_token: token }),
  })
  const data = await res.json() as { id?: string; error?: { message: string } }
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Graph API error on ${path}: ${res.status}`)
  }
  return data
}

// Map Meta objective strings to Graph API v23.0 campaign objectives
const OBJECTIVE_MAP: Record<string, string> = {
  CONVERSIONS: 'OUTCOME_SALES',
  TRAFFIC: 'OUTCOME_TRAFFIC',
  LEAD_GENERATION: 'OUTCOME_LEADS',
  AWARENESS: 'OUTCOME_AWARENESS',
}

// Map optimization goal per objective
const OPTIMIZATION_GOAL_MAP: Record<string, string> = {
  OUTCOME_SALES: 'OFFSITE_CONVERSIONS',
  OUTCOME_TRAFFIC: 'LINK_CLICKS',
  OUTCOME_LEADS: 'LEAD_GENERATION',
  OUTCOME_AWARENESS: 'REACH',
}

// Map billing event per optimization goal
const BILLING_EVENT_MAP: Record<string, string> = {
  OFFSITE_CONVERSIONS: 'IMPRESSIONS',
  LINK_CLICKS: 'LINK_CLICKS',
  LEAD_GENERATION: 'IMPRESSIONS',
  REACH: 'IMPRESSIONS',
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

  // Load module + brand
  const [mod] = await db.select().from(modules).where(eq(modules.id, moduleId)).limit(1)
  if (!mod) return NextResponse.json({ error: 'Module not found' }, { status: 404 })

  const [brand] = await db.select().from(brands).where(eq(brands.id, mod.brandId)).limit(1)
  if (!brand || brand.userId !== user.id) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Load meta_ads integration for access_token + ad_account_id
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
    return NextResponse.json(
      { error: 'Meta Ads is not connected. Go to Settings → Integrations.' },
      { status: 400 },
    )
  }

  const accessToken = metaInt.accessToken
  const adAccountId = (metaInt.metadata as Record<string, string> | null)?.['ad_account_id'] ?? ''
  const pageId = (mod.requirements as Record<string, string> | null)?.['page_id'] ?? ''

  if (!adAccountId) {
    return NextResponse.json({ error: 'Ad account ID not found. Re-connect Meta Ads in Settings.' }, { status: 400 })
  }
  if (!pageId) {
    return NextResponse.json({ error: 'Facebook Page ID is required. Add it in Settings → Meta Ads → Page ID.' }, { status: 400 })
  }

  const actId = `act_${adAccountId.replace(/^act_/, '')}`
  const graphObjective = OBJECTIVE_MAP[brief.objective] ?? 'OUTCOME_TRAFFIC'
  const optimizationGoal = OPTIMIZATION_GOAL_MAP[graphObjective] ?? 'LINK_CLICKS'
  const billingEvent = BILLING_EVENT_MAP[optimizationGoal] ?? 'IMPRESSIONS'

  try {
    // 1. Create campaign
    const campaign = await graphPost(`/${actId}/campaigns`, {
      name: brief.campaignName,
      objective: graphObjective,
      status: 'PAUSED',
      special_ad_categories: [],
    }, accessToken) as { id: string }

    // 2. Create ad set
    const targeting: Record<string, unknown> = {
      age_min: brief.audience.ageMin,
      age_max: brief.audience.ageMax,
      genders: brief.audience.genders,
      geo_locations: { countries: brief.audience.countries },
    }
    if (brief.audience.interests.length > 0) {
      targeting.interests = brief.audience.interests.map((name) => ({ name }))
    }

    const adSet = await graphPost(`/${actId}/adsets`, {
      name: `${brief.campaignName} — Ad Set`,
      campaign_id: campaign.id,
      daily_budget: Math.round(brief.dailyBudgetUsd * 100),
      billing_event: billingEvent,
      optimization_goal: optimizationGoal,
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      targeting,
      status: 'PAUSED',
    }, accessToken) as { id: string }

    // 3. Upload images to Meta and collect hashes
    const imageHashes: string[] = await Promise.all(
      imageUrls.map(async (url) => {
        const uploadRes = await fetch(
          `${GRAPH}/${actId}/adimages?url=${encodeURIComponent(url)}&access_token=${accessToken}`,
          { method: 'POST' },
        )
        const uploadData = await uploadRes.json() as { images?: Record<string, { hash: string }>; error?: { message: string } }
        if (!uploadRes.ok || uploadData.error) throw new Error(uploadData.error?.message ?? 'Image upload failed')
        const images = uploadData.images ?? {}
        const firstKey = Object.keys(images)[0]
        if (!firstKey) throw new Error('No image hash returned from Meta')
        return images[firstKey].hash
      }),
    )

    // 4. Build creative object
    let creativeSpec: Record<string, unknown>
    if (brief.creative.adType === 'carousel' && imageHashes.length > 1) {
      creativeSpec = {
        carousel_ad_data: {
          call_to_action: { type: brief.adCopy.cta },
          child_attachments: imageHashes.map((hash, i) => ({
            link: brand.websiteUrl ?? 'https://example.com',
            name: `${brief.adCopy.headline} ${i + 1}`,
            image_hash: hash,
          })),
        },
        object_story_spec: {
          page_id: pageId,
          link_data: {
            message: brief.adCopy.body,
            call_to_action: { type: brief.adCopy.cta, value: { link: brand.websiteUrl ?? 'https://example.com' } },
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
            link: brand.websiteUrl ?? 'https://example.com',
            call_to_action: { type: brief.adCopy.cta, value: { link: brand.websiteUrl ?? 'https://example.com' } },
          },
        },
      }
    }

    const creative = await graphPost(`/${actId}/adcreatives`, {
      name: `${brief.campaignName} — Creative`,
      ...creativeSpec,
    }, accessToken) as { id: string }

    // 5. Create ad
    const ad = await graphPost(`/${actId}/ads`, {
      name: `${brief.campaignName} — Ad`,
      adset_id: adSet.id,
      creative: { creative_id: creative.id },
      status: 'PAUSED',
    }, accessToken) as { id: string }

    const cleanAccountId = adAccountId.replace(/^act_/, '')
    return NextResponse.json({
      campaignId: campaign.id,
      adId: ad.id,
      adsManagerUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${cleanAccountId}`,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Meta campaign creation failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
