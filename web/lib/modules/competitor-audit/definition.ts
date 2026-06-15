import type { ModuleDefinition } from '../types'

export const COMPETITOR_AUDIT_MODULE: ModuleDefinition = {
  type: 'competitor-audit',
  name: 'Competitor Audit',
  description: 'Analyze your competitors across 8 dimensions — discover who they are, find keyword and content gaps, benchmark SEO and social media, uncover ad strategies, and get a complete SWOT analysis.',
  order: 3,
  unlockThreshold: 0,
  dynamic: true,
  requirements: [
    {
      key: 'competitor_urls',
      label: 'Competitor website URLs',
      type: 'url_list',
      placeholder: 'https://competitor1.com, https://competitor2.com',
      required: true,
    },
    {
      key: 'industry_keywords',
      label: 'Main industry keywords (optional — helps focus the gap analysis)',
      type: 'text_list',
      placeholder: 'saas, project management, team collaboration',
      required: false,
    },
  ],
  systemPrompt: `You are a competitive intelligence analyst. Your tone is direct, data-driven, and consultant-style — no fluff, no filler. Use plain, layman language that anyone can understand. Be specific about what competitors are doing better than the user.

Rules you must follow:
- Only report what you can verify from the data provided (competitor URLs, website details, and any publicly accessible information).
- Reference exact values, URLs, keywords, or metrics you find. Do not guess.
- If data is missing or unavailable, state "not found" or "unable to verify" — do not invent findings.
- For each gap you identify, explain specifically which competitor has the advantage and what they are doing.
- Prioritize findings by business impact: critical issues first, then important, then minor.
- When comparing, always cite the specific competitor by name or URL.

Pass vs. fail definition:
- verified: true = user is on par or ahead in this area
- verified: false = this is a gap the user needs to close
- weight 3 = critical gap that directly blocks growth or gives competitors a major advantage
- weight 2 = important gap that meaningfully hurts performance if left unfixed
- weight 1 = minor gap that is nice to fix but not urgent`,
  categories: [
    {
      slug: 'competitor-discovery',
      label: 'Competitor Discovery',
      order: 1,
      prompt: `Analyze each competitor URL. For each: classify as direct, indirect, or aspirational competitor; estimate market position (leader, challenger, niche player, or new entrant); identify primary business model (SaaS, ecommerce, marketplace, agency, etc.).

Flag if: a competitor URL seems irrelevant (different industry entirely) → weight 2; user appears to be missing a major direct competitor that should be in this list → weight 3.

Generate 3–5 items covering what was discovered and any gaps in the competitor list itself.`,
    },
    {
      slug: 'keyword-gap',
      label: 'Keyword Gap',
      order: 2,
      prompt: `Based on competitor homepage content, title tags, meta descriptions, H1s, and page copy: identify keywords and phrases competitors are clearly targeting that the user's site does not appear to target. Look for commercial intent keywords, category terms, and comparison terms (e.g. "best X", "X alternative", "X vs Y").

Weight 3 = competitor targets a high-commercial-intent keyword user completely ignores. Weight 2 = competitor targets relevant category keywords more explicitly. Weight 1 = minor keyword opportunities.

Generate 3–6 items for specific keyword gaps you observe.`,
    },
    {
      slug: 'content-gap',
      label: 'Content Gap',
      order: 3,
      prompt: `Analyze competitor website structure and content visible in the HTML (nav links, section headings, page sections, blog/resource links, case study links, etc.). Identify content types or sections competitors have that the user's site lacks.

Flag: missing blog/resource section → weight 3 if competitors use it heavily; missing case studies, comparison pages, or pricing page → weight 2; minor content format differences → weight 1.

Generate 3–5 items for content structure and format gaps.`,
    },
    {
      slug: 'seo-gap',
      label: 'SEO Gap',
      order: 4,
      prompt: `Compare technical SEO signals visible in the competitor HTML vs. the user's site. Check: title tag quality (length, keyword inclusion), meta description presence, canonical tag, OG tags, structured data (JSON-LD), sitemap/robots reference, heading hierarchy.

Weight 3 = critical SEO issue the user has but competitors have fixed. Weight 2 = competitor has meaningfully better on-page SEO fundamentals. Weight 1 = minor differences.

Generate 3–5 items for specific SEO gaps you can verify from the HTML.`,
    },
    {
      slug: 'social-media-gap',
      label: 'Social Media Gap',
      order: 5,
      prompt: `Look for social media presence signals in competitor HTML: social links in footer/header (Twitter/X, LinkedIn, Instagram, YouTube, Facebook, TikTok), social proof widgets, follower count indicators, or embedded social content.

Flag: competitor prominently links to platforms user doesn't have → weight based on platform importance; competitor shows social proof metrics (e.g. "10k followers") user doesn't → weight 2; minor differences → weight 1.

Generate 2–4 items based on what you can observe from the HTML.`,
    },
    {
      slug: 'ad-strategy-gap',
      label: 'Ad Strategy Gap',
      order: 6,
      prompt: `Look for advertising signals in competitor HTML: Google/Meta pixel scripts, retargeting pixels (fbq, gtag with ads config), UTM parameters in links, ad-specific landing page patterns, "as seen in" press mentions suggesting paid PR. Note: you cannot access ad libraries from HTML alone — flag what you can observe.

Weight 3 = competitor appears to run significant paid acquisition (multiple ad pixels, dedicated landing pages) while user doesn't. Weight 2 = competitor has retargeting infrastructure user lacks. Weight 1 = minor differences.

Generate 2–4 items based on observable signals.`,
    },
    {
      slug: 'market-positioning',
      label: 'Market Positioning',
      order: 7,
      prompt: `Analyze competitor homepage messaging: hero headline, sub-headline, value proposition, target audience signals, pricing page presence, feature claims, trust signals (logos, user counts, awards), and unique selling points. Compare against the user's site messaging.

Flag: competitor has a clearer, more specific value prop targeting the same audience → weight 2–3; competitor dominates a specific segment user could serve → weight 3; competitor's CTA or pricing is more compelling → weight 2; minor messaging differences → weight 1.

Generate 3–6 items comparing positioning approaches.`,
    },
    {
      slug: 'swot-analysis',
      label: 'SWOT Analysis',
      order: 8,
      prompt: `Synthesize the findings from all other categories into a SWOT analysis. Generate exactly 4 items: one Strength, one Weakness, one Opportunity, one Threat. Make each specific to what was actually found in the competitor data — not generic.

- Strength (verified: true, weight 2): What does the user appear to do better or differently than competitors?
- Weakness (verified: false, weight 2–3): Where do competitors consistently outperform the user?
- Opportunity (verified: false, weight 2): What gap can the user exploit that competitors are missing?
- Threat (verified: false, weight 3): What competitive move poses the biggest risk to the user's position?

Generate exactly these 4 items with slugs: "swot-strength", "swot-weakness", "swot-opportunity", "swot-threat".`,
    },
  ],
}
