import { callAI } from '@/lib/ai/client'
import { OUTREACH_TARGETS_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { OutreachTargetsFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

// ── Prompt builder ────────────────────────────────────────────────────────────

function formatLinks(data: OutreachTargetsFetchResult): string {
  if (data.links.length === 0) return 'No external links were found.'

  return data.links
    .map((link, i) => {
      const lines = [
        `${i + 1}. Domain: ${link.domain}`,
        `   URL: ${link.url}`,
        `   Anchor text: "${link.anchorText}"`,
        `   Context: ${link.surroundingText}`,
        `   Section type: ${link.sectionHint}`,
        `   Found on: ${link.foundOn}`,
      ]
      return lines.join('\n')
    })
    .join('\n\n')
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeOutreachTargets(
  data: OutreachTargetsFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  if (data.links.length === 0) {
    return [
      {
        category: 'press-coverage',
        slug: 'press-coverage-no-data',
        label: 'No outreach targets found',
        weight: 1,
        detail: 'No external links were extracted from the competitor URLs provided.',
        narrative: 'This can happen if competitor sites blocked the request, have very few outgoing links, or the URLs provided are not accessible.',
        action: 'Try re-running the analysis with different competitor URLs, or check that the competitor sites are publicly accessible.',
        verified: false,
        fixable: false,
      },
    ]
  }

  const categories = OUTREACH_TARGETS_MODULE.categories as DynamicModuleCategoryDefinition[]
  const categoryInstructions = categories
    .map((c) => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  const failedNote = data.competitorsFailed.length > 0
    ? `\nCompetitors that could not be fetched: ${data.competitorsFailed.join(', ')}`
    : ''

  const prompt = `${brainContext ? `=== Brand context ===\n${brainContext}\n\n` : ''}=== Your website ===
URL: ${data.userUrl}
Brand: ${data.brandName}

=== Competitors crawled ===
${data.competitorsFetched.join(', ')}${failedNote}

=== External links found on competitor sites ===
${formatLinks(data)}

=== Your task ===
Review all the external links above. Identify genuine outreach opportunities — sites that are covering, partnering with, or linking to competitors that may be interested in this product too.

Assign each to exactly one of these categories: press-coverage, partner-ecosystem, resource-opportunities.

Skip any link that is clearly a utility, infrastructure, or irrelevant site.

Generate 5–15 findings total. Quality over quantity.

${categoryInstructions}

Return ONLY a valid JSON array. No markdown fences, no text outside the array. Each element:
{
  "category": string — must be one of: "press-coverage", "partner-ecosystem", "resource-opportunities",
  "slug": string — kebab-case, pattern: {category-slug}-{domain-short},
  "label": string — plain English action description e.g. "Pitch to TechCrunch" or "Get listed on ToolDirectory",
  "weight": 1 | 2 | 3,
  "detail": string — 1 plain English sentence: what this site is and that a competitor is already featured there; wrap the site name in **double asterisks**,
  "highlight": string — 5–8 plain English words on why this opportunity matters; no jargon, no period,
  "narrative": string — exactly 1 plain English sentence on why reaching out here is worth the effort; wrap the key benefit in **double asterisks**,
  "action": string — specific pitch strategy with contact method or URL; technical details go here; wrap the key step or URL in **double asterisks**,
  "verified": false,
  "fixable": false
}`

  const raw = await callAI({
    system: OUTREACH_TARGETS_MODULE.systemPrompt,
    prompt,
    maxTokens: 6000,
  })

  let results: DynamicModuleAnalysisResult[]
  try {
    results = parseClaudeJsonArray(raw) as DynamicModuleAnalysisResult[]
  } catch (err) {
    throw new Error(
      `Outreach targets agent returned invalid JSON: ${err instanceof Error ? err.message : raw.slice(0, 300)}`,
    )
  }

  const allowedCategories = new Set(['press-coverage', 'partner-ecosystem', 'resource-opportunities'])

  return results
    .filter(
      (r) =>
        typeof r.category === 'string' &&
        allowedCategories.has(r.category) &&
        typeof r.slug === 'string' &&
        typeof r.label === 'string' &&
        (r.weight === 1 || r.weight === 2 || r.weight === 3) &&
        typeof r.detail === 'string' &&
        typeof r.narrative === 'string' &&
        typeof r.action === 'string',
    )
    .map((r) => ({ ...r, verified: false, fixable: false }))
}
