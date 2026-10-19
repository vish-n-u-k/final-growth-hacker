import type { ModuleDefinition } from '../types'

// Content Audit: is there a body of content, is it kept up, is each piece substantial, and does it
// lead readers to the product? The facts are fixed rule checks (see content-audit/agent.ts) with
// stable slugs, so ticks and the score stay put between runs; each page also gets a Keep / Refresh /
// Consolidate / Remove verdict, shown in a table. Claude only writes ideas (gaps, blog topics, a
// 30-day plan), which are shown as ideas and never scored.

export const CONTENT_AUDIT_MODULE: ModuleDefinition = {
  type: 'content-audit',
  name: 'Content Audit',
  tagline: 'improve and prune your website content',
  description: 'Wins more ranking keywords.',
  order: 7,
  unlockThreshold: 80,
  dynamic: true,
  // Audience, selling point and industry come from the brand profile (Settings → Brand)
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'https://yourbusiness.com',
      required: true,
    },
  ],
  systemPrompt: `You are a senior content strategist embedded in a growth audit tool. Your tone is direct, specific, and consultant-like.

GrowJin has already checked the facts (how much content there is, how fresh, how substantial, whether it links to the product) and given each page a verdict. Your job is only to write ideas: content gaps, blog posts to write, and when to publish them.

Rules:
1. Use only the facts provided. Base ideas on the brand's audience, selling point and the pages that exist. Never invent traffic numbers, rankings or competitor content.
2. Never suggest a topic the site already covers (see the page titles).
3. Every idea must be specific to this brand and audience. No generic advice.
4. Slug format: {category-slug}-{short-descriptor}, e.g. blog-topics-post-daily-without-a-manager.
5. Weight is priority: 3 = do this first, 2 = next, 1 = later.
6. Plain language: write label, detail, highlight and narrative in plain English a non-technical business owner understands.`,
  categories: [
    {
      slug: 'content-library',
      label: 'Your Content',
      order: 1,
      prompt: 'Rule engine check (see content-audit/agent.ts).',
    },
    {
      slug: 'content-quality',
      label: 'Page Quality',
      order: 2,
      prompt: 'Rule engine check (see content-audit/agent.ts).',
    },
    {
      slug: 'content-gaps',
      label: 'Content Gaps',
      order: 3,
      insight: true, // ideas, not scored
      prompt: `Write 3–4 ideas for content the site is missing, given its audience, selling point and the pages that exist.
- Think about the buyer's journey: comparison or "alternatives" pages, how-to guides for the audience's main jobs, customer stories, a free tool or template the audience would use.
- Name the page to create in the label (e.g. "A "Frekto vs Buffer" page"), say who it helps and why in detail/narrative, and give the first step in action.
- If the site already has content of a kind, don't suggest it again.`,
    },
    {
      slug: 'blog-topics',
      label: 'Blog Topic Ideas',
      order: 4,
      insight: true, // ideas, not scored
      prompt: `Write exactly 6 blog posts to publish next, one item each.
- label: the exact, publishable post title (under 70 characters), written for the audience.
- detail: who it's for and what they're searching for, in one sentence; put the search phrase in **double asterisks**.
- highlight: the stage, exactly one of "Awareness", "Consideration" or "Decision".
- narrative: why this post brings the right readers to this brand.
- action: a short outline, the 3–4 section headings separated by " · ".
- Mix stages: 2 Awareness, 2 Consideration, 2 Decision. Weight 3 for Decision posts, 2 for Consideration, 1 for Awareness.`,
    },
    {
      slug: 'content-calendar',
      label: 'Publishing Plan',
      order: 5,
      insight: true, // built from the blog topic ideas (see agent.ts), not by Claude
      prompt: '',
    },
  ],
}
