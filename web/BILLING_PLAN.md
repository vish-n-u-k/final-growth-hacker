# Billing & Plans: Build Plan

Status: **planned, not started.** The source of truth for pricing is growjin.com
(pricing section, pasted into the session on 2026-10-08). Read this file before
building anything billing-related, and keep it updated as work lands.

## Decisions (made by the founder, don't re-litigate)

1. **Payment provider: Razorpay** (Subscriptions API + Checkout).
2. **The app matches the site's 13 stages and their order.** Modules that aren't
   on the site become extras outside the numbered chain.
3. **Work tools are Growth-only:** Today, Outreach inbox (`/gmail-hub`), Social
   Studio, Lead Finder, Reminders, daily email.
4. **Existing brands get Growth free for a grace period** when plans switch on,
   then pick a plan. Proposed length: 60 days (confirm).

## Tiers (from growjin.com)

| Tier | Price | Includes |
|---|---|---|
| Free | $0 forever | Stage 01 Foundation · Sales playbook · 3 re-analyses/month · full prescriptive fixes |
| Baseline | $19/mo | Free + live user & growth tracking (PostHog) + Projected MRR estimate |
| Starter | $39/mo | Baseline + Stage 03 SEO Health Audit + GEO Snapshot + unlimited re-analyses + findings history & fix tracking |
| Growth | $99/mo | Starter + stages 04–13 (unlocking at 80%) + full GEO + GEO Competitor Gap + Backlinks + User Analytics + priority analysis + exportable reports + Work tools (decision 3) |

"Every tier starts on Free": signup is always Free, and the upgrade happens in the app.

## Stage chain after reorder (decision 2)

| # | Site stage | Module `type` | Current `order` → new |
|---|---|---|---|
| 01 | Foundation | `foundation` | 1 → 1 |
| 02 | Website Audit | `website` | 2 → 2 |
| 03 | SEO Health Audit | `seo` | 3 → 3 |
| 04 | Backlinks & Link Building | `backlinks` | 50 → 4 (**still `comingSoon`**: not built, so the lock chain skips it) |
| 05 | GEO Audit | `geo` | 4 → 5 |
| 06 | Competitor Analysis | `competitor-analysis` | 9 → 6 |
| 07 | Social Media Audit | `social-media` | 6 → 7 |
| 08 | Brand Audit | `brand-audit` | 7 → 8 |
| 09 | Content Audit | `content-audit` | 8 → 9 |
| 10 | Meta Ads Audit | `meta-ads` | 11 → 10 |
| 11 | Outreach Targets | `outreach-targets` | 13 → 11 |
| 12 | GEO Competitor Gap | `geo-competitor-gap` | 5 → 12 |
| 13 | User Analytics | `user-analytics` | 12 → 13 |

