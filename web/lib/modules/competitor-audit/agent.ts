import { callAI } from '@/lib/ai/client'
import { COMPETITOR_AUDIT_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { CompetitorAuditFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

export async function analyzeCompetitorAudit(
  data: CompetitorAuditFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const categories = COMPETITOR_AUDIT_MODULE.categories as DynamicModuleCategoryDefinition[]

  const competitorSection = data.competitors
    .map((c, i) => {
      if (!c.html) {
        return `=== Competitor ${i + 1}: ${c.url} ===\n${c.error ?? 'Inaccessible — skip checks that require content analysis'}\n`
      }
      return `=== Competitor ${i + 1}: ${c.url} ===\n${c.html}\n`
    })
    .join('\n')

  const userSection = data.userHtml
    ? `=== User's own site (${data.userUrl}) ===\n${data.userHtml}\n`
    : `=== User's own site (${data.userUrl}) ===\nCould not fetch HTML — compare competitors against each other and note what the user should do.\n`

  const keywordsNote =
    data.industryKeywords.length > 0
      ? `Industry keywords to focus on: ${data.industryKeywords.join(', ')}`
      : 'Industry keywords: not provided — infer from competitor content'

  const userPrompt = `${brainContext ? `=== What we already know about this brand ===\n${brainContext}\n\n` : ''}Conduct a competitor audit. Compare the user's website against the competitors listed below.

${keywordsNote}

${userSection}

${competitorSection}

=== Categories to audit ===
${categories
  .map(
    (c) =>
      `Category slug: "${c.slug}"\nLabel: "${c.label}"\nWhat to analyze:\n${c.prompt}`,
  )
  .join('\n\n---\n\n')}

For each finding, return an object with:
- "category": string — exactly one of: ${categories.map((c) => `"${c.slug}"`).join(', ')}
- "slug": string — kebab-case, unique (e.g. "comp-missing-blog", "comp-keyword-gap-pm-tools")
- "label": string — short, specific, cite which competitor (e.g. "Competitor1.com has a resource hub you don't")
- "weight": number — 1, 2, or 3
- "detail": string — one sentence with exact finding, cite the competitor URL
- "narrative": string — 2–3 sentences on why this gap matters for growth or revenue
- "action": string — one specific, immediately actionable instruction starting with a verb
- "verified": boolean — true if user is AHEAD of or on par with competitors; false if this is a gap
- "fixable": boolean — always false

Return ONLY a valid JSON array. No markdown fences, no text outside the array.`

  const raw = await callAI({
    system: COMPETITOR_AUDIT_MODULE.systemPrompt,
    prompt: userPrompt,
    maxTokens: 14000,
  })

  let results: DynamicModuleAnalysisResult[]
  try {
    results = parseClaudeJsonArray(raw) as DynamicModuleAnalysisResult[]
  } catch (err) {
    throw new Error(`Competitor audit agent returned invalid JSON: ${err instanceof Error ? err.message : raw.slice(0, 200)}`)
  }

  const validCategories = new Set(categories.map((c) => c.slug))

  return results
    .filter(
      (r) =>
        typeof r.category === 'string' &&
        validCategories.has(r.category) &&
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
