import type { ModuleDefinition } from '../types'

export const LINK_BUILDING_MODULE: ModuleDefinition = {
  type: 'link-building',
  name: 'Link Building',
  description: 'Identify the highest-value places to earn your first backlinks — directories, review platforms, communities, and media coverage tailored to your product.',
  order: 8,
  unlockThreshold: 0,
  dynamic: true,
  requirements: [
    {
      key: 'industry',
      label: 'What does your app do? (one line)',
      type: 'text',
      placeholder: 'e.g. AI video generation tool for content creators',
      required: true,
    },
  ],
  systemPrompt: `You are a link building specialist for early-stage SaaS and AI tools. Your job is to identify specific, actionable places where a new app can get listed, reviewed, or covered to earn their first high-value backlinks.

Rules:
1. Be specific — every suggestion must name the exact platform, never a category.
2. Include submission details in the action field — the exact URL to submit, what they look for, and what to write.
3. Prioritise by domain authority and traffic — weight 3 for high-authority platforms, weight 2 for mid-tier, weight 1 for niche but relevant.
4. Free opportunities only — no paid placements or sponsored listings.
5. All items start as not done (verified: false) — the user will mark them complete after submitting.
6. fixable is always false — these are external actions the user must take themselves.
7. Tailor every suggestion to the specific product and industry. Do not generate generic lists.
8. Never suggest the same platform twice across categories.`,
  categories: [
    {
      slug: 'tool-directories',
      label: 'Tool Directories',
      order: 1,
      prompt: `Generate 8-10 specific AI tool directories and product aggregators where this app should get listed. These are sites that maintain curated lists of tools and link back to each product.

For each platform:
- Name it specifically (e.g. "Futurepedia", "There's An AI For That", "Product Hunt")
- In the action field: include the exact submission URL, what the submission form asks for (tagline length, categories, screenshots), and one tip for getting accepted or featured
- Weight 3: Product Hunt, major AI directories with 100k+ monthly visitors
- Weight 2: Mid-size directories with 10k-100k visitors relevant to this niche
- Weight 1: Smaller but niche-relevant aggregators

Focus on directories that are a natural fit for this specific product category.`,
    },
    {
      slug: 'review-platforms',
      label: 'Review Platforms',
      order: 2,
      prompt: `Generate 4-6 review and comparison platforms where this app should create a listing and gather early reviews. Reviews on these platforms build trust signals and high-authority backlinks.

For each platform:
- Name it specifically (e.g. "G2", "Capterra", "Trustpilot", "AlternativeTo")
- In the action field: include the exact URL to claim or create a listing, what profile information they require, and how to get the first 5 reviews quickly (e.g. ask existing users, team members for initial reviews)
- Weight 3: G2, Capterra, and any platform with a strong presence in this product category
- Weight 2: Mid-tier review sites with decent domain authority
- Weight 1: Smaller comparison sites specific to this niche

Only include platforms where this type of product genuinely belongs.`,
    },
    {
      slug: 'communities',
      label: 'Communities',
      order: 3,
      prompt: `Generate 5-7 online communities where this product's target audience is active and where sharing new tools is welcomed. These include subreddits, Slack groups, Discord servers, and niche forums.

For each community:
- Name it specifically (e.g. "r/videography", "Indie Hackers community", "Creator Economy Slack")
- In the action field: include the direct URL, community size or activity level if known, what kind of posts work (e.g. "Show HN style launch post", "tool review thread", "feedback request"), and what NOT to do to avoid being flagged as spam
- Weight 3: Large active communities directly relevant to the product's use case
- Weight 2: Medium communities with engaged members
- Weight 1: Smaller niche communities worth being present in

Only include communities where the target audience genuinely hangs out.`,
    },
    {
      slug: 'media-coverage',
      label: 'Media & Press',
      order: 4,
      prompt: `Generate 4-6 specific media opportunities — newsletters, YouTube channels, blogs, or podcasts — that regularly cover new tools in this product category and accept submissions or pitches.

For each opportunity:
- Name it specifically (e.g. "Ben's Bites newsletter", "The AI Breakdown podcast", "MKBHD YouTube channel")
- In the action field: include the exact submission or pitch URL (or contact email if known), what they look for in a pitch, the best angle for this specific product, and ideal pitch length
- Weight 3: High-reach media with 50k+ subscribers directly relevant to this niche
- Weight 2: Mid-size media with engaged audiences in this space
- Weight 1: Smaller but targeted media worth pitching

Focus on media that has actually covered similar tools before, not general tech media.`,
    },
  ],
}
