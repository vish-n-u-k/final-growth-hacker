import { callAI } from '@/lib/ai/client'
import { BUSINESS_STAGE_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { BusinessStageFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

const DIAGNOSTIC_SLUGS = new Set(['classification', 'concern', 'insight', 'actions', 'red-flag'])
const TACTICAL_SLUGS = new Set(['immediate-actions', 'channel-strategy', 'messaging-positioning', 'referral-word-of-mouth', 'next-phase-readiness'])
const ALL_CATEGORY_SLUGS = new Set([...DIAGNOSTIC_SLUGS, ...TACTICAL_SLUGS])

function buildContext(data: BusinessStageFetchResult, brainContext?: string): string {
  const yesNo = (v: boolean) => (v ? 'Yes' : 'No')

  const countLine = data.countSource === 'posthog'
    ? `${data.userCount?.toLocaleString() ?? 0} (live from PostHog)`
    : data.countSource === 'manual'
      ? `${data.userCount?.toLocaleString() ?? 0} (manually entered)`
      : 'Unknown — assume 0 and treat as Phase 1 / earliest stage'

  const nextPhaseLine = data.usersToNextPhase !== null
    ? `${data.usersToNextPhase} more users needed to reach next acquisition phase (${data.nextPhaseLabel})`
    : 'Already at maximum acquisition phase — focus on sustaining and scaling'

  return `${brainContext ? `=== Prior context about this brand ===\n${brainContext}\n\n` : ''}=== Brand Context ===
Brand name: ${data.brandName || 'not provided'}
Website: ${data.url}
Industry: ${data.industry ?? 'not provided — infer from brand name and website if possible'}
Target audience: ${data.targetAudience ?? 'not provided — infer from context'}
Unique selling point: ${data.usp ?? 'not provided'}
Brand voice: ${data.brandVoice ?? 'not provided'}

=== Verified User Count & Acquisition Phase ===
User count: ${countLine}
Current acquisition phase: ${data.phaseLabel}
Next acquisition phase: ${data.nextPhaseLabel}
${nextPhaseLine}

=== Website Signals ===
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

  const categoryInstructions = categories
    .map(c => `--- Category: "${c.slug}" (${c.label}) ---\n${c.prompt}`)
    .join('\n\n')

  return `${context}

=== Instructions ===
${categoryInstructions}

=== Output Format ===
Return a single JSON array covering ALL 10 categories above.

The five diagnostic categories ("classification", "concern", "insight", "actions", "red-flag") each produce EXACTLY 1 item, shaped like:
{
  "category": "classification" | "concern" | "insight" | "actions" | "red-flag",
  "slug": string,
  "label": string,
  "weight": 1 | 2 | 3,
  "detail": string,
  "narrative": string,
  "action": "",
  "verified": true,
  "fixable": false
}

The five tactical categories ("immediate-actions", "channel-strategy", "messaging-positioning", "referral-word-of-mouth", "next-phase-readiness") each produce the number of items their instructions ask for (several items per category), shaped like:
{
  "category": "immediate-actions" | "channel-strategy" | "messaging-positioning" | "referral-word-of-mouth" | "next-phase-readiness",
  "slug": string — kebab-case, pattern: {category-slug}-{short-descriptor},
  "label": string — plain English, specific and actionable, cite the brand/industry/audience where relevant,
  "weight": 1 | 2 | 3,
  "detail": string — one plain English sentence describing the specific observation or gap; wrap the key data point in **double asterisks**,
  "highlight": string — 5–8 plain English words capturing the key point; no jargon, no period,
  "narrative": string — exactly 1 plain English sentence explaining the business impact or opportunity; wrap the key risk or opportunity in **double asterisks**,
  "action": string — starts with a verb, completable within 14 days, specific to this brand; wrap the specific step in **double asterisks**,
  "verified": boolean — true only if this tactic is demonstrably already active,
  "fixable": false
}

Return ONLY valid JSON. No markdown, no text outside the array.`
}

export async function analyzeBusinessStage(
  data: BusinessStageFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const context = buildContext(data, brainContext)
  const prompt = buildPrompt(context)

  const raw = await callAI({
    system: BUSINESS_STAGE_MODULE.systemPrompt,
    prompt,
    maxTokens: 12000,
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

  return (parsed as Record<string, unknown>[])
    .filter(
      (r) =>
        typeof r.category === 'string' &&
        ALL_CATEGORY_SLUGS.has(r.category) &&
        typeof r.slug === 'string' &&
        typeof r.label === 'string' &&
        (r.weight === 1 || r.weight === 2 || r.weight === 3) &&
        typeof r.detail === 'string' &&
        typeof r.narrative === 'string',
    )
    .map((r) => {
      const isDiagnostic = DIAGNOSTIC_SLUGS.has(r.category as string)
      return {
        ...r,
        action: typeof r.action === 'string' ? r.action : '',
        verified: isDiagnostic ? true : typeof r.verified === 'boolean' ? r.verified : false,
        fixable: false,
      }
    }) as DynamicModuleAnalysisResult[]
}
