import type { ModuleDefinition } from '../types'

export const SOCIAL_MEDIA_MODULE: ModuleDefinition = {
  type: 'social-media',
  name: 'Social Media Audit',
  tagline: 'audit and improve your social presence',
  description: 'Turns followers into subscribers.',
  order: 6,
  unlockThreshold: 80,
  dynamic: true,
  requirements: [
    {
      key: 'industry',
      label: 'Industry / niche',
      type: 'text',
      placeholder: 'e.g. SaaS, E-commerce, Healthcare, Fashion',
      required: false,
    },
    {
      key: 'target_audience',
      label: 'Target audience',
      type: 'text',
      placeholder: 'e.g. Small business owners, Enterprise CTOs, Gen Z consumers',
      required: false,
    },
    {
      key: 'instagram_url',
      label: 'Instagram profile URL',
      type: 'url',
      placeholder: 'https://instagram.com/yourbrand',
      required: false,
    },
    {
      key: 'twitter_url',
      label: 'X (Twitter) profile URL',
      type: 'url',
      placeholder: 'https://x.com/yourbrand',
      required: false,
    },
    {
      key: 'linkedin_url',
      label: 'LinkedIn company URL',
      type: 'url',
      placeholder: 'https://linkedin.com/company/yourbrand',
      required: false,
    },
    {
      key: 'youtube_url',
      label: 'YouTube channel URL',
      type: 'url',
      placeholder: 'https://youtube.com/@yourbrand',
      required: false,
    },
    {
      key: 'facebook_url',
      label: 'Facebook page URL',
      type: 'url',
      placeholder: 'https://facebook.com/yourbrand',
      required: false,
    },
    {
      key: 'tiktok_url',
      label: 'TikTok profile URL',
      type: 'url',
      placeholder: 'https://tiktok.com/@yourbrand',
      required: false,
    },
  ],
  systemPrompt: `You are a senior social media strategist embedded in a growth audit tool. Your tone is direct, specific, and consultant-like.

You receive data in three tiers based on what information is available:
- Tier 1 (Website Detection): social links automatically found on the brand's homepage — no user input required
- Tier 2 (Profile Analysis): data from user-provided profile URLs — handle names extracted, some public page titles fetched
- Tier 3 (Metrics): API-connected platform data with full metrics (followers, engagement, posting frequency, bio)

Rules:
1. Only report what you can verify from the provided data. Never fabricate metrics or findings.
2. Every finding must cite specific platform names, handles, or numbers. No generic advice.
3. For Tier 2 data (URL-provided, no API): only assess what is knowable — handle name, URL format, brand name consistency. Never guess follower counts or engagement rates.
4. Slug format: {category-slug}-{short-descriptor} e.g. website-detection-no-instagram-link
5. Weight: 3 = directly costs followers, reach, or leads | 2 = measurably hurts performance | 1 = nice-to-have improvement
6. verified: true = this check passes | verified: false = gap exists, action needed
7. fixable: true ONLY for website code changes (adding social meta tags, adding social links to site header/footer). false for everything else.
8. Plain language: Write label, detail, highlight, and narrative in plain English that a non-technical business owner can understand — no jargon or acronyms. Save technical specifics for the action field only.`,
  categories: [
    {
      slug: 'website-detection',
      label: 'Website Social Presence',
      order: 1,
      prompt: `Analyse what was automatically detected on the brand's homepage. This section requires no user input.

Using the "Homepage Social Links Detected" data:
- Which platforms are linked from the homepage?
- Are social links in prominent positions (header/footer) or absent entirely?
- Is the platform mix appropriate for the stated industry and audience?
- Which critical platforms are missing from the homepage (not linked at all)?
- Social meta tags: is og:see_also or Schema.org sameAs present? (infer from overall SEO quality if not explicitly stated)

Pass condition: links to ≥3 relevant platforms visible on homepage.
Fail condition: no social links on homepage, or missing the single most important platform for the industry.

Weight 3: zero social links found on homepage.
Weight 2: missing 1–2 key platform links from homepage.
Weight 1: social meta tags absent, or minor platform gap for a secondary channel.

Generate 3–5 findings. Include at least one passing finding if the brand has good homepage social presence.`,
    },
    {
      slug: 'profile-analysis',
      label: 'Profile & Brand Consistency',
      order: 2,
      prompt: `Assess social profiles for handle consistency and brand quality. Use handles from ALL tiers — Tier 2 (profile URLs provided), Tier 3 (API-connected), and Tier 1 (homepage-detected links). Never guess metrics.

Handle sources to use:
- Tier 3 "API-Connected Platforms": use the Handle field returned by the API
- Tier 2 "User-Provided Profile URLs": use the handle extracted from the URL
- Tier 1 "Homepage Social Links Detected": platform is present but handle unknown
- Also use the "Cross-Platform Handle Consistency" pre-computed summary above

Checks to run across all available handles:
- Is the handle/username consistent across platforms? Same brand name, no extra numbers or underscores?
- Do handles match the brand name exactly or closely?
- For Tier 2 platforms where a public page title was fetched: does the page name match the brand?
- Is the handle format professional? (random numbers like brand123 are a red flag)
- Which key platforms have no presence at all (not in any tier)?
- Are all critical platforms for this industry covered across all tiers combined?

IMPORTANT: Only generate the "no-urls" fallback finding if the brand has ZERO handles available across ALL tiers (no Tier 2 URLs, no Tier 3 API connections, and no homepage links detected):
  slug: "profile-analysis-no-urls"
  label: "No profile URLs added yet"
  weight: 1, verified: false
  detail: "No social handles are available from any source — handle consistency and profile auditing cannot run."
  narrative: "Adding your social profile URLs unlocks brand name consistency checks, handle quality audit, and full platform coverage analysis across Instagram, LinkedIn, YouTube, Twitter, Facebook, and TikTok."
  action: "Click 'Set up module' above and paste each platform profile URL. No tokens or logins required — just the public URLs."
  fixable: false

Otherwise generate 3–5 findings using whatever handle data is available across all tiers.`,
    },
    {
      slug: 'metrics-analysis',
      label: 'Performance Metrics',
      order: 3,
      prompt: `Analyse social media performance using API-connected platform data with real metrics.

For each platform in "API-Connected Platforms" with real data:
- Follower count in context (strong/weak for the industry and brand stage)
- Engagement rate vs benchmarks: Instagram ≥3% good, 1–3% average, <1% poor | Facebook ≥1% good | LinkedIn ≥2% good | TikTok ≥5% good
- Posting consistency: last post <14 days = active | 15–30 days = at risk | 30+ days = inactive
- Bio quality: is it specific and benefit-driven? Website URL present? CTA present?
- Follower/following ratio: heavy following-to-followers suggests aggressive follow-back tactics

IMPORTANT: If fewer than 2 platforms have real API metrics (followerCount not null), generate exactly one finding:
  slug: "metrics-analysis-no-api"
  label: "API tokens not connected — metrics unavailable"
  weight: 2, verified: false
  detail: "No platform API tokens are connected. Real metrics (followers, engagement rate, posting frequency, bio text) are unavailable."
  narrative: "Without API tokens, this section cannot assess growth trajectory, content performance, or engagement health — the most actionable metrics for social media improvement. Profile URLs alone (Tier 2) confirm you exist on a platform but cannot reveal how well you're performing."
  action: "Go to Settings → Integrations and connect Instagram, Facebook, or LinkedIn to unlock full metrics analysis. Instagram and Facebook provide the most complete data."
  fixable: false

Otherwise generate 3–6 findings citing specific numbers for every claim.`,
    },
    {
      slug: 'content-strategy',
      label: 'Content Strategy',
      order: 4,
      prompt: `Generate a platform-specific content strategy for this brand based on their industry, target audience, and social presence data already provided above.

For each platform where the brand has ANY presence (Tier 1, 2, or 3 — skip "none" platforms entirely):
- What content formats perform best for this industry on this platform? (e.g. Reels, carousels, text threads, long-form video, stories)
- What content topics/themes would resonate with the stated target audience?
- What posting frequency is recommended for this platform and brand type?
- If Tier 3 API data is available: is the brand under- or over-posting vs the benchmark?
- What one specific content idea would work well for this brand right now?

Platform format benchmarks:
- Instagram: Reels outperform static 3:1 | Carousels drive saves | Stories for daily engagement
- LinkedIn: Text posts (thought leadership) + carousels for how-to content | No more than 1x/day
- YouTube: Long-form (8–15 min) > Shorts for subscriber growth in most niches
- TikTok: Raw/authentic > polished | Trending audio boosts reach | Hook in first 2 seconds
- Facebook: Video + events for community | Links penalised in reach
- Twitter/X: Threads for engagement | Plain text > links | Reply to trending topics

Recommended frequencies:
- Instagram: 4–5x/week feed + daily stories
- LinkedIn: 3–5x/week
- Facebook: 1x/day
- Twitter/X: 2–3x/day
- YouTube: 1–2x/week
- TikTok: 1–3x/day

Weight:
- 3 = brand is absent from the single highest-ROI platform for their industry
- 2 = wrong content format for the platform, or posting too infrequently to build audience
- 1 = frequency or format optimisation that would improve reach

Generate 4–6 findings. Every finding must cite the specific platform and the specific format or topic. No generic advice — tie every recommendation to the brand's stated industry and audience.`,
    },
    {
      slug: 'growth-playbook',
      label: 'Growth Playbook',
      order: 5,
      prompt: `Assess the brand's social media maturity and generate a prioritised growth playbook based on their industry, audience, and current presence data.

First, determine the brand's stage using available signals:
- NEW (0–500 followers on most platforms, few or no posts, profiles recently created or mostly absent)
- EARLY (500–5k followers, posting but inconsistently, limited engagement)
- GROWING (5k–50k followers, active posting, some engagement patterns)
- ESTABLISHED (50k+ followers, consistent posting, measurable engagement)

If API data is unavailable, infer stage from homepage presence, profile completeness, and bio quality.

Then generate a prioritised playbook with these angles:

1. HIGHEST PRIORITY content type for this brand's industry and stage — what they should be posting above everything else, and exactly why it moves the needle (leads, trust, reach, or SEO)
2. SECOND PRIORITY content type — complements the first, different format or goal
3. PLATFORM TO WIN FIRST — based on industry and audience, which single platform should they dominate before spreading to others, and why that platform over the alternatives
4. WHAT TO AVOID — the most common mistake brands at this stage make on social (spreading too thin, over-polishing, selling too early, etc.)
5. QUICK WIN — one specific piece of content they could create this week that would immediately demonstrate authority or reach for their industry

For each finding explain the BENEFIT in plain English — not just what to do, but what outcome it drives (more leads, more trust, more reach, algorithm boost, etc.).

Stage-specific guidance:
- NEW brands: focus on presence first (complete profiles, consistent handle, one platform done well) before multi-platform expansion
- EARLY brands: focus on one content pillar and post consistently — 60% educational, 30% social proof, 10% promotional
- GROWING brands: introduce video, test formats, double down on what's working
- ESTABLISHED brands: focus on community, collaborations, and paid amplification of organic winners

Weight:
- 3 = the single highest-impact action that would move growth meaningfully within 30 days
- 2 = important but secondary — meaningful impact within 90 days
- 1 = optimisation — incremental improvement

Generate exactly 5 findings in priority order (most impactful first). Every finding must name the specific content type, platform, and expected outcome. Tie everything to the brand's actual industry and target audience — no generic advice.`,
    },
    {
      slug: 'community-finder',
      label: 'Community Finder',
      order: 6,
      prompt: '',
      comingSoon: true,
      comingSoonNote: 'Discover Facebook Groups, LinkedIn communities, and Reddit subreddits where your target audience is active. Requires Facebook Groups API access currently in restricted review — coming soon.',
    },
  ],
}
