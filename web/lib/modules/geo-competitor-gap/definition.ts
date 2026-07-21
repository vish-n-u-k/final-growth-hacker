import type { ModuleDefinition } from '../types'

export const GEO_COMPETITOR_GAP_MODULE: ModuleDefinition = {
  type: 'geo-competitor-gap',
  name: 'GEO Competitor Gap',
  tagline: 'close AI visibility gaps vs competitors',
  description: 'Shows you where AI tools recommend your competitors instead of you — and what to do about it.',
  order: 5,
  unlockThreshold: 80,
  dynamic: true,
  comingSoon: true,
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'yourdomain.com',
      required: false,
    },
    {
      key: 'competitor_urls',
      label: 'Competitor URLs (up to 3, comma-separated)',
      type: 'url_list',
      placeholder: 'competitor1.com, competitor2.com, competitor3.com',
      required: true,
    },
  ],
  systemPrompt: `You are a GEO (Generative Engine Optimization) specialist comparing a brand's AI visibility signals against their competitors.

Your job: identify specific structural gaps where competitors outperform the brand on signals that directly predict higher AI citation rates.

Rules:
- Only report gaps where a competitor has a CLEAR structural advantage the brand lacks — skip where everyone fails equally or the brand is ahead
- Each item must name the specific competitor and the measurable difference (e.g. "competitor1.com has llms.txt with 14 links — you have none")
- verified: true = brand is at parity or ahead | verified: false = gap exists, competitor leads
- Weight: 3 = directly drives AI citation (llms.txt, FAQPage schema, blocking AI bots) | 2 = meaningful signal difference | 1 = emerging standard gap
- Actions must be concrete: name the exact file to create or code to add, max 2 sentences
- fixable: false for all items
- If a category has no meaningful gaps, output one verified:true item confirming parity
- Plain language: Write label, detail, highlight, and narrative in plain English that a non-technical business owner can understand — explain what the signal does, not just its technical name. Technical commands and file names belong only in the action field.`,
  categories: [
    {
      slug: 'llms-txt-gap',
      label: 'LLMs.txt Gaps',
      order: 1,
      prompt: `Compare the user's llms.txt signals against each competitor's. Surface gaps where competitors have llms.txt and the user doesn't, or where a competitor has significantly more links/sections. If the user has llms.txt and all competitors don't, report that as a verified:true win. Generate 1–3 findings.`,
    },
    {
      slug: 'schema-gap',
      label: 'Schema Gaps',
      order: 2,
      prompt: `Compare JSON-LD schema coverage: FAQPage, Organization+sameAs, WebSite, Article/BlogPosting. For each type where a competitor has it and the user doesn't, generate one finding. If the user has schema types no competitor has, report those as verified:true wins. Generate 1–4 findings.`,
    },
    {
      slug: 'robots-gap',
      label: 'AI Bot Access Gaps',
      order: 3,
      prompt: `Compare AI bot access in robots.txt. Only flag a gap if a competitor EXPLICITLY allows a bot the user blocks. If all sites equally ignore (not-mentioned) or block a bot, skip it — that is not a gap. If all are equal, output one verified:true item confirming parity. Generate 1–3 findings.`,
    },
    {
      slug: 'content-gap',
      label: 'Content Signal Gaps',
      order: 4,
      prompt: `Compare content citability signals: stats count, FAQ-style headings, and list item counts. Only flag meaningful differences — e.g. competitor has 8 stats and user has 1 is significant; competitor has 4 and user has 3 is not. Generate 1–3 findings.`,
    },
    {
      slug: 'technical-gap',
      label: 'Technical Signal Gaps',
      order: 5,
      prompt: `Compare technical signals: html lang attribute, content freshness dates (article:modified_time or dateModified in JSON-LD), and RSS/Atom feed presence. Flag only where a competitor has a signal the user is missing. Generate 1–3 findings.`,
    },
    {
      slug: 'discovery-gap',
      label: 'AI Discovery Gaps',
      order: 6,
      prompt: `Compare AI discovery endpoints: /.well-known/ai.txt, /ai/summary.json, /ai/faq.json, /ai/service.json. For each endpoint a competitor has that the user doesn't, generate one finding. If none of the competitors have any discovery endpoints either, output one verified:true item noting equal footing. Generate 1–4 findings.`,
    },
  ],
}
