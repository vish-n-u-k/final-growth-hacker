import type { ModuleDefinition } from '../types'

// Brand Audit: does the homepage tell the right people what you do, prove it, make it safe to try
// and say why you over the alternatives? The facts are fixed rule checks (see brand-audit/agent.ts)
// with stable slugs, so ticks and the score stay put between runs. Claude only writes ideas
// (positioning, voice, standing out), which are shown as ideas and never scored.
//
// Things other modules already check are left to them: the value proposition and contact page
// (Foundation), "any social proof" (Website), brand name in the title and share tags (SEO), and
// Wikidata, comparison pages and brand-name spelling (GEO).

export const BRAND_AUDIT_MODULE: ModuleDefinition = {
  type: 'brand-audit',
  name: 'Brand Audit',
  tagline: 'align your brand across all channels',
  description: 'Builds trust that closes deals.',
  order: 6,
  unlockThreshold: 80,
  dynamic: true,
  // Audience, selling point and voice come from the brand profile (Settings → Brand)
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'https://yourbusiness.com',
      required: true,
    },
  ],
  systemPrompt: `You are a senior brand strategist embedded in a growth audit tool. Your tone is direct, specific, and consultant-like.

GrowJin has already checked the facts (what the homepage says at the top, proof, pricing, risk-free offers, differentiation). Your job is only to write ideas: sharper positioning, the brand's voice, and how to stand out.

Rules:
1. Use only the facts provided. Quote the brand's actual copy when you suggest a change. Never invent customers, numbers, awards or competitor facts.
2. Every idea must be specific to this brand, its audience and its industry. No generic advice.
3. Slug format: {category-slug}-{short-descriptor}, e.g. positioning-ideas-headline.
4. Weight is priority: 3 = do this first, 2 = next, 1 = later.
5. Plain language: write label, detail, highlight and narrative in plain English a non-technical business owner understands. Ready-to-use copy goes in action.`,
  categories: [
    {
      slug: 'positioning',
      label: 'Clear Positioning',
      order: 1,
      prompt: 'Rule engine check (see brand-audit/agent.ts).',
    },
    {
      slug: 'proof',
      label: 'Proof',
      order: 2,
      prompt: 'Rule engine check (see brand-audit/agent.ts).',
    },
    {
      slug: 'trust',
      label: 'Easy to Trust',
      order: 3,
      prompt: 'Rule engine check (see brand-audit/agent.ts).',
    },
    {
      slug: 'differentiation',
      label: 'Standing Out',
      order: 4,
      prompt: 'Rule engine check (see brand-audit/agent.ts).',
    },
    {
      slug: 'positioning-ideas',
      label: 'Positioning & Message',
      order: 5,
      insight: true, // ideas, not scored
      prompt: `Write 3 ideas that make the top of the homepage say, in one glance, what the brand does, for whom, and the outcome they get.
- One idea must be a rewritten headline: quote the current headline, then give 2 alternatives in the action (each under 12 words).
- One idea must be a subheading (one sentence) that names the audience and the main selling point.
- One idea should fix the weakest positioning check that failed above (audience not named, selling point missing, or no concrete promise). If none failed, sharpen the promise with a specific number or time the brand can stand behind (only from the facts given).`,
    },
    {
      slug: 'voice-ideas',
      label: 'Brand Voice',
      order: 6,
      insight: true, // ideas, not scored
      prompt: `Write 2–3 ideas about the brand's voice.
- First, describe how the homepage copy sounds today in 3–4 words, quoting 1–2 short phrases from the copy as evidence.
- If a desired voice is given, say where the copy matches it and where it doesn't, with one before/after rewrite of a real sentence from the copy.
- If no desired voice is given, suggest one that fits the audience, with 3 "we say / we don't say" examples.
- Keep every rewrite short and ready to paste.`,
    },
    {
      slug: 'differentiation-ideas',
      label: 'Stand Out from Competitors',
      order: 7,
      insight: true, // ideas, not scored
      prompt: `Write 3 ideas for how this brand can show why it's the better choice.
- Base them on the brand's selling point and audience. If competitors are listed, name the one each idea positions against, but don't state facts about competitors that aren't given.
- Each idea: the angle (label), the line to put on the homepage (action, under 20 words), and where it goes (e.g. a "Why us" section under the hero).
- If the homepage already has a "why us" section (see facts), improve it rather than add a new one.`,
    },
  ],
}