Extras, outside the chain (proposed: Growth tier, shown in a separate "More
audits" group, never gating anything):
- `business-stage`: already off the rail; feeds the Growth Stage card.
  The **Sales playbook** on Free is Foundation's `brands.playbook`, not this module.
- `gmail-outreach`: becomes part of the Outreach tool (Growth). The sidebar
  stops using its *module* lock for the Outreach link and uses the plan instead.
- `email-marketing`, `audience-discovery`: extras (Growth).

Knock-on changes:
- Hardcoded `order <= 3` "always unlocked" in `components/AllModulesDashboard.tsx`
  (`isModuleLocked`) and `lib/modules/lock-state.ts` stays correct (1–3 are
  unchanged).
- The `GROWTH_PHASES` ranges in `AllModulesDashboard.tsx` must follow the new
  order: Get set up 1–3 · Get found 4–7 (Backlinks, GEO, Competitor, Social) ·
  Win attention 8–10 (Brand, Content, Meta Ads) · Scale 11–13.
- Existing brands' module unlock state shifts with the reorder. The grace
  period (decision 4) covers this.

## Gaps: sold on the site, not in the app

These need to be built before the tier that sells them goes live, or the copy
pulled from the site until they exist:
- **Projected MRR estimate** (Baseline). The old hardcoded "$9.5K" box was
  removed because it was fake. It needs a real input (price × PostHog paying users).
- **GEO Snapshot** (Starter): a lightweight AI-visibility check before stage 5.
- **Findings history & fix tracking** (Starter): `brand_history` stores daily
  snapshots, but no UI shows them.
- **Backlinks** (Growth): module is `comingSoon`.
- **Re-analysis limit** (Free/Baseline: 3/month): nothing counts re-analyses today.

## Open questions

1. **Which tier is Website Audit (stage 02) in?** The site lists it in no tier,
   but its hero sample and "Run my free audit" CTA show it. Recommendation:
   include it in Free (and say so on the site).
2. Grace period length for existing brands (default 60 days).
3. Should the Free/Baseline re-analysis limit of 3/month count per module or
   per brand? Recommendation: per brand.

## Build steps

### 1. Plan definitions: `lib/billing/plans.ts`
One map from plan → `{ priceUsd, razorpayPlanId (env), modules: Set<type>,
reanalysesPerMonth: number | null, features: { posthogTracking, projectedMrr,
geoSnapshot, history, exports, priority, workTools } }`, plus `planAllows(plan,
feature)` and `planAllowsModule(plan, type)`. Everything else reads from here.

### 2. Database (one SQL file, run in Supabase like `drizzle/tracking.sql`)
- `brands`: `plan text default 'free'`, `plan_status text` (active | past_due |
  cancelled | grace), `plan_renews_at timestamptz`, `grace_until timestamptz`,
  `razorpay_customer_id text`, `razorpay_subscription_id text`.
- `analysis_usage`: `(brand_id, month text 'YYYY-MM', count int)`, unique on (brand_id, month).
- Backfill: existing brands → `plan='growth', plan_status='grace', grace_until=now()+60d`.
- Mirror the columns in `lib/db/schema.ts`.

### 3. Server-side enforcement (not just hidden buttons)
- `app/api/modules/analyze/route.ts` **and** `lib/mcp/tools/analyze_module.ts`
  (they're independent dispatchers): reject modules not in the plan (402 +
  `{ upgradeTo }`), and increment/check `analysis_usage`.
- `lib/modules/lock-state.ts` → return `{ progressLocked, planLocked }`.
- The Work tool pages in `app/(shell)/*`: server-side plan check, rendering an
  upgrade screen instead of the tool.
- The daily email cron skips brands without `workTools`.

### 4. Razorpay
- Env: `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`,
  `RAZORPAY_PLAN_BASELINE`, `RAZORPAY_PLAN_STARTER`, `RAZORPAY_PLAN_GROWTH`.
- `POST /api/billing/subscribe` → creates a Razorpay subscription for the
  chosen plan and returns `subscription_id` to open Razorpay Checkout client-side.
- `POST /api/billing/verify` → verifies the checkout signature
  (HMAC-SHA256 of `payment_id|subscription_id` with the key secret).
- `POST /api/billing/webhook` → verifies `X-Razorpay-Signature` (HMAC-SHA256 of
  the raw body with the webhook secret) and maps `subscription.activated /
  charged / pending / halted / cancelled / completed` → `brands.plan*`. **This
  is the source of truth**, not the client callback.
- `POST /api/billing/cancel` and `GET /api/billing/invoices`. Razorpay has no
  hosted customer portal like Stripe, so cancel and invoices live in our UI.
- Upgrades and downgrades: cancel at cycle end and start a new subscription
  (simplest), or use Razorpay's subscription update API.

### 5. UI
- `/pricing` inside the shell: the 4 tiers exactly as on the site, current
  plan marked, and an upgrade button that opens Razorpay Checkout.
- Settings → **Plan & billing** tab: plan, status, renewal date, re-analyses
  used ("2 of 3 this month"), invoices, cancel.
- Plan locks, visually distinct from progress locks: phase cards and pills,
  the module card ("Part of Growth — upgrade"), the Re-analyse button at
  the limit, and sidebar Work tools.
- Sidebar footer: a plan badge, plus grace countdown ("Growth free until 7 Dec").

### 6. Rollout
Razorpay test mode on a branch from `dev`. Test the full loop: Free → upgrade →
webhook → unlocked; cancel → access until period end; failed payment → past_due.
Then live keys.

## What the founder needs to do in Razorpay
- Enable **Subscriptions** and **International payments** (USD from foreign
  cards). Confirm USD plans are allowed on the account.
- Create 3 plans (monthly: $19 / $39 / $99) and share the plan IDs.
- Share test-mode key ID/secret, and create a webhook to
  `https://<app-domain>/api/billing/webhook` with a secret.
