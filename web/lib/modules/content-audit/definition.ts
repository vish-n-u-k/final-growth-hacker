import type { ModuleDefinition } from '../types'

export const CONTENT_AUDIT_MODULE: ModuleDefinition = {
  type: 'content-audit',
  name: 'Content Audit',
  description: 'Audit every page on your website — identify content gaps vs competitors, score quality and audience alignment, get blog topic ideas, a 30-day editorial calendar, and a per-page verdict (Keep, Refresh, Consolidate, Repurpose, Remove).',
  order: 6,
  unlockThreshold: 80,
  dynamic: true,
  requirements: [
    {
      key: 'target_audience',
      label: 'Target audience',
      type: 'text',
      placeholder: 'e.g. Enterprise CTOs, Small business owners, SaaS founders',
      required: true,
    },
    {
      key: 'business_goals',
      label: 'Primary business goal',
      type: 'text',
      placeholder: 'e.g. Increase free trial sign-ups, Drive product demos, Grow organic traffic',
      required: false,
    },
    {
      key: 'competitor_urls',
      label: 'Competitor URLs (optional — leave empty to use industry benchmarks)',
      type: 'url_list',
      placeholder: 'https://competitor1.com, https://competitor2.com',
      required: false,
    },
    {
      key: 'max_pages',
      label: 'Max pages to audit',
      type: 'text',
      placeholder: '30 (default)',
      required: false,
    },
  ],
  systemPrompt: `You are a senior content strategist embedded in a growth audit tool. Your tone is direct, specific, and consultant-like. You receive pre-processed data: per-page metadata summaries (title, meta description, H1, body excerpt, word count, image count, internal and external link counts) for every page on the site, plus the same metadata for any competitor pages provided.

Rules:
1. Only report what you can verify from the data provided. Never fabricate findings.
2. Every finding must cite specific page URLs, word counts, titles, or competitor names. No generic advice.
3. If no competitor URLs were provided, base gap analysis on industry best practices and clearly state this.
4. Slug format: {category-slug}-{short-descriptor} e.g. content-gap-missing-agile-content
5. Weight: 3 = directly losing traffic, leads, or conversions | 2 = measurably hurting content performance | 1 = nice-to-have improvement
6. verified: true = this check passes or content is strong | verified: false = gap or issue exists
7. fixable: true ONLY if the specific fix is changing a <title>, <meta description>, or <h1> tag on a specific named page — these are direct code changes the AI agent can make. fixable: false for everything else: adding content, creating new pages, expanding word count, adding images, internal linking strategy, content calendars, and competitor gap recommendations are all user actions, not code changes.
8. Be specific: cite exact page titles, exact word counts, exact competitor names. Never say "some pages" — name them.`,
  categories: [
    {
      slug: 'content-gap',
      label: 'Content Gap Analysis',
      order: 1,
      prompt: `Identify topics and content types your site is missing compared to competitors (or industry standards if no competitors provided).

Using the page summaries and competitor data:
- What topics do competitors cover that your site has zero content on?
- What content formats exist on competitor sites but not yours? (comparison pages, case studies, ROI calculators, integration guides, FAQs)
- Are there audience pain points evident in competitor content that you never address?
- Which missing topics are highest priority given the target audience and business goals?

If competitors were provided: cite specific competitor URLs for each gap.
If no competitors provided: cite industry best practice and what brands in this space typically cover.

Pass condition: site covers all major topics for the industry with appropriate formats.
Fail condition: missing a content type or topic that directly addresses the target audience's buying journey.

Weight 3: missing content that directly addresses purchase decisions (pricing comparisons, ROI, alternatives).
Weight 2: missing content that builds consideration (case studies, how-tos, integration guides).
Weight 1: missing content that builds awareness (thought leadership, trend articles).

Generate 4–6 findings.`,
    },
    {
      slug: 'foundational-inventory',
      label: 'Foundational Inventory',
      order: 2,
      prompt: `Assess the overall breadth, depth, and health of the content library.

Using the page summaries:
- Total pages found — is the library thin (< 10 pages), moderate (10–30), or substantial (30+)?
- Average word count across all pages — shallow (< 400), acceptable (400–800), or deep (800+)?
- Content type diversity — are there blogs, product/feature pages, case studies, about/company pages, a pricing page? Flag what's missing.
- Are there any pages with extremely thin content (< 200 words) that are likely indexed?

Pass condition: 15+ pages, avg word count > 600, has core page types (product, about, blog/resources).
Fail condition: fewer than 10 pages, avg word count < 400, or missing core page types.

Weight 3: fewer than 5 content pages total, or no blog/resource section at all.
Weight 2: average word count below 400, or missing a key page type like pricing or about.
Weight 1: minor gaps such as no case studies section.

Generate 3–5 findings.`,
    },
    {
      slug: 'business-alignment',
      label: 'Business Alignment & Audience Fit',
      order: 3,
      prompt: `Evaluate how well the site's content speaks directly to the target audience and supports the business goal.

Using the page summaries and the provided target_audience and business_goals:
- Do page titles, H1s, and meta descriptions use the language of the target audience?
- Does body content address the specific pain points of the target audience?
- Is there a clear CTA aligned with the business goal on key pages?
- Are there pages that seem off-topic or serve a different audience entirely?
- Is messaging consistent across pages, or does tone and audience focus vary significantly?

Pass condition: majority of pages use audience-specific language and carry a CTA aligned with the business goal.
Fail condition: pages use generic language, audience terms absent, no goal-aligned CTAs visible.

Weight 3: zero audience-specific language across the site, or no CTA aligned with business goal anywhere.
Weight 2: most pages lack audience terms or CTA alignment.
Weight 1: minor inconsistency in messaging across a few pages.

Generate 4–6 findings. Cite specific page titles and exact missing terms.`,
    },
    {
      slug: 'quality-substance',
      label: 'Quality & Substance',
      order: 4,
      prompt: `Evaluate per-page content quality using the metrics provided.

For each page assess:
- Word count: < 300 = thin | 300–800 = acceptable | > 800 = good
- Image count: 0 = poor | 1–2 = ok | 3+ = good
- Internal links: < 3 = poor | 3–5 = ok | 5+ = good
- External links: 0 = no authority signals | 1+ = ok

Identify pages that score poorly across multiple dimensions simultaneously — these are highest priority for refresh or removal.

At the site level assess:
- Are there multiple pages with identical or very similar titles? (keyword cannibalization)
- Are there pages with 0 images and < 300 words? (Remove candidates)
- Is internal linking generally weak across the site?

Pass condition: majority of pages have 600+ words, 2+ images, 3+ internal links.
Fail condition: multiple pages with thin content, no images, or no internal links.

Weight 3: 3+ pages with fewer than 200 words that are likely indexed.
Weight 2: average internal links below 2, or majority of pages have no images.
Weight 1: minor quality gaps on a few secondary pages.

Generate 4–6 findings. Name specific pages by their title.`,
    },
    {
      slug: 'blog-topics',
      label: 'Blog Topic Ideas',
      order: 5,
      prompt: `Generate specific, actionable blog post topic ideas based on the gaps and audience context identified.

Using the content gaps, audience description, business goals, and competitor content:
- Generate 8–12 specific blog post titles (not vague themes — actual publishable post titles)
- Each topic must target a specific audience pain point or search intent
- Prioritize topics that directly fill identified content gaps
- Mix content stages: ~4 awareness (broad educational), ~5 consideration (comparison, how-to), ~3 decision (specific use cases, ROI)
- For each topic note: the audience intent it targets and which gap it fills

Format the action field as a numbered list:
"1. '[Exact Post Title]' — targets [audience intent], fills gap on [topic]
2. '[Exact Post Title]' — [brief rationale]
..."

verified: false | weight: 2
Generate exactly 1 finding with slug: "blog-topics-recommendations"`,
    },
    {
      slug: 'content-calendar',
      label: 'Content Calendar',
      order: 6,
      prompt: `Generate a structured 30-day editorial calendar based on the blog topics and content priorities identified.

Generate exactly 1 finding with slug: "content-calendar-30-day".

The action field must contain ONLY a valid JSON array with exactly 12 entries, no text before or after it:
[{"date":"YYYY-MM-DD","topic":"Exact post title","category":"Category name","format":"Blog post|Case study|Landing page|Guide","priority":"High|Medium|Low","stage":"Awareness|Consideration|Decision"},...]

Rules for the calendar:
- Use today's date as the start, space entries 2–3 days apart
- Balance stages: ~4 Awareness, ~5 Consideration, ~3 Decision
- High priority items scheduled first
- Category names must match content pillars from the Content Categories analysis
- Every topic must be a specific publishable title, not a vague theme
- verified: false | weight: 1`,
    },
    {
      slug: 'content-categories',
      label: 'Content Categories',
      order: 7,
      prompt: `Identify the core content pillars this brand should build around, and flag underrepresented areas.

Using all page summaries, competitor data, audience description, and business goals:
- Identify 3–5 core themes the existing content actually clusters around
- Identify 3–5 recommended content pillars (what the site should be known for given audience and goals)
- Flag which pillars are well-covered vs underrepresented
- Recommend content volume targets per pillar (e.g. "needs 5 pillar pages + 10 supporting posts")

Pass condition: 3+ content pillars each with 5+ pages of depth.
Fail condition: content is scattered with no clear pillars, or pillars exist but have only 1–2 pages each.

Weight 3: no identifiable content pillars — content is completely scattered with no thematic coherence.
Weight 2: pillars exist but 1–2 have fewer than 3 supporting pages.
Weight 1: minor imbalance between pillar coverage.

Generate 3–5 findings. Name each pillar explicitly and cite how many pages currently support it.`,
    },
  ],
}
