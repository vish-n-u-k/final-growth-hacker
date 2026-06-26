import { callAI } from '@/lib/ai/client'
import { USER_ACQUISITION_MODULE } from './definition'
import type { DynamicModuleAnalysisResult, DynamicModuleCategoryDefinition } from '../types'
import type { UserAcquisitionFetchResult } from './fetcher'
import { parseClaudeJsonArray } from '@/lib/modules/parse-utils'

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(data: UserAcquisitionFetchResult, brainContext?: string): string {
  const categories = USER_ACQUISITION_MODULE.categories as DynamicModuleCategoryDefinition[]

  const countLine = data.countSource === 'posthog'
    ? `${data.userCount.toLocaleString()} (live from PostHog)`
    : data.countSource === 'manual'
      ? `${data.userCount.toLocaleString()} (manually entered)`
      : `Unknown — assume 0 and treat as Phase 1`

  const nextPhaseLine = data.usersToNextPhase !== null
    ? `${data.usersToNextPhase} more users needed to reach next phase (${data.nextPhaseLabel})`
    : 'Already at maximum phase — focus on sustaining and scaling'

  const categoryInstructions = categories
    .map((c) => `--- Category: "${c.slug}" (label: "${c.label}") ---\n${c.prompt}`)
    .join('\n\n')

  return `${brainContext ? `=== Prior context about this brand ===\n${brainContext}\n\n` : ''}=== Brand Context ===
Brand name: ${data.brandName || 'not provided'}
Website: ${data.websiteUrl || 'not provided'}
Industry: ${data.industry ?? 'not provided — infer from brand name and website if possible'}
Target audience: ${data.targetAudience ?? 'not provided — infer from context'}
Unique selling point: ${data.usp ?? 'not provided'}
Brand voice: ${data.brandVoice ?? 'not provided'}

=== Current Growth Phase ===
User count: ${countLine}
Current phase: ${data.phaseLabel}
Next phase: ${data.nextPhaseLabel}
${nextPhaseLine}

=== Category Instructions ===
${categoryInstructions}

=== Output requirements ===
Generate findings for ALL 5 categories. Return ONLY a valid JSON array — no markdown fences, no text outside the array.

Each element must match this exact shape:
{
  "category": string — exactly one of: "immediate-actions", "channel-strategy", "messaging-positioning", "referral-word-of-mouth", "next-phase-readiness",
  "slug": string — kebab-case, pattern: {category-slug}-{short-descriptor},
  "label": string — specific and actionable, cite the brand/industry/audience where relevant,
  "weight": 1 | 2 | 3,
  "detail": string — one sentence, specific observation or gap for this brand,
  "narrative": string — 2–3 sentences explaining the business impact or opportunity,
  "action": string — starts with a verb, completable within 14 days, specific to this brand,
  "verified": boolean — true only if this tactic is demonstrably already active,
  "fixable": false
}`
}

// ── Main export ───────────────────────────────────────────────────────────────

const ALLOWED_CATEGORIES = new Set([
  'immediate-actions',
  'channel-strategy',
  'messaging-positioning',
  'referral-word-of-mouth',
  'next-phase-readiness',
])

export async function analyzeUserAcquisition(
  data: UserAcquisitionFetchResult,
  brainContext?: string,
): Promise<DynamicModuleAnalysisResult[]> {
  const prompt = buildPrompt(data, brainContext)

  const raw = await callAI({
    system: USER_ACQUISITION_MODULE.systemPrompt,
    prompt,
    maxTokens: 10000,
    model: 'claude-haiku-4-5-20251001',
  })

  let results: DynamicModuleAnalysisResult[]
  try {
    results = parseClaudeJsonArray(raw) as DynamicModuleAnalysisResult[]
  } catch (err) {
    throw new Error(
      `User acquisition agent returned invalid JSON: ${err instanceof Error ? err.message : raw.slice(0, 300)}`,
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
        typeof r.action === 'string' &&
        typeof r.verified === 'boolean',
    )
    .map((r) => ({ ...r, fixable: false }))
}
