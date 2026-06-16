import { callAI } from '@/lib/ai/client'
import { BRAND_AUDIT_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { BrandAuditFetchResult } from './fetcher'

// ── Format helpers ─────────────────────────────────────────────────────────────

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
      return `${p.handle}:\n  Bio: "${p.bio.slice(0, 200)}"\n  Sentiment: ${p.sentimentScore.toFixed(2)}`
    })
    .join('\n')
}

function buildPrompt(data: BrandAuditFetchResult, brainContext?: string): string {
  const categories = BRAND_AUDIT_MODULE.categories as DynamicModuleCategoryDefinition[]

  const toneSection = data.avgSocialSentiment !== null
    ? `Average social sentiment: ${data.avgSocialSentiment.toFixed(2)}\nTone delta (website vs social): ${data.toneDelta?.toFixed(2)}${(data.toneDelta ?? 0) > 0.4 ? ' ⚠ INCONSISTENT (delta > 0.4)' : ' (consistent)'}`
    : 'Social sentiment: no social profiles available'

  const categoryInstructions = categories
    .map(c => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

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
${data.bodyCopy.slice(0, 3500)}

=== Category instructions ===
${categoryInstructions}

=== Output requirements ===
Analyse all data above. Generate findings for ALL 9 categories listed.

Return ONLY a valid JSON array. No markdown fences, no text outside the array. Each element:
{
  "category": string — exactly one of: "brand-positioning", "messaging-value-prop", "brand-voice", "brand-consistency", "audience-fit", "trust-credibility", "ai-entity-visibility", "differentiation", "brand-strength-score",
  "slug": string — kebab-case, pattern: {category-slug}-{short-descriptor},
  "label": string — specific, cite actual data (copy phrases, scores, missing elements),
  "weight": 1 | 2 | 3,
  "detail": string — one sentence citing exact data (exact scores, exact copy phrases, exact missing elements),
  "narrative": string — 2–3 sentences explaining business impact,
  "action": string — specific step starting with a verb, completable within one week by a non-technical person,
  "verified": boolean — true if this check passes or user is ahead; false if gap exists,
  "fixable": false
}`
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function analyzeBrandAudit(
  data: BrandAuditFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const prompt = buildPrompt(data, brainContext)

  const raw = await callAI({
    system: BRAND_AUDIT_MODULE.systemPrompt,
    prompt,
    maxTokens: 16000,
  })

  const clean = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  let results: DynamicModuleAnalysisResult[]
  try {
    results = JSON.parse(clean)
  } catch {
    throw new Error(`Brand audit agent returned invalid JSON: ${clean.slice(0, 300)}`)
  }

  const allowed = new Set([
    'brand-positioning',
    'messaging-value-prop',
    'brand-voice',
    'brand-consistency',
    'audience-fit',
    'trust-credibility',
    'ai-entity-visibility',
    'differentiation',
    'brand-strength-score',
  ])

  return results
    .filter(r =>
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
    .map(r => ({ ...r, fixable: false as const }))
}
