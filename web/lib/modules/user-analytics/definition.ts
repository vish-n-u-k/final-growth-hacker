import type { ModuleDefinition } from '../types'

export const USER_ANALYTICS_MODULE: ModuleDefinition = {
  type: 'user-analytics',
  name: 'User Analytics',
  description: 'Connect PostHog to see who is using your product, where they drop off, and what to fix first.',
  order: 12,
  unlockThreshold: 0,
  dynamic: true,
  requirements: [],
  systemPrompt: `You are a senior product analytics consultant embedded in a growth audit tool. You receive real usage data from PostHog and translate it into specific, prioritised growth actions.

Rules:
- Only report what you can verify from the provided data. Never fabricate metrics.
- Every finding must cite specific numbers from the data. No generic advice.
- Weight 3 = critical blocker to growth or tracking | 2 = measurably hurts retention or conversion | 1 = optimisation opportunity
- verified: true = metric looks healthy | verified: false = gap or problem detected
- fixable: false always — analytics findings require product decisions, not automated code patches
- Slug pattern: {category-slug}-{short-descriptor} e.g. traffic-low-mau, engagement-poor-dau-mau-ratio
- If PostHog is not connected, generate exactly one finding per category directing the user to connect it.`,
  categories: [
    {
      slug: 'traffic',
      label: 'Traffic & Acquisition',
      order: 1,
      prompt: `Analyse traffic and user acquisition using the provided PostHog data.

Key benchmarks:
- MAU: context-dependent, but direction matters — is it growing (weekly user trend), flat, or declining?
- New users last 30 days as % of MAU: >20% = growing | 10–20% = steady | <10% = stagnant
- Sessions per MAU: healthy is 2–4 per month (shows repeat visits)
- Pageviews last 30 days: absolute volume gives baseline for conversion rate calculations

If PostHog is NOT connected (connected: false):
Generate one finding:
  slug: "traffic-posthog-not-connected", label: "PostHog not connected — traffic data unavailable"
  weight: 3, verified: false
  detail: "PostHog integration is not set up — traffic metrics (MAU, new users, pageviews) cannot be pulled."
  narrative: "Without a PostHog connection, this module cannot show you how many people visit your product, whether traffic is growing, or where acquisition is coming from. You are making growth decisions without data."
  action: "Go to Settings → Integrations → PostHog, paste your Personal API Key and Project ID, then re-run this analysis."
  fixable: false

Otherwise generate 2–4 findings citing specific numbers.`,
    },
    {
      slug: 'engagement',
      label: 'User Engagement',
      order: 2,
      prompt: `Analyse user engagement depth using PostHog session and event data.

Key benchmarks:
- DAU/MAU ratio: ≥20% = healthy | 10–20% = average | <10% = poor retention
- Top events: the core product action (e.g. "created_project", "sent_message") should appear in the top 5 events
- Event diversity: if top events are only $pageview and $autocapture with no custom events, tracking is too shallow to be useful
- Session count vs MAU: low session/MAU ratio means users are not coming back

If PostHog is NOT connected (connected: false):
Generate one finding:
  slug: "engagement-posthog-not-connected", label: "PostHog not connected — engagement data unavailable"
  weight: 3, verified: false
  detail: "No PostHog connection — DAU/MAU ratio, event depth, and session quality cannot be assessed."
  narrative: "Engagement data is the earliest signal of retention problems. Without it you cannot tell whether users are returning, what they do inside the product, or whether they reach the key activation moment."
  action: "Connect PostHog in Settings → Integrations to unlock DAU/MAU ratio, top events, and session depth analysis."
  fixable: false

Otherwise generate 2–4 findings citing specific numbers.`,
    },
    {
      slug: 'conversion',
      label: 'Conversion & Key Events',
      order: 3,
      prompt: `Analyse conversion signals from the PostHog event list.

Key signals:
- Are named conversion events present? Look for: signup, signed_up, purchase, subscribed, checkout, upgrade, trial_started, onboarding_complete
- Absence of any conversion event = critical tracking gap — you cannot measure your funnel
- Event naming quality: clear names like "user_signed_up" > vague names like "click" or "button_click"
- Volume ratio: conversion events / pageviews gives rough conversion health (very low = funnel problem or tracking gap)
- If only $pageview and $autocapture exist — no meaningful funnel can be built

If PostHog is NOT connected (connected: false):
Generate one finding:
  slug: "conversion-posthog-not-connected", label: "PostHog not connected — conversion tracking unavailable"
  weight: 3, verified: false
  detail: "PostHog not connected — conversion events (signup, purchase, upgrade) cannot be verified."
  narrative: "Without event tracking you have no visibility into your funnel. You cannot see where users drop off between signup and first value, or between trial and paid. Every growth experiment you run is blind."
  action: "Connect PostHog and make sure you are firing custom events for your key conversion milestones (signup, activation, payment). Then re-run this analysis."
  fixable: false

Otherwise generate 2–4 findings citing specific numbers.`,
    },
    {
      slug: 'growth',
      label: 'Growth Health',
      order: 4,
      prompt: `Give an overall growth health assessment combining all PostHog metrics.

Key signals:
- Is the tracking setup complete? Custom events present and well-named?
- Growth rate direction: weekly user trend — last 4 weeks vs previous 4 weeks
- Analytics maturity: are there enough distinct event types to run a proper funnel analysis?
- The single highest-impact action this brand should take right now for growth

If PostHog is NOT connected (connected: false):
Generate one finding:
  slug: "growth-posthog-not-connected", label: "PostHog not connected — growth health cannot be assessed"
  weight: 3, verified: false
  detail: "PostHog not connected — overall growth health, trend direction, and tracking maturity cannot be evaluated."
  narrative: "A complete growth picture requires traffic trends, engagement depth, and conversion data working together. None of these are available without a PostHog connection."
  action: "Connect PostHog in Settings → Integrations. It is free up to 1 million events per month. Setup takes under 10 minutes."
  fixable: false

Otherwise generate 2–3 findings. Be direct about overall health and give one clear priority action.`,
    },
  ],
}
