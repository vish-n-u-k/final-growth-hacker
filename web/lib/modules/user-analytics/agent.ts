import { callAI } from '@/lib/ai/client'
import { USER_ANALYTICS_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { PostHogFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(data: PostHogFetchResult, brainContext?: string): string {
  const categories = USER_ANALYTICS_MODULE.categories as DynamicModuleCategoryDefinition[]

  const dauMauRatio =
    data.dau !== null && data.mau !== null && data.mau > 0
      ? ((data.dau / data.mau) * 100).toFixed(1)
      : null

  const sessionsPerUser =
    data.sessions30d !== null && data.mau !== null && data.mau > 0
      ? (data.sessions30d / data.mau).toFixed(1)
      : null

  const newUserPct =
    data.newUsers30d !== null && data.mau !== null && data.mau > 0
      ? ((data.newUsers30d / data.mau) * 100).toFixed(1)
      : null

  // Weekly user trend: compare last 4 weeks vs previous 4 weeks
  let weeklyTrend = 'Insufficient data'
  if (data.weeklyUsers.length >= 8) {
    const recent = data.weeklyUsers.slice(-4).reduce((s, w) => s + w.users, 0)
    const previous = data.weeklyUsers.slice(-8, -4).reduce((s, w) => s + w.users, 0)
    if (previous > 0) {
      const pct = (((recent - previous) / previous) * 100).toFixed(1)
      weeklyTrend = `${pct}% vs prior 4 weeks (recent: ${recent} users, prior: ${previous} users)`
    }
  }

  const topEventsSection = data.topEvents.length > 0
    ? data.topEvents.map((e) => `  ${e.event}: ${e.count.toLocaleString()} events`).join('\n')
    : '  No event data available'

  const weeklySection = data.weeklyUsers.length > 0
    ? data.weeklyUsers.map((w) => `  ${w.week}: ${w.users} users`).join('\n')
    : '  No weekly data available'

  const funnelSection = (() => {
    if (!data.funnelResult) return '  funnelResult: null'
    const { steps, data: fsteps, overallConversionRate, autoDetected } = data.funnelResult
    const stepsStr = fsteps.map((s, i) => {
      const avgTime = s.averageConversionTimeSec != null
        ? ` | avg time to convert: ${Math.round(s.averageConversionTimeSec / 3600)}h`
        : ''
      return i === 0
        ? `  Step ${i + 1}: ${s.name} — ${s.count.toLocaleString()} users (funnel entry)`
        : `  Step ${i + 1}: ${s.name} — ${s.count.toLocaleString()} users — ${s.conversionRate}% conversion from previous step (${s.dropOffRate}% drop-off)${avgTime}`
    }).join('\n')
    return `  Funnel steps: ${steps.join(' → ')}${autoDetected ? ' (auto-detected from top events)' : ' (user-defined)'}
  Overall conversion (step 1 → last): ${overallConversionRate}%
  Critical bottleneck: ${fsteps.slice(1).sort((a, b) => a.conversionRate - b.conversionRate)[0]?.name ?? 'none'} (lowest step conversion)
${stepsStr}`
  })()

  const metricsSection = data.connected
    ? `
PostHog connected: Yes
Project ID: ${data.projectId}
Host: ${data.host}

=== Core Metrics (last 30 days) ===
Monthly Active Users (MAU): ${data.mau?.toLocaleString() ?? 'query failed'}
Daily Active Users (DAU, last 24h): ${data.dau?.toLocaleString() ?? 'query failed'}
DAU/MAU ratio: ${dauMauRatio !== null ? `${dauMauRatio}%` : 'cannot calculate'}
Sessions last 30 days: ${data.sessions30d?.toLocaleString() ?? 'query failed'}
Sessions per MAU: ${sessionsPerUser ?? 'cannot calculate'}
New users last 30 days: ${data.newUsers30d?.toLocaleString() ?? 'query failed'}
New users as % of MAU: ${newUserPct !== null ? `${newUserPct}%` : 'cannot calculate'}
Pageviews last 30 days: ${data.pageviews30d?.toLocaleString() ?? 'query failed'}

=== Weekly User Trend (last 12 weeks) ===
Trend vs prior 4 weeks: ${weeklyTrend}
Weekly breakdown:
${weeklySection}

=== Top 20 Events (last 30 days) ===
${topEventsSection}`
    : `
PostHog connected: No — integration not set up or API key/Project ID missing.`

  const funnelMetricsSection = data.connected
    ? `\n=== Funnel Analysis (last 30 days, 14-day conversion window) ===\n${funnelSection}`
    : ''

  const categoryInstructions = categories
    .map((c) => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  return `${brainContext ? `=== Prior context about this brand ===\n${brainContext}\n\n` : ''}=== Brand Context ===
Brand: ${data.brandName || 'not provided'}
Website: ${data.websiteUrl || 'not provided'}
${metricsSection}${funnelMetricsSection}

=== Category Instructions ===
${categoryInstructions}

=== Output requirements ===
Generate findings for ALL 5 categories. Return ONLY a valid JSON array — no markdown fences, no text outside the array.

Each element:
{
  "category": string — exactly one of: "traffic", "engagement", "conversion", "growth", "funnel",
  "slug": string — kebab-case, pattern: {category-slug}-{short-descriptor},
  "label": string — plain English, no jargon; cite actual numbers or event names; explain what it means for the business,
  "weight": 1 | 2 | 3,
  "detail": string — one plain English sentence explaining what the data shows; wrap the single most important number in **double asterisks**,
  "highlight": string — 5–8 plain English words capturing the key point; no jargon, no period,
  "narrative": string — exactly 1 plain English sentence on what this means for growth or revenue; wrap the key impact in **double asterisks**,
  "action": string — specific step starting with a verb, completable within one week; technical terms and tool names allowed here; wrap the specific setting or step in **double asterisks**,
  "verified": boolean — true if the metric looks healthy | false if gap or problem exists,
  "fixable": false
}`
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeUserAnalytics(
  data: PostHogFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const prompt = buildPrompt(data, brainContext)

  const raw = await callAI({
    system: USER_ANALYTICS_MODULE.systemPrompt,
    prompt,
    maxTokens: 6000,
    model: 'claude-haiku-4-5-20251001',
  })

  let results: DynamicModuleAnalysisResult[]
  try {
    results = parseClaudeJsonArray(raw) as DynamicModuleAnalysisResult[]
  } catch (err) {
    throw new Error(`User analytics agent returned invalid JSON: ${err instanceof Error ? err.message : raw.slice(0, 300)}`)
  }

  const allowed = new Set(['traffic', 'engagement', 'conversion', 'growth', 'funnel'])

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
