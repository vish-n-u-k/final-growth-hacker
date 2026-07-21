import type { ModuleDefinition } from '../types'

export const OUTREACH_TARGETS_MODULE: ModuleDefinition = {
  type: 'outreach-targets',
  name: 'Outreach Targets',
  tagline: 'get featured on your competitors\' platforms',
  description: 'Serves up high-intent buyers.',
  order: 14,
  unlockThreshold: 80,
  dynamic: true,
  requirements: [
    {
      key: 'competitor_urls',
      label: 'Competitor URLs (up to 5)',
      type: 'url_list',
      placeholder: 'https://competitor1.com, https://competitor2.com',
      required: true,
    },
  ],
  systemPrompt: `You are an outreach specialist for early-stage SaaS and AI tools. You receive a list of external links extracted from competitor websites, along with the context of where each link appeared (press sections, partner pages, blog posts, footers, etc.).

Your job is to identify which of these sites are genuine outreach opportunities and generate personalised pitches for each.

Rules:
1. Only include sites that are genuine opportunities — media coverage, partnerships, directories, resource mentions, community platforms. Skip generic utility links (payment processors, stock photo sites, analytics tools, font providers).
2. Each item must be a specific domain worth reaching out to, not a category.
3. The pitch in the action field must reference why this site already links to a competitor — use that as the hook.
4. verified: always false — these are things the user still needs to do.
5. fixable: always false — all external actions.
6. Weight: 3 = high DA site or press outlet that covered a competitor | 2 = niche directory or community that links to competitors | 1 = smaller resource page or blog mention.
7. Slug format: {category-slug}-{domain-short} e.g. press-coverage-techcrunch
8. Plain language: Write label, detail, highlight, and narrative in plain English that any business owner can understand — no jargon. Save contact methods, URLs, and technical pitch details for the action field only.`,
  categories: [
    {
      slug: 'press-coverage',
      label: 'Press & Media Coverage',
      order: 1,
      prompt: `Identify links found in competitor press sections, "As Seen In" badges, blog posts referencing external publications, or any media/news domain. These are journalists, newsletters, or publications that covered the competitor and may cover this product too.

For each, generate:
- label: "Pitch to [publication name]"
- detail: 1 sentence — what this publication is and that they covered [competitor]
- narrative: why getting covered here matters (audience size, credibility, backlink authority)
- action: a specific pitch strategy — what angle to use, the ideal pitch length, and where to send it (editor@ email pattern or submission form if known)`,
    },
    {
      slug: 'partner-ecosystem',
      label: 'Partner & Ecosystem Sites',
      order: 2,
      prompt: `Identify links found in competitor integration pages, partner sections, footer partner logos, "Works with" sections, or app marketplace listings. These are platforms or tools that partner with competitors and may partner with this product too.

For each, generate:
- label: "Partner with [site name]" or "Get listed on [platform]"
- detail: 1 sentence — what this platform does and that competitors are already listed/partnered there
- narrative: what a partnership or listing here achieves (distribution, backlink, co-marketing)
- action: exact steps to apply for a partnership or listing, including the relevant URL from their site`,
    },
    {
      slug: 'resource-opportunities',
      label: 'Resource & Community Links',
      order: 3,
      prompt: `Identify links found in competitor blog posts, resource pages, tutorial content, or community mentions — sites that link out to tools as recommendations or in educational content.

For each, generate:
- label: "Get mentioned on [site name]"
- detail: 1 sentence — what this site is and the context in which they link to the competitor
- narrative: why getting mentioned here is valuable (audience match, link equity, referral traffic potential)
- action: specific outreach approach — who to contact, what to say, and the angle that will work given they already link to a competitor`,
    },
    {
      slug: 'competitor-mentions',
      label: 'Sites Covering Competitors',
      order: 4,
      prompt: `These sites appeared in Google search results for competitor review and alternative queries — meaning they have already written content about this niche. They are prime outreach targets because they are actively looking for tools to cover.

For each, generate:
- label: "Get featured on [site name]" or "Get reviewed by [site name]"
- detail: 1 sentence — what this site published (review, comparison, alternatives list) and which competitor they covered
- narrative: why getting featured here matters — these sites have readers actively comparing tools and may be open to covering a new entrant
- action: specific outreach strategy — what type of pitch to send, what angle to use (e.g. "we're a newer alternative with X advantage"), and how to find the right contact`,
    },
  ],
}
