import type { ModuleDefinition } from '../types'

export const COMPETITOR_ANALYSIS_MODULE: ModuleDefinition = {
  type: 'competitor-analysis',
  name: 'Competitor Analysis',
  description: 'Discover competitors, compare keywords, content, SEO, social media, and ads — then get a SWOT action plan.',
  order: 4,
  unlockThreshold: 80,
  dynamic: true,
  requirements: [
    {
      key: 'competitor_urls',
      label: 'Competitor URLs (leave empty to auto-discover)',
      type: 'url_list',
      placeholder: 'https://competitor1.com, https://competitor2.com',
      required: false,
    },
    {
      key: 'industry',
      label: 'Industry / main keyword',
      type: 'text',
      placeholder: 'e.g. project management software',
      required: true,
    },
  ],
  systemPrompt: `You are an expert competitor analyst embedded in a growth audit tool. Your tone is direct, specific, and consultant-like. You receive pre-processed data: extracted meta information, keyword term sets from TF-IDF analysis, page speed scores, and HTML content snippets.

Rules:
1. Only report what you can verify from the data provided. Never fabricate findings.
2. Every finding must reference specific data: cite competitor URLs, exact keywords, exact scores. No generic advice.
3. If a competitor's data shows "FETCH FAILED", note them in discovery but skip data-dependent checks for them.
4. Slug format: {category-slug}-{short-descriptor} e.g. keyword-gap-predictive-scoring
5. Weight: 3 = gap directly costs revenue or rankings | 2 = measurably hurts performance | 1 = nice-to-have
6. verified: true = user at parity or ahead | verified: false = gap exists, action needed
7. fixable: true ONLY if the fix is a direct code change to an existing file — rewriting a meta description or title tag to include a missing keyword, adding OG tags, adding JSON-LD schema markup, creating a new comparison landing page file (/vs-competitor or /alternatives). fixable: false for everything else (build features, change pricing, create social accounts, strategic repositioning, external platform actions)`,
  categories: [
    {
      slug: 'competitor-discovery',
      label: 'Competitor Discovery',
      order: 1,
      prompt: `Based on the competitor data provided (or inferred from the user's homepage and industry keyword if none were given), describe each competitor: why they are a competitor, what audience they target, and their primary observable strength. If competitors were not provided by the user, clearly flag these as inferred. Generate one finding per competitor (3–5 total). verified: true if confirmed via a URL the user provided. verified: false if inferred or fetch failed.`,
    },
    {
      slug: 'feature-comparison',
      label: 'Feature Comparison',
      order: 2,
      prompt: `Analyze each competitor's product capabilities from their website content (feature sections, pricing pages, product tours, nav structure, etc.). For each distinct feature category (e.g., "Real-time Collaboration", "AI-powered automation", "Mobile app", "API/Integrations", "Analytics dashboard", "Team permissions", "Workflow automation", "Content calendar"), identify which competitors promote it prominently.

Generate 4–6 findings, each comparing one feature category across competitors:

For each finding:
1. State the feature name / category clearly
2. List which competitors prominently feature it (cite by name and URL)
3. Note if the user appears to lack this capability
4. Explain business impact (why teams need this feature in your category)

Weight by importance to your market:
- Weight 3: Core feature all/most competitors have that user is missing
- Weight 2: Differentiator feature one or two competitors lead with
- Weight 1: Emerging or nice-to-have capability

Example: "Real-time collaboration: Buffer and Hootsuite both emphasize team real-time posting and scheduling. The user's site doesn't highlight live collaboration features, which is table-stakes for social teams."

verified: false for all missing features. fixable: false for feature gaps (require product development).`,
    },
    {
      slug: 'keyword-gap',
      label: 'Keyword Gap',
      order: 3,
      prompt: `Compare the TF-IDF keyword fingerprints and heading/meta data provided. Identify 2–4 word commercial-intent phrases that appear strongly in competitor meta titles, H1s, H2s, and body content but are absent from the user's site. Generate 3–5 findings. For each, cite the specific competitor and term. Action: "Create a landing page or blog post targeting '[keyword]'. Competitor [URL] targets this term prominently." Weight by commercial relevance and specificity.`,
    },
    {
      slug: 'content-gap',
      label: 'Content Gap',
      order: 4,
      prompt: `Compare the body content samples. Identify content themes, page types, or formats present in competitor content (comparison pages, case studies, pricing pages, FAQs, integration lists, testimonials with specifics) that are clearly absent from the user's site. Generate 3–5 findings. For each, suggest a specific content format and cite the competitor who has it. Action example: "Competitor X has a detailed comparison page. Create a '[Your Product] vs [Competitor]' page targeting decision-stage visitors."`,
    },
    {
      slug: 'seo-gap',
      label: 'SEO Gap',
      order: 5,
      prompt: `Using the meta data, image stats, and PageSpeed scores provided, compare: page speed (flag if competitor is >20 points higher), meta title quality and length, meta description presence, H1 structure (single H1, keyword-relevant), image alt coverage (flag if competitor has >80% and user has <50%), schema markup presence, internal link count. For any metric where a competitor is materially better, generate one specific finding with an exact fix. Skip metrics where both user and competitors are equally weak. Generate 3–5 findings.`,
    },
    {
      slug: 'social-gap',
      label: 'Social Media Gap',
      order: 6,
      prompt: `IMPORTANT: Social media gap findings are computed deterministically before this Claude call and merged separately. Do NOT include any findings with category "social-gap" in your response.`,
    },
    {
      slug: 'ad-gap',
      label: 'Ad Strategy Gap',
      order: 7,
      prompt: `IMPORTANT: Ad strategy gap findings are computed deterministically before this Claude call and merged separately. Do NOT include any findings with category "ad-gap" in your response.`,
    },
    {
      slug: 'positioning',
      label: 'Market Positioning',
      order: 8,
      prompt: `Extract the user's positioning from their H1, first paragraph, and meta description. Do the same for each competitor. Identify the key positioning claims each site makes (e.g. "affordable", "enterprise-grade", "fastest", "easiest", "24/7 support", "no-code"). Find one clear differentiation opportunity: something no competitor claims that the user could own, OR something the user claims but doesn't back up on the page. Generate 2–4 findings.`,
    },
    {
      slug: 'swot',
      label: 'SWOT Analysis',
      order: 9,
      prompt: `Synthesise all findings (including the pre-computed social and ad gap findings listed in the "Already computed" section) into a SWOT. Output exactly 4 items with these exact slugs: "swot-strength", "swot-weakness", "swot-opportunity", "swot-threat".
- swot-strength (verified: true, weight 2): Where the user is at parity or ahead of competitors.
- swot-weakness (verified: false, weight 3): Where competitors consistently lead.
- swot-opportunity (verified: false, weight 2): A high-impact gap that is quick to fix.
- swot-threat (verified: false, weight 3): A competitor advantage that could capture market share.
End the action field for swot-weakness and swot-opportunity with a brief 30/60/90 day outline in plain, non-technical language.`,
    },
  ],
}
