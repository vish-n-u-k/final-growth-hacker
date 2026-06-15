import { callAI } from '@/lib/ai/client'
import { SEO_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { SeoFetchResult } from './fetcher'

export async function analyzeSeo(data: SeoFetchResult, brainContext?: string): Promise<DynamicModuleAnalysisResult[]> {
  const categories = SEO_MODULE.categories as DynamicModuleCategoryDefinition[]

  const userPrompt = `${brainContext ? `=== What we already know about this brand ===\n${brainContext}\n\n` : ''}Audit this website and generate specific, relevant checklist items for each category below.

URL: ${data.url}

=== HTML (full head + truncated body) ===
${data.html || 'Unable to fetch — flag all checks as needing manual review'}

=== robots.txt ===
${data.robotsTxt ?? 'Not found'}

=== sitemap.xml ===
${data.sitemapXml ?? 'Not found'}

=== Categories to audit ===
${categories.map((c) => `Category slug: "${c.slug}"\nLabel: "${c.label}"\nWhat to check: ${c.prompt}`).join('\n\n')}

For each issue or notable win you find, return an object with:
- "category": string — exactly one of: ${categories.map((c) => `"${c.slug}"`).join(', ')}
- "slug": string — kebab-case, unique, stable (e.g. "seo-missing-meta-description", "seo-title-too-long")
- "label": string — short, specific label for this checklist item (e.g. "Homepage title tag is 82 characters — too long")
- "weight": number — 1, 2, or 3 only
- "detail": string — one sentence with the exact finding and actual values from the site
- "narrative": string — 2–3 sentences explaining why this matters for this specific site's SEO
- "action": string — one specific, immediately actionable instruction starting with a verb, with exact values or code where useful
- "verified": boolean — true if this is a pass, false if it needs fixing
- "fixable": boolean — true ONLY if this fix is a safe, targeted change to one of: <title> tag, <meta name="description">, canonical link, Open Graph tags (og:*), Twitter card meta tags, robots meta tag, viewport meta tag, or JSON-LD structured data. Set false for anything structural, content-related, URL-based, or that requires framework config changes.

Return ONLY a valid JSON array. No markdown fences, no text outside the array.`

  const raw = await callAI({
    system: SEO_MODULE.systemPrompt,
    prompt: userPrompt,
    maxTokens: 8000,
  })
  const clean = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim()

  let results: DynamicModuleAnalysisResult[]
  try {
    results = JSON.parse(clean)
  } catch {
    throw new Error(`SEO agent returned invalid JSON: ${clean.slice(0, 200)}`)
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
    .map((r) => ({ ...r, fixable: r.fixable === true }))
}
