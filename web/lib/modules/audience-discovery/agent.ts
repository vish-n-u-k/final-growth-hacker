import { callAI } from '@/lib/ai/client'
import { AUDIENCE_DISCOVERY_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { AudienceDiscoveryFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

const ALLOWED_CATEGORIES = new Set([
  'product-directories',
  'online-communities',
  'content-creators',
  'publications-newsletters',
  'lead-databases',
])

export async function analyzeAudienceDiscovery(
  data: AudienceDiscoveryFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const categories = AUDIENCE_DISCOVERY_MODULE.categories as DynamicModuleCategoryDefinition[]
  const categoryInstructions = categories
    .map((c) => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  const siteSection = data.fetchFailed
    ? `Website URL: ${data.websiteUrl}\nNote: The website could not be fetched. Use your knowledge of this brand/URL to infer the product type and audience.`
    : `Website URL: ${data.websiteUrl}
Page title: ${data.title || '(none)'}
Meta description: ${data.metaDescription || '(none)'}
H1: ${data.h1 || '(none)'}
H2s: ${data.h2s.length > 0 ? data.h2s.join(' | ') : '(none)'}
Nav links: ${data.navLinks.map((l) => l.text).filter(Boolean).slice(0, 8).join(', ') || '(none)'}
CTA text: ${data.ctaTexts.join(', ') || '(none)'}
Body excerpt: ${data.bodyTextSnippet || '(none)'}`

  const prompt = `${brainContext ? `=== Brand context ===\n${brainContext}\n\n` : ''}=== Brand ===
Name: ${data.brandName}
${siteSection}

=== Your task ===
Study the brand above. Identify exactly where this brand's ideal customers already spend time online.

You must surface real, named channels across all four categories below. Every recommendation must be a specific platform, community, creator, or publication — never a generic description of a type of place.

${categoryInstructions}

Return ONLY a valid JSON array. No markdown fences, no text outside the array. Each element:
{
  "category": string — must be one of: "product-directories", "online-communities", "content-creators", "publications-newsletters", "lead-databases",
  "slug": string — kebab-case, pattern: {category-slug}-{short-name} (e.g. "online-communities-r-saas", "product-directories-product-hunt"),
  "label": string — specific action e.g. "Get listed on Product Hunt" or "Engage in r/SaaS",
  "weight": 1 | 2 | 3,
  "detail": string — 1 plain English sentence: what this platform is and why it fits this brand,
  "narrative": string — 1 plain English sentence: who is there and why they would care about this product specifically,
  "action": string — exact URL plus the specific next step; wrap the URL or key step in **double asterisks**,
  "verified": false,
  "fixable": false
}`

  const raw = await callAI({
    system: AUDIENCE_DISCOVERY_MODULE.systemPrompt,
    prompt,
    maxTokens: 6000,
  })

  let results: DynamicModuleAnalysisResult[]
  try {
    results = parseClaudeJsonArray(raw) as DynamicModuleAnalysisResult[]
  } catch (err) {
    throw new Error(
      `Audience discovery agent returned invalid JSON: ${err instanceof Error ? err.message : raw.slice(0, 300)}`,
    )
  }

  return results
    .filter(
      (r) =>
        typeof r.category === 'string' &&
        ALLOWED_CATEGORIES.has(r.category) &&
        typeof r.slug === 'string' &&
        typeof r.label === 'string' &&
        (r.weight === 1 || r.weight === 2 || r.weight === 3) &&
        typeof r.detail === 'string' &&
        typeof r.narrative === 'string' &&
        typeof r.action === 'string',
    )
    .map((r) => ({ ...r, verified: false, fixable: false }))
}
