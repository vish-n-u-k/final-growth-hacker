import { callAI } from '@/lib/ai/client'
import { COMPETITOR_AUDIT_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { CompetitorAuditFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'
import * as cheerio from 'cheerio'

function extractMetadataFromHtml(html: string): string {
  try {
    const $ = cheerio.load(html)
    const metadata: string[] = []

    const title = $('title').text().trim()
    if (title) metadata.push(`Title: "${title}"`)

    const metaDescription = $('meta[name="description"]').attr('content') ?? ''
    if (metaDescription) metadata.push(`Meta: "${metaDescription.slice(0, 160)}"`)

    const h1 = $('h1').first().text().trim()
    if (h1) metadata.push(`H1: "${h1}"`)

    const h2s = $('h2').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 5)
    if (h2s.length > 0) metadata.push(`Key sections: ${h2s.join(' | ')}`)

    $('script, style, nav, footer, header').remove()
    const bodyText = ($('main, article, [role="main"], body').first().text() ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 800)
    if (bodyText) metadata.push(`Content: ${bodyText}`)

    return metadata.join('\n')
  } catch {
    return 'Could not extract metadata from HTML'
  }
}

export async function analyzeCompetitorAudit(
  data: CompetitorAuditFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const categories = COMPETITOR_AUDIT_MODULE.categories as DynamicModuleCategoryDefinition[]

  const competitorSection = data.competitors
    .map((c, i) => {
      const urlBlock = c.urlProfile ? `\n${c.urlProfile}` : ''
      if (!c.html) {
        return `=== Competitor ${i + 1}: ${c.url} ===\n${c.error ?? 'Inaccessible — skip checks that require content analysis'}${urlBlock}\n`
      }
      const metadata = extractMetadataFromHtml(c.html)
      return `=== Competitor ${i + 1}: ${c.url} ===\n${metadata}${urlBlock}\n`
    })
    .join('\n')

  const userSection = data.userHtml
    ? `=== User's own site (${data.userUrl}) ===\n${extractMetadataFromHtml(data.userHtml)}\n${data.userUrlProfile}\n`
    : `=== User's own site (${data.userUrl}) ===\nCould not fetch HTML — compare competitors against each other and note what the user should do.\n${data.userUrlProfile}\n`

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
- "label": string — plain English, no jargon; describe what was found simply; cite which competitor (e.g. "Competitor1.com has a resource hub you don't")
- "weight": number — 1, 2, or 3
- "detail": string — one plain English sentence with the exact finding; wrap the key competitor name or data in **double asterisks**
- "highlight": string — 5–8 plain English words capturing the key gap; no jargon, no period
- "narrative": string — exactly 1 plain English sentence on why this gap matters for growth or revenue; wrap the key impact in **double asterisks**
- "action": string — one specific, immediately actionable instruction starting with a verb; technical terms and tool names allowed here; wrap the specific step in **double asterisks**
- "verified": boolean — true if user is AHEAD of or on par with competitors; false if this is a gap
- "fixable": boolean — always false

Return ONLY a valid JSON array. No markdown fences, no text outside the array.`

  const raw = await callAI({
    system: COMPETITOR_AUDIT_MODULE.systemPrompt,
    prompt: userPrompt,
    maxTokens: 8000,
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
