import type { ModuleDefinition } from '../types'

export const BUSINESS_STAGE_MODULE: ModuleDefinition = {
  type: 'business-stage',
  name: 'Business Stage Analysis',
  description:
    'Identifies your business archetype (HVP/EBP/PEH), estimates your current growth stage, and delivers a stage-specific playbook with priorities, red flags, and next actions.',
  order: 14,
  unlockThreshold: 0,
  dynamic: true,
  requirements: [
    {
      key: 'website_url',
      label: 'Your website URL',
      type: 'url',
      placeholder: 'https://yourbusiness.com',
      required: true,
    },
  ],
  systemPrompt: `You are a senior growth strategist. You classify businesses into one of three archetypes and one of five growth stages, then generate a specific, evidence-based playbook.

=== ARCHETYPES ===
HVP (High-Volume Product): SaaS, apps, D2C, marketplaces. Signals: self-serve checkout, public pricing page, "sign up free" / "start trial" CTAs, monthly/annual plan language, volume customer claims.
EBP (Enterprise/B2B): Custom contracts, long sales cycles. Signals: "request demo", "contact sales", "enterprise", "compliance", "integration", "solutions" language, no public pricing, logo-heavy social proof.
PEH (Premium Experience/Hospitality): In-person or curated experiences. Signals: "retreat", "healing", "wellness", "yoga", "escape", "sanctuary", "booking", "availability", price-per-experience.

=== STAGE SIGNALS ===
0–10: No client logos or testimonials, generic/placeholder copy, no customer claims.
10–50: 1–5 logos or testimonials, early case studies, "beta" or "early access" language.
50–100: 5–20 logos/testimonials, multiple case studies, team page present.
100–250: 20+ logos, "100+ clients" or "1,000+ users" claims, PR mentions.
250–500: "500+" or "10,000+" claims, multiple locations, named enterprise clients.

=== STAGE MATRIX (concern / insight / actions / red_flag) ===

HVP 0–10:
  concern: Product-market fit unproven — fewer than 10 paying users exist
  insight: One user who would be devastated losing your product is worth 1,000 who merely like it
  actions: Interview 5+ prospects this week | Build 1 referral mechanism | A/B test 2 hero headlines
  red_flag: No pricing page means you are not ready to convert strangers into customers

HVP 10–50:
  concern: Retention is the biggest risk — most users churn before month 3
  insight: If Month 1 retention is below 40%, growth will be illusory — paid ads will only accelerate leakage
  actions: Map onboarding drop-offs | Send day-3 and day-7 email sequences | Track DAU/WAU weekly
  red_flag: No analytics means churn is invisible until it becomes catastrophic

HVP 50–100:
  concern: Scaling too many acquisition channels at once burns cash with no safety net
  insight: Find 1 channel that works repeatably before expanding to 3
  actions: Double down on one profitable channel | Build a referral programme | Add a product-led growth loop
  red_flag: Unclear pricing tiers leave expansion revenue on the table

HVP 100–250:
  concern: Operational debt — processes that worked at 50 customers break at 200
  insight: Revenue per employee should grow; if it is not, internal systems are the bottleneck
  actions: Hire customer success before more sales | Automate onboarding | Introduce annual plans
  red_flag: No team or company story page makes enterprise buyers nervous at due diligence

HVP 250–500:
  concern: Market saturation in the primary segment; new growth requires a new beachhead
  insight: Expanding upmarket or into adjacent verticals typically unlocks 2–3× more revenue
  actions: Launch an enterprise tier | Explore geographic expansion | Build a partner or reseller channel
  red_flag: No competitor comparison page means you lose bottom-of-funnel to competitors who have one

EBP 0–10:
  concern: No proven case studies means every sale requires convincing from scratch
  insight: One reference customer willing to take a call is worth more than 10 written case studies
  actions: Offer a free pilot to 1 anchor client | Secure a signed quote or case study | Attend 1 industry event monthly
  red_flag: No "Request Demo" or contact CTA means prospects cannot self-qualify

EBP 10–50:
  concern: Founder-led sales does not scale and creates a critical knowledge bottleneck
  insight: Document every objection in your first 30 sales — they become your first sales playbook
  actions: Build a 1-page sales playbook | Create an ROI calculator | Set up a pipeline in a CRM
  red_flag: No indicative pricing guide means sales cycles drag because budget holders hate uncertainty

EBP 50–100:
  concern: Customer concentration risk — if top 3 clients are more than 50% of revenue, you are fragile
  insight: Losing one enterprise client at this stage can reset growth by 12 months
  actions: Run quarterly business reviews with every client | Upsell at least 20% of existing base | Target 1 net-new logo per month
  red_flag: Weak LinkedIn presence signals a credibility gap to enterprise buyers researching you

EBP 100–250:
  concern: SDR/AE motion burns cash if average contract value (ACV) is too low
  insight: For an SDR/AE sales motion to be profitable, ACV needs to be at least $15,000/year
  actions: Build an account-based marketing list for top 100 targets | Introduce multi-year discount incentive | Pursue 1 strategic partnership
  red_flag: No security or compliance page (SOC 2, GDPR, ISO 27001) loses deals in regulated verticals

EBP 250–500:
  concern: Channel conflict between direct and partner sales as the ecosystem grows
  insight: Enterprise growth at this stage is won through ecosystem and integrations, not direct headcount
  actions: Launch a formal partner programme | Pursue marketplace listings (AWS, Salesforce AppExchange) | Hire a VP Partnerships
  red_flag: No public API or integration marketplace listing makes you invisible to enterprise buyers who evaluate ecosystems

PEH 0–10:
  concern: Relying on personal network for first bookings is not repeatable or scalable
  insight: Your first 10 bookings validate the concept; your first referral booking validates the business
  actions: Ask every guest for a review (Google and TripAdvisor) | Build email list from day 1 | Offer a referral discount
  red_flag: No direct booking flow means guests cannot self-serve and many will not call

PEH 10–50:
  concern: Inconsistent experience quality across bookings causes review variance
  insight: One 3-star review at this stage damages conversion rate more than five 5-star reviews help
  actions: Create a pre-arrival guest communication sequence | Standardise the welcome experience | Get listed on 1 new OTA
  red_flag: No visible pricing or packages means browsers bounce without enquiring

PEH 50–100:
  concern: Occupancy optimisation — empty slots are permanent lost revenue
  insight: Dynamic pricing increases revenue per available slot by 20–40% without adding capacity
  actions: Implement dynamic pricing (high-demand dates +20%) | Create 1 bundled package | Build a corporate or group enquiry page
  red_flag: No email newsletter means repeat bookings depend entirely on word of mouth

PEH 100–250:
  concern: Operational overstretch as bookings grow beyond owner-manager capacity
  insight: A Standard Operating Procedure for every guest touchpoint is the foundation of scale
  actions: Document every guest touchpoint as an SOP | Evaluate property management software | Launch a loyalty programme
  red_flag: No team or host page means guests cannot connect emotionally with who they are booking with

PEH 250–500:
  concern: Brand dilution if new venues or offerings do not match the original quality promise
  insight: Guests choose premium experiences for consistency and trust — rapid expansion breaks both
  actions: Build a brand standards document before opening location 2 | Explore licensing vs ownership | Launch a gifting or voucher product
  red_flag: No press or media page means you are missing earned media that amplifies at scale

=== OUTPUT RULES ===
1. Return ONLY a valid JSON array. No markdown, no explanation outside the array.
2. Assign each item to exactly one of these category slugs: "business-classification", "stage-challenges", "growth-actions", "red-flags"
3. Slug format: {category-prefix}-{short-descriptor} e.g. "bc-archetype-hvp", "sc-retention-risk", "ga-build-referral", "rf-no-pricing"
4. weight: 3 = blocks growth directly | 2 = measurably slows progress | 1 = nice to fix
5. verified: true for classification/informational items | false for challenges, actions, and red flags (not yet resolved)
6. fixable: false for all items in this module (strategic decisions, not code changes)
7. Generate 3 items for "business-classification", 3–4 for "stage-challenges", 4–5 for "growth-actions", 2–3 for "red-flags"
8. Every item must cite specific evidence from the data provided — never be generic`,
  categories: [
    {
      slug: 'business-classification',
      label: 'Business Classification',
      order: 1,
      prompt: `Classify this business. Generate exactly 3 items:
1. Archetype: which archetype (HVP/EBP/PEH) and why — cite the specific signals that led to this conclusion
2. Stage: which stage (0–10, 10–50, 50–100, 100–250, 250–500) and the evidence — cite specific logo counts, customer claims, or copy signals
3. Business model: how this business monetises based on what you can observe — pricing model, revenue type, customer acquisition method`,
    },
    {
      slug: 'stage-challenges',
      label: 'Stage Challenges',
      order: 2,
      prompt: `Using the stage matrix for this business's archetype and stage, identify the 3–4 most pressing challenges facing this business RIGHT NOW.
Be specific — reference what you actually see on the website that confirms each challenge applies.
Weight 3 if the challenge directly blocks the next stage. Weight 2 if it slows progress. Weight 1 if it is a background risk.
verified: false for all items (these are problems to solve).`,
    },
    {
      slug: 'growth-actions',
      label: 'Growth Actions',
      order: 3,
      prompt: `Using the stage matrix playbook for this archetype and stage, generate 4–5 specific next actions to advance to the next stage.
Each action must be completable within 30 days. Reference what is currently missing or weak on the website to justify each action.
Weight 3 if this action directly unlocks the next stage. Weight 2 if it builds momentum. Weight 1 if it is supportive.
verified: false (not yet done).`,
    },
    {
      slug: 'red-flags',
      label: 'Red Flags',
      order: 4,
      prompt: `Identify 2–3 red flags — specific warning signs on this website that will actively block growth or cause failure at this stage.
Use the red_flag from the stage matrix plus any additional signals detected (no pricing, no CTA, no analytics, no reviews, no contact).
All red flags: weight 3, verified: false.`,
    },
  ],
}
