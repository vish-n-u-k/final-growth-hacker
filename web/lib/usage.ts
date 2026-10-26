// What this account spent on outside services, shaped for Settings → Usage & costs.
// Data (DataForSEO dollars, Hunter lookups) comes from the agents' usage document; AI dollars from
// ai_usage_logs. Hunter is paid by plan credits, so its credits are counted, not priced.

import { readAccountCosts } from '@/lib/agents/store'
import { MODULE_MAP } from '@/lib/modules/registry'

export interface UsageRow { name: string; usd: number; dataforseo: number; ai: number; hunter: number }
export interface UsageView {
  month: string                 // 'YYYY-MM' (UTC)
  total: number                 // DataForSEO + AI, USD
  dataforseo: number
  ai: number
  hunter: number                // Hunter credits used
  hunterOutAt: string | null    // Hunter said its credits were used up (this month, not found an email since)
  tools: UsageRow[]             // biggest first
  apis: { name: string; usd: number }[]
  aiFeatures: { name: string; usd: number }[]
  apiSplitMissing: boolean      // DataForSEO spend recorded before costs were split by API
  past: { month: string; total: number; dataforseo: number; ai: number; hunter: number }[]
}

const FEATURE_TOOL: Record<string, string> = {
  'lead-agent': 'Lead Agent',
  'search-agent': 'Search Agent',
  'lead-finder': 'Competitor Leads',
  'gmail-campaign': 'Email Outreach',
  'gmail-generate-email': 'Email Outreach',
  'gmail-reply-check': 'Email Outreach',
  'email-followup': 'Email Outreach',
  'outreach-parse': 'Email Outreach',
  'item-draft': 'Roadmap',
  'item-classify-export': 'Roadmap',
}

const FEATURE_NAME: Record<string, string> = {
  'lead-agent': 'Lead Agent: scoring and writing',
  'search-agent': 'Search Agent: research and drafts',
  'lead-finder': 'Competitor Leads: scoring reviews',
  'gmail-campaign': 'Email campaigns',
  'gmail-generate-email': 'Writing emails',
  'gmail-reply-check': 'Reading replies',
  'email-followup': 'Follow-ups',
  'outreach-parse': 'Reading recipient lists',
  'item-draft': 'Roadmap: drafting fixes',
  'item-classify-export': 'Roadmap: sorting items',
  'social-suggest': 'Post ideas',
  'social-series-suggest': 'Post series ideas',
  'social-post-ideas': 'Post ideas',
  'brain': 'Daily plan',
  'playbook': 'Sales playbook',
  'onboarding-prefill': 'Setting up your brand',
  'keywords-scan': 'Keyword scan',
  'analytics-summary': 'Analytics summary',
}

const toolOf = (feature: string) =>
  FEATURE_TOOL[feature] ?? (MODULE_MAP[feature] ? 'Roadmap' : feature.startsWith('social') ? 'Social Studio' : 'Other')

const nameOf = (feature: string) =>
  FEATURE_NAME[feature] ?? (MODULE_MAP[feature] ? `Roadmap: ${MODULE_MAP[feature].name}` : feature.replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase()))

const byUsd = <T extends { usd: number }>(list: T[]) => list.filter(x => x.usd > 0).sort((a, b) => b.usd - a.usd)

export async function usageView(brandId: string): Promise<UsageView> {
  const { months, current: c } = await readAccountCosts(brandId)

  const tools = new Map<string, UsageRow>()
  const row = (name: string) => {
    if (!tools.has(name)) tools.set(name, { name, usd: 0, dataforseo: 0, ai: 0, hunter: 0 })
    return tools.get(name)!
  }
  for (const [name, t] of Object.entries(c.tools)) {
    const r = row(name)
    r.dataforseo += t.dataforseo
    r.hunter += t.hunter
  }
  const features = new Map<string, number>()
  for (const [feature, usd] of Object.entries(c.aiByFeature)) {
    row(toolOf(feature)).ai += usd
    features.set(nameOf(feature), (features.get(nameOf(feature)) ?? 0) + usd)
  }
  // Spend recorded before it was split by tool
  const toolData = Object.values(c.tools).reduce((a, t) => ({ d: a.d + t.dataforseo, h: a.h + t.hunter }), { d: 0, h: 0 })
  if (c.dataforseo - toolData.d > 0.00005 || c.hunter - toolData.h > 0) {
    const r = row('Agents (before this month’s split)')
    r.dataforseo += Math.max(0, c.dataforseo - toolData.d)
    r.hunter += Math.max(0, c.hunter - toolData.h)
  }
  for (const r of tools.values()) r.usd = r.dataforseo + r.ai

  const apiTotal = Object.values(c.apis).reduce((a, b) => a + b, 0)
  return {
    month: c.month,
    total: c.dataforseo + c.ai,
    dataforseo: c.dataforseo,
    ai: c.ai,
    hunter: c.hunter,
    hunterOutAt: c.hunterOutAt ?? null,
    tools: [...tools.values()].filter(r => r.usd > 0 || r.hunter > 0).sort((a, b) => b.usd - a.usd || b.hunter - a.hunter),
    apis: byUsd(Object.entries(c.apis).map(([name, usd]) => ({ name, usd }))),
    aiFeatures: byUsd([...features.entries()].map(([name, usd]) => ({ name, usd }))),
    apiSplitMissing: c.dataforseo - apiTotal > 0.00005,
    past: months.filter(m => m.month !== c.month).map(m => ({ ...m, total: m.dataforseo + m.ai })),
  }
}
