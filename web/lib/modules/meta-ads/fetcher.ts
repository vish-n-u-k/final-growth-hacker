const META_BASE = 'https://graph.facebook.com/v23.0'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MetaCampaign {
  id: string
  name: string
  objective: string
  status: string
  dailyBudgetUsd: number | null
}

export interface MetaCampaignInsight {
  campaignId: string
  campaignName: string
  spend: number
  impressions: number
  clicks: number
  ctr: number
  cpc: number
  cpm: number
  frequency: number
  reach: number
  totalActions: number
}

export interface MetaAdsFetchResult {
  brandName: string
  campaigns: MetaCampaign[]
  insights: MetaCampaignInsight[]
  totalSpend: number
  totalImpressions: number
  totalClicks: number
  totalReach: number
  totalActions: number
  avgCtr: number
  avgCpc: number
  avgCpm: number
  avgFrequency: number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

async function safeFetch(url: string): Promise<unknown> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    return await res.json()
  } catch {
    return null
  }
}

function checkForApiError(data: unknown): string | null {
  const d = data as { error?: { message: string; code: number } } | null
  if (!d?.error) return null
  if (d.error.code === 190) return 'META_TOKEN_EXPIRED'
  if (d.error.code === 200) {
    return `Insufficient permissions: ${d.error.message}. Ensure the token has ads_read permission.`
  }
  return d.error.message
}

// ── Main fetcher ───────────────────────────────────────────────────────────────

export async function fetchMetaAdsData(
  requirements: Record<string, string>,
): Promise<MetaAdsFetchResult> {
  const accessToken = requirements['access_token'] ?? ''
  const rawAccountId = requirements['ad_account_id'] ?? ''
  const brandName = requirements['brand_name'] ?? ''

  if (!accessToken || !rawAccountId) {
    throw new Error('Meta Ads credentials not provided. Please add your Access Token and Ad Account ID.')
  }

  // Normalise account ID — strip act_ prefix, it gets added in URL construction
  const accountId = rawAccountId.replace(/^act_/, '')

  // Validate token first
  const meData = await safeFetch(
    `${META_BASE}/me?access_token=${encodeURIComponent(accessToken)}`,
  )
  const meError = checkForApiError(meData)
  if (meError === 'META_TOKEN_EXPIRED') {
    throw new Error('Access token expired or invalid. Please update your Meta Ads credentials.')
  }
  if (meError) {
    throw new Error(`Meta API error: ${meError}`)
  }

  // Fetch campaigns and insights in parallel
  const campaignsUrl = `${META_BASE}/act_${accountId}/campaigns?fields=id,name,objective,status,daily_budget&access_token=${encodeURIComponent(accessToken)}`
  const insightsUrl = `${META_BASE}/act_${accountId}/insights?level=campaign&date_preset=last_7d&fields=campaign_id,campaign_name,spend,impressions,clicks,ctr,cpc,cpm,frequency,reach,actions&access_token=${encodeURIComponent(accessToken)}`

  const [campaignsRaw, insightsRaw] = await Promise.all([
    safeFetch(campaignsUrl),
    safeFetch(insightsUrl),
  ])

  const campaignError = checkForApiError(campaignsRaw)
  if (campaignError === 'META_TOKEN_EXPIRED') throw new Error('Access token expired or invalid. Please update your Meta Ads credentials.')
  if (campaignError) throw new Error(`Campaigns fetch failed: ${campaignError}`)

  const insightError = checkForApiError(insightsRaw)
  if (insightError === 'META_TOKEN_EXPIRED') throw new Error('Access token expired or invalid. Please update your Meta Ads credentials.')
  if (insightError) throw new Error(`Insights fetch failed: ${insightError}`)

  // Parse campaigns
  const campaignData = (campaignsRaw as {
    data?: {
      id: string
      name: string
      objective: string
      status: string
      daily_budget?: string
    }[]
  } | null)?.data ?? []

  const campaigns: MetaCampaign[] = campaignData.map((c) => ({
    id: c.id,
    name: c.name,
    objective: c.objective,
    status: c.status,
    dailyBudgetUsd: c.daily_budget ? parseInt(c.daily_budget) / 100 : null,
  }))

  // Parse insights — actions is an array of { action_type, value }, sum all into one total
  const insightData = (insightsRaw as {
    data?: {
      campaign_id: string
      campaign_name: string
      spend: string
      impressions: string | number
      clicks: string | number
      ctr: string
      cpc: string
      cpm: string
      frequency: string
      reach: string | number
      actions?: { action_type: string; value: string }[]
    }[]
  } | null)?.data ?? []

  const insights: MetaCampaignInsight[] = insightData.map((i) => {
    const totalActions = Array.isArray(i.actions)
      ? i.actions.reduce((sum, a) => sum + parseInt(a.value || '0'), 0)
      : 0

    return {
      campaignId: i.campaign_id,
      campaignName: i.campaign_name,
      spend: parseFloat(i.spend ?? '0'),
      impressions: parseInt(String(i.impressions ?? '0')),
      clicks: parseInt(String(i.clicks ?? '0')),
      ctr: parseFloat(i.ctr ?? '0'),
      cpc: parseFloat(i.cpc ?? '0'),
      cpm: parseFloat(i.cpm ?? '0'),
      frequency: parseFloat(i.frequency ?? '0'),
      reach: parseInt(String(i.reach ?? '0')),
      totalActions,
    }
  })

  // Account-level aggregates
  const totalSpend = insights.reduce((s, i) => s + i.spend, 0)
  const totalImpressions = insights.reduce((s, i) => s + i.impressions, 0)
  const totalClicks = insights.reduce((s, i) => s + i.clicks, 0)
  const totalReach = insights.reduce((s, i) => s + i.reach, 0)
  const totalActions = insights.reduce((s, i) => s + i.totalActions, 0)

  const avgCtr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0
  const avgCpc = totalClicks > 0 ? totalSpend / totalClicks : 0
  const avgCpm = totalImpressions > 0 ? (totalSpend / totalImpressions) * 1000 : 0
  const avgFrequency =
    insights.length > 0
      ? insights.reduce((s, i) => s + i.frequency, 0) / insights.length
      : 0

  return {
    brandName,
    campaigns,
    insights,
    totalSpend,
    totalImpressions,
    totalClicks,
    totalReach,
    totalActions,
    avgCtr: Math.round(avgCtr * 100) / 100,
    avgCpc: Math.round(avgCpc * 100) / 100,
    avgCpm: Math.round(avgCpm * 100) / 100,
    avgFrequency: Math.round(avgFrequency * 100) / 100,
  }
}
