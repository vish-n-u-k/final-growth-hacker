import { callAI } from '@/lib/ai/client'
import { META_ADS_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { MetaAdsFetchResult, MetaCampaign, MetaCampaignInsight, MetaTrackingStatus } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

// ── Format helpers ─────────────────────────────────────────────────────────────

function formatCampaigns(
  campaigns: MetaCampaign[],
  insights: MetaCampaignInsight[],
): string {
  const insightMap = new Map(insights.map((i) => [i.campaignId, i]))

  return campaigns
    .map((c) => {
      const insight = insightMap.get(c.id)
      const budgetStr =
        c.dailyBudgetUsd !== null ? `$${c.dailyBudgetUsd.toFixed(2)}/day` : 'unknown'

      if (!insight) {
        return [
          `Campaign: "${c.name}"`,
          `  Status: ${c.status} | Objective: ${c.objective} | Daily budget: ${budgetStr}`,
          `  7-day performance: No data (campaign may be inactive or outside date range)`,
        ].join('\n')
      }

      return [
        `Campaign: "${c.name}"`,
        `  Status: ${c.status} | Objective: ${c.objective} | Daily budget: ${budgetStr}`,
        `  Spend (7d): $${insight.spend.toFixed(2)}`,
        `  Impressions: ${insight.impressions.toLocaleString()} | Reach: ${insight.reach.toLocaleString()}`,
        `  Clicks: ${insight.clicks.toLocaleString()} | CTR: ${insight.ctr.toFixed(2)}%`,
        `  CPC: $${insight.cpc.toFixed(2)} | CPM: $${insight.cpm.toFixed(2)}`,
        `  Frequency: ${insight.frequency.toFixed(2)}`,
        `  Total conversions/actions: ${insight.totalActions}`,
      ].join('\n')
    })
    .join('\n\n')
}

function formatTracking(t: MetaTrackingStatus): string {
  const lines: string[] = []
  lines.push(`Pixel installed: ${t.hasPixel ? `yes (${t.pixelCount} pixel${t.pixelCount !== 1 ? 's' : ''})` : 'NO — no pixel found on this account'}`)
  if (t.hasPixel) {
    lines.push(`Primary pixel: "${t.primaryPixelName}" (${t.primaryPixelId})`)
    if (t.lastFiredTime) {
      const daysAgo = Math.floor((Date.now() - new Date(t.lastFiredTime).getTime()) / (24 * 60 * 60 * 1000))
      lines.push(`Last pixel fire: ${daysAgo === 0 ? 'today' : `${daysAgo} day${daysAgo !== 1 ? 's' : ''} ago`}${t.pixelStale ? ' — STALE (>7 days)' : ' — fresh'}`)
    } else {
      lines.push('Last pixel fire: never fired — pixel may not be installed on the website')
    }
  }
  if (t.hasCapi === true) lines.push('Conversions API (CAPI): configured and active')
  else if (t.hasCapi === false) lines.push('Conversions API (CAPI): NOT configured — server-side event tracking is missing')
  else lines.push('Conversions API (CAPI): could not determine status')
  if (t.pixelInHtml === true) lines.push('Meta Pixel in website HTML: YES — fbevents.js script found on the page')
  else if (t.pixelInHtml === false) lines.push('Meta Pixel in website HTML: NO — pixel base code not detected in page source')
  else lines.push('Meta Pixel in website HTML: could not check (no website URL or fetch failed)')
  if (t.sdkInHtml === true) lines.push('Meta SDK (Facebook JS SDK): YES — sdk.js / FB.init found on the page')
  else if (t.sdkInHtml === false) lines.push('Meta SDK (Facebook JS SDK): not detected')
  return lines.join('\n')
}

function buildPrompt(data: MetaAdsFetchResult, brainContext?: string): string {
  const categories = META_ADS_MODULE.categories as DynamicModuleCategoryDefinition[]

  const campaignSection = formatCampaigns(data.campaigns, data.insights)

  const categoryInstructions = categories
    .map((c) => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  return `${brainContext ? `=== Prior context about this brand ===\n${brainContext}\n\n` : ''}=== Brand Context ===
Brand: ${data.brandName || 'not provided'}

=== Tracking Setup ===
${formatTracking(data.tracking)}

=== Account-Level Summary (last 7 days) ===
Total spend: $${data.totalSpend.toFixed(2)}
Total impressions: ${data.totalImpressions.toLocaleString()}
Total clicks: ${data.totalClicks.toLocaleString()}
Total unique reach: ${data.totalReach.toLocaleString()}
Total conversions/actions: ${data.totalActions}
Account avg CTR: ${data.avgCtr.toFixed(2)}% (benchmark: 0.90%)
Account avg CPC: $${data.avgCpc.toFixed(2)} (benchmark: $1.72)
Account avg CPM: $${data.avgCpm.toFixed(2)} (benchmark: $14.40)
Account avg frequency: ${data.avgFrequency.toFixed(2)} (healthy: <3.0 | fatigue: >5.0)
Active campaigns: ${data.campaigns.filter((c) => c.status === 'ACTIVE').length}
Paused campaigns: ${data.campaigns.filter((c) => c.status === 'PAUSED').length}

=== Campaign Breakdown ===

${campaignSection}

=== Category Instructions ===
${categoryInstructions}

=== Output requirements ===
Analyse all campaign and tracking data above. Generate findings for ALL 7 categories listed.

Return ONLY a valid JSON array. No markdown fences, no text outside the array. Each element:
{
  "category": string — exactly one of: "campaign-performance", "budget-efficiency", "audience-reach", "conversion-performance", "tracking-setup", "meta-score", "next-campaign",
  "slug": string — kebab-case, pattern: {category-slug}-{short-descriptor},
  "label": string — plain English, no ad jargon; cite actual campaign names; describe what is happening in simple terms,
  "weight": 1 | 2 | 3,
  "detail": string — one plain English sentence explaining the finding; wrap the single most important number or campaign name in **double asterisks**,
  "highlight": string — 5–8 plain English words capturing the key point; no jargon, no period,
  "narrative": string — exactly 1 plain English sentence explaining what this means for the business budget or results; wrap the key impact in **double asterisks**,
  "action": string — specific step inside Meta Ads Manager; technical ad terms and metrics allowed here; wrap the specific setting or campaign name in **double asterisks**,
  "verified": boolean — true if this check passes or metric beats benchmark | false if gap exists,
  "fixable": false
}`
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function analyzeMetaAds(
  data: MetaAdsFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const prompt = buildPrompt(data, brainContext)

  const raw = await callAI({
    system: META_ADS_MODULE.systemPrompt,
    prompt,
    maxTokens: 8000,
    model: 'claude-haiku-4-5-20251001',
  })

  let results: DynamicModuleAnalysisResult[]
  try {
    results = parseClaudeJsonArray(raw) as DynamicModuleAnalysisResult[]
  } catch (err) {
    throw new Error(`Meta Ads agent returned invalid JSON: ${err instanceof Error ? err.message : raw.slice(0, 300)}`)
  }

  const allowed = new Set([
    'campaign-performance',
    'budget-efficiency',
    'audience-reach',
    'conversion-performance',
    'tracking-setup',
    'meta-score',
    'next-campaign',
  ])

  return results
    .filter(
      (r) =>
        typeof r.category === 'string' &&
        allowed.has(r.category) &&
        typeof r.slug === 'string' &&
        typeof r.label === 'string' &&
        (r.weight === 1 || r.weight === 2 || r.weight === 3) &&
        typeof r.detail === 'string' &&
        typeof r.narrative === 'string' &&
        typeof r.action === 'string' &&
        typeof r.verified === 'boolean',
    )
    .map((r) => ({ ...r, fixable: false }))
}
