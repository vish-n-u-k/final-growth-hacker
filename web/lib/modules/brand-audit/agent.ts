import { callAI } from '@/lib/ai/client'
import { BRAND_AUDIT_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { BrandAuditFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

// ── Format helpers ─────────────────────────────────────────────────────────────

function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }
  return chunks
}

function formatTrustSignals(ts: BrandAuditFetchResult['trustSignals']): string {
  return [
    `HTTPS: ${ts.hasHttps ? 'Yes' : 'No'}`,
    `Testimonials detected: ${ts.testimonialCount}`,
    `Social proof elements: ${ts.socialProofCount}`,
    `Client logos: ${ts.clientLogoCount}`,
    `Case study links: ${ts.hasCaseStudyLink ? 'Yes' : 'No'}`,
    `Review widget (G2/Capterra/Trustpilot): ${ts.hasReviewWidget ? 'Yes' : 'No'}`,
    `Team page link: ${ts.hasTeamPage ? 'Yes' : 'No'}`,
    `Privacy policy link: ${ts.hasPrivacyPage ? 'Yes' : 'No'}`,
    `Terms of service link: ${ts.hasTermsPage ? 'Yes' : 'No'}`,
  ].join('\n')
}

function formatSocialProfiles(profiles: BrandAuditFetchResult['socialProfiles']): string {
  if (profiles.length === 0) return 'No social handles provided — skip cross-platform tone comparison.'
  return profiles
    .map(p => {
      if (p.fetchFailed || !p.bio) return `${p.handle}: fetch failed or no bio content extracted (JS-rendered page)`
      return `${p.handle}:\n  Bio: "${p.bio.slice(0, 100)}"\n  Sentiment: ${p.sentimentScore.toFixed(2)}`
    })
    .join('\n')
}

function buildBaseContext(data: BrandAuditFetchResult, brainContext?: string): string {
  const toneSection = data.avgSocialSentiment !== null
    ? `Average social sentiment: ${data.avgSocialSentiment.toFixed(2)}\nTone delta (website vs social): ${data.toneDelta?.toFixed(2)}${(data.toneDelta ?? 0) > 0.4 ? ' ⚠ INCONSISTENT (delta > 0.4)' : ' (consistent)'}`
    : 'Social sentiment: no social profiles available'

  return `${brainContext ? `=== Prior context about this brand (from earlier modules) ===\n${brainContext}\n\n` : ''}=== Brand Inputs ===
Brand name: ${data.brandName}
Website URL: ${data.websiteUrl}
Industry: ${data.industry || 'not provided — infer from content'}
Target audience: ${data.targetAudience || 'not provided — infer from content'}
Stated USP: ${data.usp || 'not provided'}
Desired brand voice: ${data.brandVoice || 'not provided'}

=== Page Metadata ===
Title tag: "${data.title}"
Meta description: "${data.metaDescription}"
OG Title: "${data.ogTitle || 'not set'}"
OG Description: "${data.ogDescription || 'not set'}"
H1: "${data.h1}"
First paragraph: "${data.firstParagraph}"
Hero section copy: "${data.heroCopy}"

Brand name in title tag: ${data.titleHasBrandName ? 'Yes' : 'No'}
Brand name in OG title: ${data.ogTitleHasBrandName ? 'Yes' : 'No'}

=== NLP Signals ===
Flesch Reading Ease: ${data.readabilityScore}/100 (${data.readabilityLabel})
Website sentiment score: ${data.websiteSentimentScore.toFixed(2)} (scale: -1 = very negative, 0 = neutral, +1 = very positive)
${toneSection}

Top TF-IDF keywords (distinctive terms): ${data.topKeywords.join(', ')}
Target audience mentions in copy: ${data.audienceMentionCount} times

Benefit language count: ${data.benefitCount}
Feature language count: ${data.featureCount}
CTA texts found: ${data.ctaTexts.length > 0 ? data.ctaTexts.join(' | ') : 'none detected'}

=== Trust Signals ===
${formatTrustSignals(data.trustSignals)}

=== Schema Markup ===
Types detected: ${data.schemaTypes.length > 0 ? data.schemaTypes.join(', ') : 'none'}
Count: ${data.schemaTypes.length}

=== AI Entity Visibility ===
Wikidata entity found: ${data.wikidataFound ? 'Yes — brand entity exists in Wikidata knowledge base' : 'No — brand not found in Wikidata'}

=== Differentiation ===
Comparison page (/vs, /compare, /alternatives): ${data.hasComparisonPage ? 'Yes — found' : 'No — not detected'}

=== Social Profiles ===
${formatSocialProfiles(data.socialProfiles)}

=== Homepage copy sample ===
${data.bodyCopy.slice(0, 1000)}`
}

async function analyzeBrandCategoryBatch(
  baseContext: string,
  categoryBatch: DynamicModuleCategoryDefinition[],
  allCategorySlugs: string[],
): Promise<DynamicModuleAnalysisResult[]> {
  const categoryInstructions = categoryBatch
    .map(c => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  const maxTokens = Math.min(categoryBatch.length * 150, 2000)

  const prompt = `${baseContext}

=== Category instructions (batch) ===
${categoryInstructions}

=== Output requirements ===
Analyse all data above. Generate findings for these categories ONLY: ${categoryBatch.map(c => `"${c.slug}"`).join(', ')}.

Return ONLY a valid JSON array. Keep responses terse: d (detail) under 15 words, n (narrative) under 20 words, a (action) under 25 words.

[{
  "category": string — exactly one of: ${allCategorySlugs.map(s => `"${s}"`).join(', ')},
  "slug": string — kebab-case unique identifier,
  "label": string — specific, cite actual data,
  "weight": 1 | 2 | 3,
  "d": string — one sentence with exact data,
  "n": string — 1–2 sentences on business impact,
  "a": string — specific step, completable in one week,
  "verified": boolean,
  "fixable": boolean
}]`

  const raw = await callAI({
    system: BRAND_AUDIT_MODULE.systemPrompt,
    prompt,
    maxTokens,
  })

  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return []

  try {
    const parsed = parseClaudeJsonArray(raw.slice(start, end + 1)) as unknown[]
    return (parsed as any[])
      .map(r => ({
        ...r,
        detail: r.d || r.detail,
        narrative: r.n || r.narrative,
        action: r.a || r.action,
      }))
      .filter((r: any) =>
        typeof r.category === 'string' &&
        typeof r.slug === 'string' &&
        typeof r.label === 'string' &&
        (r.weight === 1 || r.weight === 2 || r.weight === 3) &&
        typeof r.detail === 'string' &&
        typeof r.narrative === 'string' &&
        typeof r.action === 'string' &&
        typeof r.verified === 'boolean',
      ) as DynamicModuleAnalysisResult[]
  } catch {
    return []
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeBrandAudit(
  data: BrandAuditFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const categories = BRAND_AUDIT_MODULE.categories as DynamicModuleCategoryDefinition[]
  const allCategorySlugs = categories.map(c => c.slug)
  const baseContext = buildBaseContext(data, brainContext)

  // Split 9 categories into batches of 3 → 3 parallel AI calls
  const categoryBatches = chunk(categories, 3)

  // Run all batches in parallel
  const batchResults = await Promise.all(
    categoryBatches.map(batch => analyzeBrandCategoryBatch(baseContext, batch, allCategorySlugs)),
  )

  // Merge and filter results
  const allowed = new Set(allCategorySlugs)
  return batchResults
    .flat()
    .filter(r => allowed.has(r.category))
    .map(r => ({ ...r, fixable: typeof r.fixable === 'boolean' ? r.fixable : false }))
}
