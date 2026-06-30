import { callAI } from '@/lib/ai/client'
import { BUSINESS_STAGE_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { BusinessStageFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

function buildContext(data: BusinessStageFetchResult, brainContext?: string): string {
  const yesNo = (v: boolean) => (v ? 'Yes' : 'No')

  return `${brainContext ? `=== Prior context about this brand ===\n${brainContext}\n\n` : ''}=== Website Signals ===
URL: ${data.url}
Title: "${data.title}"
Meta description: "${data.metaDescription}"
H1: "${data.h1}"
H2s: ${data.h2s.length > 0 ? data.h2s.map(h => `"${h}"`).join(', ') : 'none'}

=== Archetype Classification Signals ===
Self-serve keywords found: ${data.selfServeKeywords.length > 0 ? data.selfServeKeywords.join(', ') : 'none'}
Enterprise keywords found: ${data.enterpriseKeywords.length > 0 ? data.enterpriseKeywords.join(', ') : 'none'}
PEH keywords found: ${data.pehKeywords.length > 0 ? data.pehKeywords.join(', ') : 'none'}
Has pricing page: ${yesNo(data.hasPricingPage)}
Has booking flow: ${yesNo(data.hasBookingFlow)}
Has demo/contact request: ${yesNo(data.hasDemoRequest)}
Price amounts visible on homepage: ${yesNo(data.hasPriceAmounts)}
Public pricing available: ${yesNo(data.hasPublicPricing)}

=== Stage Proxy Signals ===
Client logos detected: ${data.clientLogoCount}
Testimonials detected: ${data.testimonialCount}
Customer volume claims: ${data.customerClaims.length > 0 ? data.customerClaims.join(', ') : 'none'}
Has team page: ${yesNo(data.hasTeamPage)}
Has case study links: ${yesNo(data.hasCaseStudyLinks)}
Has press/media page: ${yesNo(data.hasPressPage)}
Has "beta" or "early access" language: ${yesNo(data.hasBetaOrEarlyAccess)}
Has review widget (G2/Capterra/Trustpilot): ${yesNo(data.hasReviewWidget)}
Has analytics installed: ${yesNo(data.hasAnalytics)}

=== Navigation Links ===
${data.navLinks.length > 0 ? data.navLinks.join('\n') : 'none detected'}

=== Hero Copy ===
${data.heroCopy || 'not detected'}

=== Homepage Body Copy (first 2500 chars) ===
${data.bodyCopy.slice(0, 2500)}`
}

function buildPrompt(context: string): string {
  const categories = BUSINESS_STAGE_MODULE.categories as DynamicModuleCategoryDefinition[]
  const allSlugs = categories.map(c => `"${c.slug}"`).join(', ')

  const categoryInstructions = categories
    .map(c => `--- Category: "${c.slug}" (${c.label}) ---\n${c.prompt}`)
    .join('\n\n')

  return `${context}

=== Category Instructions ===
${categoryInstructions}

=== Output Format ===
Generate all items in a single JSON array. category must be exactly one of: ${allSlugs}.

[{
  "category": string,
  "slug": string,
  "label": string,
  "weight": 1 | 2 | 3,
  "detail": string — one sentence, cite specific evidence from the data above,
  "narrative": string — 1–2 sentences on why this matters for growth at this stage,
  "action": string — one specific next step completable within 30 days,
  "verified": boolean,
  "fixable": false
}]

Return ONLY valid JSON. No markdown, no text outside the array.`
}

export async function analyzeBusinessStage(
  data: BusinessStageFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const categories = BUSINESS_STAGE_MODULE.categories as DynamicModuleCategoryDefinition[]
  const allCategorySlugs = new Set(categories.map(c => c.slug))

  const context = buildContext(data, brainContext)
  const prompt = buildPrompt(context)

  const raw = await callAI({
    system: BUSINESS_STAGE_MODULE.systemPrompt,
    prompt,
    maxTokens: 4096,
    model: 'claude-haiku-4-5-20251001',
  })

  let parsed: unknown[]
  try {
    parsed = parseClaudeJsonArray(raw)
  } catch {
    const start = raw.indexOf('[')
    const end = raw.lastIndexOf(']')
    if (start === -1 || end === -1) {
      throw new Error(`Business Stage agent returned invalid JSON: ${raw.slice(0, 200)}`)
    }
    try {
      parsed = JSON.parse(raw.slice(start, end + 1)) as unknown[]
    } catch {
      throw new Error(`Business Stage agent returned invalid JSON: ${raw.slice(0, 200)}`)
    }
  }

  return (parsed as any[])
    .filter(
      (r) =>
        typeof r.category === 'string' &&
        allCategorySlugs.has(r.category) &&
        typeof r.slug === 'string' &&
        typeof r.label === 'string' &&
        (r.weight === 1 || r.weight === 2 || r.weight === 3) &&
        typeof r.detail === 'string' &&
        typeof r.narrative === 'string' &&
        typeof r.action === 'string' &&
        typeof r.verified === 'boolean',
    )
    .map((r) => ({
      ...r,
      fixable: false,
    })) as DynamicModuleAnalysisResult[]
}
