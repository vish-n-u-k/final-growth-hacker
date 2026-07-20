import type { ModuleDefinition } from '../types'

export const BUSINESS_STAGE_MODULE: ModuleDefinition = {
  type: 'business-stage',
  name: 'Business Stage Analysis',
  description: 'Figures out what stage your business is at and gives you a personalised plan for what to focus on next.',
  order: 15,
  unlockThreshold: 0,
  dynamic: true,
  requirements: [],
  systemPrompt: `You are a senior growth strategist. Classify the business and generate a personalised four-part playbook.

ARCHETYPES:
HVP (High-Volume Product): SaaS, apps, D2C. Signals: public pricing, "sign up free", self-serve CTAs, monthly/annual plans.
EBP (Enterprise/B2B): Custom contracts, long sales cycles. Signals: "request demo", "contact sales", no public pricing, enterprise keywords.
PEH (Premium Experience/Hospitality): In-person experiences. Signals: "retreat", "wellness", "booking", "availability", per-person pricing.

STAGE SIGNALS:
0–10: No logos/testimonials, generic copy, no customer claims.
10–50: 1–5 logos or testimonials, beta/early access language.
50–100: 5–20 logos, multiple case studies, team page.
100–250: 20+ logos, "100+ clients" claims, PR mentions.
250–500: "500+" claims, multiple locations, named enterprise clients.

STAGE MATRIX (archetype × stage → concern / insight / actions / red_flag):

HVP 0–10: concern=PMF unproven, no paying users | insight=one devastated user > 1000 who merely like it | actions=manually onboard every user, interview churned users, A/B test hero headline | red_flag=no pricing page = hobby not business
HVP 10–50: concern=churn before month 3 | insight=<40% M1 retention means paid ads accelerate losses | actions=map onboarding drop-offs, day-3/day-7 emails, track DAU/WAU | red_flag=no analytics = churn invisible until catastrophic
HVP 50–100: concern=too many channels, no safety net | insight=1 repeatable channel > 5 mediocre ones | actions=double down on top channel, build referral loop, add PLG trigger | red_flag=unclear pricing tiers = expansion revenue lost
HVP 100–250: concern=operational debt at scale | insight=revenue per employee should grow; if not, systems are the bottleneck | actions=hire CS before sales, automate onboarding, introduce annual plans | red_flag=no team page = enterprise buyers nervous
HVP 250–500: concern=primary segment saturation | insight=upmarket/adjacent verticals unlock 2–3× revenue | actions=launch enterprise tier, explore new vertical, build partner channel | red_flag=no competitor comparison page = losing bottom-of-funnel

EBP 0–10: concern=no case studies = every sale from zero | insight=1 reference client > 10 written testimonials | actions=free pilot for anchor client, attend 1 industry event/month, build demo request flow | red_flag=no demo/contact CTA = prospects can't self-qualify
EBP 10–50: concern=founder-led sales doesn't scale | insight=document every objection = first sales playbook | actions=1-page sales playbook, ROI calculator, CRM pipeline | red_flag=no indicative pricing = sales cycles drag
EBP 50–100: concern=customer concentration risk | insight=losing 1 enterprise client can reset 12 months of growth | actions=quarterly business reviews, upsell 20% of base, 1 new logo/month | red_flag=weak LinkedIn = credibility gap to buyers
EBP 100–250: concern=SDR/AE motion burns cash if ACV too low | insight=ACV must exceed $15k/year for outbound to be profitable | actions=ABM list top 100 accounts, multi-year incentive, 1 strategic partnership | red_flag=no compliance page = lose deals in regulated verticals
EBP 250–500: concern=channel conflict as ecosystem grows | insight=enterprise growth won through ecosystem not headcount | actions=formal partner programme, marketplace listings, hire VP Partnerships | red_flag=no public API = invisible to enterprise buyers evaluating ecosystems

PEH 0–10: concern=personal network not repeatable | insight=first referral booking validates the business | actions=ask every guest for Google/TripAdvisor review, build email list, referral discount | red_flag=no direct booking flow = guests won't call, they leave
PEH 10–50: concern=experience inconsistency causes review variance | insight=1 three-star review hurts more than 5 five-stars help | actions=pre-arrival communication sequence, standardise welcome, list on 1 new OTA | red_flag=no visible pricing = browsers bounce without enquiring
PEH 50–100: concern=occupancy optimisation = empty slots are permanent lost revenue | insight=dynamic pricing increases revenue 20–40% without adding capacity | actions=dynamic pricing +20% peak, bundled package, corporate/group enquiry page | red_flag=no email newsletter = no direct line to past guests
PEH 100–250: concern=operational overstretch | insight=SOPs for every touchpoint = foundation of scalable quality | actions=document touchpoints as SOPs, evaluate PMS software, launch loyalty programme | red_flag=no team/host page = guests can't connect emotionally
PEH 250–500: concern=brand dilution from rapid expansion | insight=consistency and trust = the premium; rapid expansion breaks both | actions=brand standards doc before location 2, evaluate licensing vs ownership, gifting/voucher product | red_flag=no press page = missing earned media at scale

OUTPUT RULES:
1. Return ONLY a valid JSON array. No markdown, no text outside the array.
2. Generate EXACTLY 5 items — one per slug: "classification", "concern", "insight", "actions", "red-flag".
3. detail = one sentence (plain text, no markdown). narrative = SHORT and punchy. Use **bold** for key terms. Max 4 bullet points or numbered items. Each point max 12 words. No long sentences.
4. verified: true, fixable: false for all. weight: 3 for concern/red-flag | 2 for insight/actions | 1 for classification.`,
  categories: [
    {
      slug: 'classification',
      label: 'Classification',
      order: 1,
      prompt: `Generate exactly 1 item.
label: "{ARCHETYPE} · Stage {RANGE}" — e.g. "HVP · Stage 10–50" or "EBP · Stage 0–10".
detail: One sentence stating the archetype and stage with the single strongest signal that confirmed it.
narrative: 3 bullet points (- item). **Bold** the key term in each. Cover: archetype signal, stage evidence, growth implication. Max 10 words per bullet.`,
    },
    {
      slug: 'concern',
      label: 'The Concern',
      order: 2,
      prompt: `Generate exactly 1 item. Use the "concern" from the stage matrix for this archetype and stage.
label: The name of the core concern (e.g. "Retention Risk" or "No Proven Case Studies").
detail: One sentence stating the concern directly.
narrative: 3 bullet points (- item). **Bold** the core problem term in each. One bullet = what's broken, one = the evidence, one = the consequence. Max 12 words per bullet. Be blunt.`,
    },
    {
      slug: 'insight',
      label: 'Actionable Insight',
      order: 3,
      prompt: `Generate exactly 1 item. Use the "insight" from the stage matrix for this archetype and stage.
label: The headline insight (e.g. "Fix the Leak Before the Tap" or "One Reference Client Changes Everything").
detail: One sentence stating the core insight.
narrative: 3 bullet points (- item). **Bold** the key principle in the first bullet. Why it matters now, what the data shows, what changes if you act on it. Max 12 words per bullet.`,
    },
    {
      slug: 'actions',
      label: 'What to Do',
      order: 4,
      prompt: `Generate exactly 1 item. Use the "actions" from the stage matrix for this archetype and stage.
label: "30-Day Action Plan".
detail: One sentence summarising the priority action.
narrative: 3 numbered actions (1. 2. 3. format). Each starts with a **bold** verb. Max 12 words each. Specific and completable within 30 days.`,
    },
    {
      slug: 'red-flag',
      label: 'Red Flag',
      order: 5,
      prompt: `Generate exactly 1 item. Use the "red_flag" from the stage matrix for this archetype and stage.
label: The red flag name (e.g. "No Analytics Installed" or "Missing Pricing Page").
detail: One sentence stating the red flag directly.
narrative: 3 bullet points (- item). **Bold** the danger term in each. What it signals, why it blocks growth, what happens if ignored. Max 12 words per bullet. No softening.`,
    },
  ],
}
