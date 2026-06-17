import type { ModuleDefinition } from '../types'

export const SOCIAL_MEDIA_MODULE: ModuleDefinition = {
  type: 'social-media',
  name: 'Social Media Audit',
  description: 'Audit your social media presence across all platforms — profile completeness, posting consistency, engagement, audience growth, and strategic opportunities.',
  order: 4,
  unlockThreshold: 0,
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
  ],
  systemPrompt: `You are a senior social media strategist embedded in a growth audit tool. Your tone is direct, specific, and consultant-like.

You receive pre-processed data: social platform metrics fetched via official APIs (follower counts, posting frequency, engagement rates, bio content), social links detected on the website homepage, and brand context.

Rules:
1. Only report what you can verify from the data provided. Never fabricate metrics or findings.
2. Every finding must cite specific numbers, platform names, or exact copy. No generic advice.
3. When a platform's API call failed or is not connected, note that metrics are unavailable but still assess what is observable (e.g. presence/absence, link on website).
4. Slug format: {category-slug}-{short-descriptor} e.g. platform-presence-missing-tiktok
5. Weight: 3 = directly costs followers, reach, or leads | 2 = measurably hurts performance | 1 = nice-to-have improvement
6. verified: true = this check passes or the brand is ahead of best practice | verified: false = gap exists, action needed
7. fixable: true ONLY if the fix is a direct code change to the website — adding social meta tags (og:see_also, Schema.org sameAs), adding social profile links to the website footer or header. fixable: false for everything else (update bio, post more, create account, change content strategy, external platform actions)
8. All action steps must be completable by a non-technical person within a week`,
  categories: [
    {
      slug: 'platform-presence',
      label: 'Platform Presence',
      order: 1,
      prompt: `Assess which social platforms the brand is active on and which critical platforms are missing for their industry and audience.

Using the connected platform data, social links found on the homepage, and the brand's industry/target audience:
- Which platforms are confirmed active (connected with data, or link detected on homepage)?
- Which platforms are absent that are essential for this industry? (e.g. LinkedIn for B2B, Instagram/TikTok for consumer, YouTube for SaaS tutorials)
- Are social profile links visible on the website homepage?
- Is the platform mix appropriate for the stated audience?

Pass condition: active on ≥ 3 platforms appropriate for the industry, all with links on homepage.
Fail condition: missing a dominant platform for the industry, or zero social links on website.

Weight 3: no social presence at all, or missing the single most important platform for the industry.
Weight 2: missing 1–2 high-value platforms, or social links absent from homepage.
Weight 1: missing a secondary platform that would be beneficial.

Generate 3–5 findings. For fixable: social links missing from website homepage/footer qualify as fixable: true.`,
    },
    {
      slug: 'profile-quality',
      label: 'Profile Quality',
      order: 2,
      prompt: `Audit the completeness and quality of each connected social profile.

For each platform with available data, assess:
- Bio/description: Is it specific, benefit-driven, and audience-targeted? Or generic?
- Does the bio include the website URL or a clear CTA?
- Is a profile image/logo set (not default avatar)?
- Are platform-specific profile elements complete? (LinkedIn: company size, industry, specialities; YouTube: channel art, about section; Instagram: category, contact button)
- Is the handle/brand name consistent across platforms?

Pass condition: bio is specific and audience-targeted, website link present, profile image set.
Fail condition: generic bio, no website link, default avatar, or missing key platform fields.

Generate 4–6 findings citing exact bio text where available, or flagging absence of data.`,
    },
    {
      slug: 'content-posting',
      label: 'Content & Posting',
      order: 3,
      prompt: `Evaluate posting consistency and content activity across all platforms.

Using last post dates and posting frequency data:
- Is each platform actively maintained? (last post within 14 days = active; 15–30 days = at risk; 30+ days = inactive)
- What is the posting frequency vs recommended benchmarks?
  - Instagram: 4–7 posts/week
  - Facebook: 3–5 posts/week
  - LinkedIn: 3–5 posts/week
  - TikTok: 5–7 posts/week
  - YouTube: 1–2 videos/week
  - Twitter/X: 5–10 tweets/week
- Is there consistency across platforms or are some neglected?
- Flag any platform where the account exists but has gone silent (0 posts in 30+ days).

Weight 3: core platform completely inactive (30+ days silent).
Weight 2: posting at less than 50% of recommended frequency on a key platform.
Weight 1: minor frequency gap on a secondary platform.

Generate 3–5 findings with specific last post dates and frequency numbers where available.`,
    },
    {
      slug: 'engagement-audience',
      label: 'Engagement & Audience',
      order: 4,
      prompt: `Analyse follower counts, engagement rates, and audience quality across platforms.

Using the metrics provided:
- Assess follower counts in context of the industry and brand stage. Cite exact numbers.
- Engagement rate benchmarks by platform:
  - Instagram: good ≥ 3%, average 1–3%, poor < 1%
  - Facebook: good ≥ 1%, average 0.5–1%, poor < 0.5%
  - LinkedIn: good ≥ 2%, average 0.5–2%, poor < 0.5%
  - YouTube: good view rate ≥ 10% of subscribers, average 3–10%, poor < 3%
  - TikTok: good ≥ 5%, average 2–5%, poor < 2%
- If engagement rate data is unavailable (e.g. Twitter free tier, unconnected platforms), note it.
- Is the follower-to-following ratio healthy? (heavy following with few followers suggests aggressive follow-back tactics)
- Identify the strongest performing platform to double down on.

Generate 3–5 findings. If only follower data is available and engagement can't be computed, note that the integration needs upgrade access and still report follower benchmarks.`,
    },
    {
      slug: 'social-score',
      label: 'Social Score',
      order: 5,
      prompt: `Synthesise all findings from the four previous categories into a holistic Social Media Score from 0 to 10 (lower is better — 0 is perfect).

Weighting:
- Platform Presence: 25%
- Profile Quality: 20%
- Content & Posting: 30%
- Engagement & Audience: 25%

Score mapping:
- 0–3: Strong — consistent presence, good engagement, optimised profiles
- 4–6: Average — active but with clear gaps in consistency or platform coverage
- 7–8: Weak — inconsistent posting, incomplete profiles, or missing key platforms
- 9–10: Absent — minimal or no meaningful social presence

Generate exactly 2 findings:
1. slug: "social-score-overall" — the score, which categories are weakest, verified: true if score ≤ 4 else false, weight based on severity
2. slug: "social-score-action-plan" — a prioritised 30/60/90 day plain-language social media action plan targeting the weakest areas, verified: false, weight 2

Use only what the data showed — do not invent findings from outside the provided data.`,
    },
  ],
}
