import type { ModuleDefinition } from '../types'

export const SOCIAL_MEDIA_MODULE: ModuleDefinition = {
  type: 'social-media',
  name: 'Social Media Audit',
  description: 'Audit your social media presence across three tiers — what your website signals, what your profile URLs reveal, and what API metrics show.',
  order: 4,
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
7. fixable: true ONLY for website code changes (adding social meta tags, adding social links to site header/footer). false for everything else.`,
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
      prompt: `Assess social profiles based on URLs the user provided. Focus only on what is knowable from handles and public profile names — never guess metrics.

Using the "User-Provided Profile URLs" data (handles extracted, public page titles where available):
- Is the handle/username consistent across platforms? Same brand name, no extra numbers or underscores?
- Do handles match the brand name exactly or closely?
- Which key platforms have no URL provided and are not on the website either?
- For platforms where a public page title was fetched: does the page name match the brand?
- Is the handle format professional? (random numbers like brand123 are a red flag)
- Are all critical platforms for this industry covered across tiers 1 and 2 combined?

IMPORTANT: If zero profile URLs were provided by the user (all Tier 2 entries show "No URL provided"), generate exactly one finding:
  slug: "profile-analysis-no-urls"
  label: "No profile URLs added yet"
  weight: 1, verified: false
  detail: "Profile URLs have not been added to the module setup — handle consistency and profile auditing cannot run."
  narrative: "Adding your social profile URLs unlocks brand name consistency checks, handle quality audit, and full platform coverage analysis across Instagram, LinkedIn, YouTube, Twitter, Facebook, and TikTok."
  action: "Click 'Set up module' above and paste each platform profile URL. No tokens or logins required — just the public URLs."
  fixable: false

Otherwise generate 3–5 findings.`,
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
  ],
}
