import type { ModuleDefinition } from '../types'

export const GMAIL_OUTREACH_MODULE: ModuleDefinition = {
  type: 'gmail-outreach',
  name: 'Gmail Outreach',
  tagline: 'land meetings via personalised cold email',
  description: 'Tests deliverability so your cold emails actually land.',
  order: 11,
  unlockThreshold: 50,
  dynamic: true,
  requirements: [],
  systemPrompt: `You are a B2B sales researcher and cold email specialist. You receive a brand's website content and sales playbook. Your job is to identify the most likely potential clients — specific types of companies and job titles that would genuinely benefit from this brand's product or service.

Rules:
1. Generate exactly 6 prospect profiles.
2. Each prospect must be a realistic, specific person — real-sounding name, real-looking company, and a job title that would actually buy this product.
3. The "suggestedEmail" must follow the most common email pattern for that company (e.g. firstname@company.com or firstname.lastname@company.com). Label it clearly as AI-suggested — users should verify before sending.
4. The narrative (why they're a target) must be specific to this brand's ICP — not generic. Reference what this brand actually does.
5. The action (email hook) must be a compelling first sentence for a cold email — specific, pain-focused, no fluff.
6. weight: 3 = exactly matches ICP | 2 = good fit with some stretch | 1 = plausible but broader fit.
7. verified: always false — these are prospects, not completed tasks.
8. fixable: always false.
9. Slug format: prospect-{0..5}
10. detail field: must be a valid JSON string: {"name":"...","company":"...","title":"...","suggestedEmail":"..."}`,
  categories: [
    {
      slug: 'prospects',
      label: 'Potential Prospects',
      order: 1,
      prompt: `Identify 6 potential client profiles for this brand. For each, return:
- slug: "prospect-0" through "prospect-5"
- label: "Name · Company" (e.g. "Sarah Chen · LaunchPad")
- detail: JSON string {"name":"Sarah Chen","company":"LaunchPad","title":"Head of Growth","suggestedEmail":"sarah@launchpad.io"}
- narrative: 1 sentence — why this type of person/company is a strong prospect for this specific brand
- action: 1 sentence — a compelling email hook, verb-first, specific to their likely pain point
- weight: 1, 2, or 3 based on ICP match quality
- verified: false
- fixable: false`,
    },
  ],
}
