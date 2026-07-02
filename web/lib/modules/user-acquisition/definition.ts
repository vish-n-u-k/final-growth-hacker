import type { ModuleDefinition } from '../types'

export const USER_ACQUISITION_MODULE: ModuleDefinition = {
  type: 'user-acquisition',
  name: 'User Acquisition',
  description: 'Phase-matched tactics to get your next batch of users — specific to where you are right now.',
  order: 0,
  unlockThreshold: 0, // always unlocked
  dynamic: true,
  requirements: [
    {
      key: 'user_count',
      label: 'Current user count (optional override)',
      type: 'text',
      placeholder: 'e.g. 0, 47, 312 — auto-pulled from PostHog if connected',
      required: false,
    },
  ],
  systemPrompt: `You are a startup growth advisor specialising in early-stage user acquisition. Your job is to give founders specific, phase-matched tactics to get their next batch of users.

The most important rule: every recommendation must match the founder's current growth phase. Advice appropriate for 500 users is actively harmful to focus on at 5 users — and vice versa.

Phase definitions:
- Phase 1 (0–10 users): Personal, manual outreach only. The goal is to find 10 people who genuinely have the problem and get them using the product. No automation, no ads, no content strategy yet.
- Phase 2 (11–50 users): Expand beyond the immediate network. Online communities, cold outreach, simple waitlists. Ask every existing user for one referral.
- Phase 3 (51–200 users): Find repeatable channels. Early content, systematic cold outreach, partnership conversations. Start measuring what is working.
- Phase 4 (201–500 users): Double down on proven channels. Lightweight paid acquisition tests, a referral programme with incentives, partnerships at scale.
- Phase 5 (500+ users): Build growth infrastructure. Viral loops, affiliates, community-led growth, press strategy.

Output rules:
- Slug format: {category-slug}-{short-descriptor} e.g. immediate-actions-dm-first-10-users
- Weight: 3 = do this week, directly unlocks growth | 2 = important this month | 1 = useful but not urgent
- verified: true only if the brand data explicitly shows this tactic is already active. Default to false.
- fixable: always false — user acquisition is not a code change.
- Every item must be specific to this brand's industry, product, and target audience. No generic startup boilerplate.
- The action field must start with a verb and describe something completable within 14 days.
- The detail field must be one sentence with a specific, concrete observation or gap.
- Plain language: Write label, detail, highlight, and narrative in plain English that any founder can understand — no startup or marketing jargon. Technical specifics belong only in the action field.`,
  categories: [
    {
      slug: 'immediate-actions',
      label: 'Immediate Actions',
      order: 1,
      prompt: `Generate 4–6 high-priority tasks the founder should complete THIS WEEK to get new users. These must be phase-matched to the current phase and user count stated above.

Phase-appropriate focus:
- Phase 1: Identify 10 specific people who have this problem and personally reach out today. Ask 3–5 friends to try the product and give feedback. Post once in one relevant community.
- Phase 2: Post in 3 relevant subreddits, Slack groups, or Discord servers. Reach out to every existing user to ask for one referral. Create a simple waitlist landing page.
- Phase 3: Send 20 personalised cold emails per day to people who match the target persona. Write one piece of content targeting a specific problem keyword. DM 5 newsletter owners for a potential mention.
- Phase 4: Launch a referral programme with a concrete incentive (discount, free month, credit). Test one paid ad channel with a capped budget for 7 days. Activate one partnership conversation.
- Phase 5: A/B test the onboarding flow to improve signup-to-active conversion. Launch an affiliate programme. Pitch to 3 relevant press outlets with a data-backed story.

Generate 4–6 items. Assign weight 3 to the most critical.`,
    },
    {
      slug: 'channel-strategy',
      label: 'Channel Strategy',
      order: 2,
      prompt: `Based on the brand's industry, target audience, and current phase, identify which 2–3 acquisition channels to focus on right now — and which ones to ignore or defer.

Phase-appropriate channels:
- Phase 1: Personal network (LinkedIn connections, WhatsApp groups, friends of friends). In-person events or niche Slack/Discord communities. Direct DMs on social platforms.
- Phase 2: Niche online communities (Reddit, Facebook Groups, Indie Hackers, Product Hunt). Cold email outreach. Twitter/X or LinkedIn posting. A simple referral ask to each existing user.
- Phase 3: Content marketing (SEO-targeted blog posts, YouTube, LinkedIn thought leadership). Cold email sequences. Partnership with a complementary product. Building an email list.
- Phase 4: Paid acquisition (Meta Ads, Google Ads) on the 1–2 best-performing organic channels. Integration partnerships. Podcast sponsorships or guest appearances.
- Phase 5: Viral product loops (invite flows, share prompts at key moments). Affiliate programme. Community building (newsletter, Discord). Enterprise / sales-led growth.

For channels to defer: explicitly name them and explain why they are premature at this stage.
Generate 3–5 items.`,
    },
    {
      slug: 'messaging-positioning',
      label: 'Messaging & Positioning',
      order: 3,
      prompt: `Identify messaging and positioning gaps that are costing this brand users right now. Focus on how the product is being described in outreach, on the website, and in communities — and what needs to change to convert cold contacts into users.

Consider:
- Is the value proposition clear to someone who has never heard of this brand? Can a stranger say back what it does in one sentence?
- Is the pain point or problem being led with, or is it buried under feature descriptions?
- Is the target audience specific enough that the right people immediately recognise it is for them?
- Does the messaging match the current phase? (Phase 1–2: emotional, problem-first. Phase 3–4: outcome/result-focused. Phase 5: category definition.)
- Is there a clear, specific reason to sign up or act now — or does the pitch feel abstract?
- What one-liner pitch would work best for cold outreach at this stage?

Generate 3–5 items with concrete, specific recommendations.`,
    },
    {
      slug: 'referral-word-of-mouth',
      label: 'Referral & Word of Mouth',
      order: 4,
      prompt: `Based on the current user count and phase, give specific tactics for turning existing users into an acquisition channel.

Phase-appropriate focus:
- Phase 1 (0–10 users): Ask each user personally by name, in a 1-on-1 message, to refer one specific person they know who has this problem. No automation — personal ask only.
- Phase 2 (11–50 users): After every positive interaction, ask for a referral. Add a "know someone who needs this?" prompt at the end of onboarding. Create a simple incentive (extended trial, a thank-you gift).
- Phase 3 (51–200 users): Build a lightweight referral flow in the product (a shareable link, a "share with a colleague" prompt after key moments). Collect and publish 2–3 user testimonials.
- Phase 4 (201–500 users): Launch a formal referral programme (double-sided: both referrer and referee get a reward). Add share prompts at moments of delight. Measure referral rate.
- Phase 5 (500+ users): Optimise viral coefficient. Build a case study / community programme. Track NPS and activate promoters systematically.

Generate 3–5 items.`,
    },
    {
      slug: 'next-phase-readiness',
      label: 'Next Phase Readiness',
      order: 5,
      prompt: `Identify 3–4 things this founder must set up NOW to successfully transition into the next growth phase. These are forward-looking items — not what to do today, but what infrastructure, habits, or systems to put in place to make the next phase go smoothly.

Phase-appropriate focus:
- Phase 1 → 2: Build a simple email capture or waitlist. Start tracking where each of the first 10 users came from. Set up a basic analytics tool if not already done.
- Phase 2 → 3: Identify which 1–2 channels are generating the most users and double down before diversifying. Set up a basic CRM or contact tracker. Write down the exact ICP (ideal customer profile) based on who is actually converting.
- Phase 3 → 4: Build an email list of at least 500 subscribers before starting paid ads. Create 1–2 pieces of content that can be repurposed into ad creatives. Measure cost per acquisition on the best organic channel.
- Phase 4 → 5: Set up a referral programme before scaling paid — paid acquisition without referral amplification is expensive. Build a community touchpoint (newsletter or Slack group). Define and track a North Star Metric.
- Phase 5+: Invest in community infrastructure, a partner programme, and PR relationships before the next funding round or major push.

Be specific about what to build, measure, or set up — not just vague strategic direction.
Generate 3–4 items.`,
    },
  ],
}
