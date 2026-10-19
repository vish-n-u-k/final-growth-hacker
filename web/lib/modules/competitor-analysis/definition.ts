import type { ModuleDefinition } from '../types'

// Competitor Analysis: side by side with up to 3 competitors, does your site match what theirs
// offer, prove and publish? The facts are fixed "parity" checks (see competitor-analysis/agent.ts):
// one fails only when a competitor has something you don't. Claude only writes ideas (how to stand
// apart, keyword ideas, a SWOT), which are shown as ideas and never scored.
//
// Comparison pages are left to GEO (which also checks the blog for them), and page speed and tags
// to the SEO and Website audits.

export const COMPETITOR_ANALYSIS_MODULE: ModuleDefinition = {
  relevantFor: ['saas', 'ecommerce', 'agency', 'blog', 'local'],
  type: 'competitor-analysis',
  name: 'Competitor Analysis',
  tagline: 'find gaps your competitors leave open',
  description: 'Steals their audience and sales.',
  order: 8,
  unlockThreshold: 80,
  dynamic: true,
  requirements: [
    {
      key: 'competitor_urls',
      label: 'Competitor websites',
      type: 'url_list',
      placeholder: 'Up to 3, e.g. buffer.com, later.com. Leave empty and GrowJin will suggest some.',
      required: false,
    },
  ],
  systemPrompt: `You are an expert competitor analyst embedded in a growth audit tool. Your tone is direct, specific, and consultant-like.

GrowJin has already compared the sites side by side (pricing, free start, proof, articles) using what each homepage shows. Your job is only to write ideas: how this brand can stand apart, which phrases competitors lead with, and a short SWOT.

Rules:
1. Use only the facts provided: each site's title, description, headline, headings and the comparison table. Quote competitors' actual words when you refer to their claims.
2. Never state facts about a competitor that aren't in the data (features, prices, customers, funding).
3. Every idea must be specific to this brand and name the competitor it relates to.
4. Slug format: {category-slug}-{short-descriptor}, e.g. stand-apart-ideas-inbox-approval.
5. Weight is priority: 3 = do this first, 2 = next, 1 = later.
6. Plain language: write label, detail, highlight and narrative in plain English a non-technical business owner understands. Ready-to-use copy goes in action.`,
  categories: [
    {
      slug: 'offer',
      label: 'Offer & Pricing',
      order: 1,
      prompt: 'Rule engine check (see competitor-analysis/agent.ts).',
    },
    {
      slug: 'proof',
      label: 'Proof',
      order: 2,
      prompt: 'Rule engine check (see competitor-analysis/agent.ts).',
    },
    {
      slug: 'content',
      label: 'Content',
      order: 3,
      prompt: 'Rule engine check (see competitor-analysis/agent.ts).',
    },
    {
      slug: 'stand-apart-ideas',
      label: 'How to Stand Apart',
      order: 4,
      insight: true, // ideas, not scored
      prompt: `Write 3 ideas for how this brand can stand apart from the competitors listed.
- Compare the headlines and claims: what does each competitor lead with (quote it)? What does no one claim that this brand can honestly own, given its selling point?
- Each idea: the angle (label), which competitor it positions against (detail), why buyers would care (narrative), and the line to put on the homepage (action, under 20 words).`,
    },
    {
      slug: 'keyword-ideas',
      label: 'Phrases They Lead With',
      order: 5,
      insight: true, // ideas, not scored
      prompt: `Write 3–4 ideas from the phrases competitors use in their titles, descriptions, headlines and headings that this brand's homepage doesn't use.
- label: the phrase, in quotes. detail: which competitor uses it and where (title, headline, heading). narrative: why it matters (it's how buyers describe what they want).
- action: where this brand should use it (a page title, a heading, a new page) — only if it honestly fits what the brand offers.`,
    },
    {
      slug: 'swot',
      label: 'SWOT',
      order: 6,
      insight: true, // ideas, not scored
      prompt: `Write exactly 4 items with these slugs: "swot-strength", "swot-weakness", "swot-opportunity", "swot-threat".
- Base them on the comparison table and the sites' claims. Strength: where this brand matches or leads. Weakness: where competitors lead (from the table). Opportunity: the quickest gap to close or an angle no one owns. Threat: a competitor advantage that could win the same buyers.
- label starts with "Strength:", "Weakness:", "Opportunity:" or "Threat:". action: the one thing to do about it this month.`,
    },
  ],
}
