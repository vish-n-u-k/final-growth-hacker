import { callAI } from '@/lib/ai/client'
import { GEO_COMPETITOR_GAP_MODULE } from './definition'
import { buildRuleFindings } from '../geo/agent'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { CompetitorGapFetchData } from './fetcher'

type RuleFindings = ReturnType<typeof buildRuleFindings>

function formatFindings(label: string, f: RuleFindings): string {
  const botSummary = (tier: { blocked: string[]; allowed: string[]; notMentioned: string[] }) => {
    if (tier.blocked.length) return `BLOCKS: ${tier.blocked.join(', ')}`
    if (tier.allowed.length) return `explicitly allows: ${tier.allowed.join(', ')}`
    return 'no bots explicitly mentioned'
  }

  return [
    `${label}:`,
    `  llms.txt: ${f.llmsPresent ? `present (${f.llmsLinkCount} links, ${f.llmsSectionCount} sections)` : 'NOT PRESENT'}`,
    `  FAQPage schema: ${f.hasFaq}`,
    `  Organization+sameAs schema: ${f.hasOrg && f.hasSameAs}`,
    `  WebSite schema: ${f.hasWebSite}`,
    `  Article/BlogPosting schema: ${f.hasArticle}`,
    `  AI training bots (Tier 1): ${botSummary(f.tier1)}`,
    `  AI search bots (Tier 2): ${botSummary(f.tier2)}`,
    `  Stats/numbers in content: ${f.page.statsCount}`,
    `  FAQ-style headings: ${f.page.hasFaqHeadings}`,
    `  List items: ${f.page.listItems}`,
    `  html lang: ${f.page.lang || 'not set'}`,
    `  Freshness date: ${f.page.articleModifiedTime || (f.hasDateModified ? 'in JSON-LD' : 'not set')}`,
    `  RSS/Atom feed: ${f.page.rssLink ? 'present' : 'not found'}`,
    `  /.well-known/ai.txt: ${f.aiTxtPresent ? 'present' : 'not found'}`,
    `  /ai/summary.json: ${f.aiSummaryPresent ? 'present' : 'not found'}`,
    `  /ai/faq.json: ${f.aiFaqPresent ? 'present' : 'not found'}`,
    `  /ai/service.json: ${f.aiServicePresent ? 'present' : 'not found'}`,
  ].join('\n')
}

export async function analyzeCompetitorGap(
  data: CompetitorGapFetchData,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const yourFindings = buildRuleFindings(data.your)
  const competitorFindings = data.competitors.map((c) => ({
    url: c.url,
    findings: buildRuleFindings(c.data),
  }))

  const comparisonBlock = [
    formatFindings(`YOUR SITE (${data.url})`, yourFindings),
    '',
    ...competitorFindings.map((c) => formatFindings(`COMPETITOR (${c.url})`, c.findings)),
  ].join('\n\n')

  const categories = GEO_COMPETITOR_GAP_MODULE.categories as DynamicModuleCategoryDefinition[]
  const categoryBlock = categories
    .map((cat) => `Category "${cat.slug}" (${cat.label}):\n${cat.prompt}`)
    .join('\n\n')

  const raw = await callAI({
    system: GEO_COMPETITOR_GAP_MODULE.systemPrompt,
    prompt: `Website: ${data.url}
${brainContext ? `\nBrand context:\n${brainContext}\n` : ''}
── Pre-computed GEO signal comparison ──
${comparisonBlock}

── Instructions per category ──
${categoryBlock}

Return a JSON array. Each item:
- category: one of [llms-txt-gap, schema-gap, robots-gap, content-gap, technical-gap, discovery-gap]
- slug: kebab-case e.g. "llms-txt-gap-missing"
- label: short specific label naming competitor and signal e.g. "competitor.com has llms.txt with 14 links — you have none"
- weight: 1 | 2 | 3
- detail: one sentence with specific numbers from the comparison data above
- narrative: 1–2 sentences on why this gap matters for AI citation rates
- action: concrete next step, max 2 sentences
- verified: true if brand is at parity or ahead | false if competitor leads
- fixable: false

Start your response with [`,
    maxTokens: 6000,
    model: 'claude-sonnet-4-6',
  })

  let rows: unknown[]
  try {
    rows = parseClaudeJsonArray(raw)
  } catch {
    return []
  }

  const validCategories = new Set(categories.map((c) => c.slug))
  return (rows as DynamicModuleAnalysisResult[]).filter(
    (r) =>
      typeof r.slug === 'string' &&
      typeof r.label === 'string' &&
      typeof r.category === 'string' &&
      validCategories.has(r.category) &&
      typeof r.detail === 'string' &&
      typeof r.verified === 'boolean' &&
      typeof r.fixable === 'boolean',
  )
}
