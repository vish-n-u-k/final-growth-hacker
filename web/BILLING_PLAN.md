# Billing & Plans: Build Plan

Status: **planned, not started.** Nothing in the app checks payment today. Every
user can use every module and tool; the only locks are the progress locks
("reach 80% on the previous module"). Keep this file updated as work lands.

## Decisions (made by the founder; don't re-litigate)

1. **Payment provider: Stripe.** This replaces the earlier Razorpay plan.
2. **Two tiers for now: Free and Paid.**
   - **Free:** the first three modules, Foundation, Website Audit and SEO Health Audit.
   - **Paid:** everything else.
   - **Not hardcoded.** Which modules are free is configuration, so it can change
     without a code change.
3. **Billing is off unless switched on by an env toggle.** With the toggle off,
   the app behaves exactly as it does today: everything is open, there are no
   Stripe calls, and no pricing or upgrade UI appears. With it on, Free/Paid
   applies. Ship the code dark and turn it on when ready.

The four-tier pricing on growjin.com (Free / Baseline $19 / Starter $39 /
Growth $99) is **not** what's being built now. The data model below leaves room
to add tiers later.

## Configuration (env)

| Variable | Example | Purpose |
|---|---|---|
| `BILLING_ENABLED` | `true` / unset | Master switch. Anything other than `true` means billing is off and everything is open. Server-side only; pages receive it as a prop. |
| `BILLING_FREE_MODULES` | `foundation,website,seo` | Module types free users get. Default: these three. |
| `STRIPE_SECRET_KEY` | `sk_test_…` | Server API key (test, then live). |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | Verifies Stripe webhook calls. |
| `STRIPE_PRICE_ID` | `price_…` | The Paid plan's recurring price. Add a second id if there's a yearly price. |
| `NEXT_PUBLIC_APP_URL` | `https://app.growjin.com` | Success/cancel return URLs for Checkout. |

## What "Paid" covers: open question

Read literally, "everything else is paid" includes the Work tools too: Today,
Outreach inbox, Social Studio, Lead Finder, Reminders, Analytics and the daily
email. **Confirm before building.** The alternative is gating only modules 4+
and leaving the tools open.

## Build steps

### 1. One plan module: `lib/billing/plan.ts`
- `billingEnabled()`: reads the toggle.
- `freeModuleTypes()`: parses `BILLING_FREE_MODULES`, with a default.
- `isPaid(brand)`: true when the subscription status is active or trialing (or
  inside a grace window, if one is chosen).
- `canUseModule(brand, type)` and `canUseTool(brand, tool)`: always true when
  billing is off.
- Everything else (API routes, pages, the sidebar) asks this module, never
  re-implements the rule.

### 2. Database: one SQL file, run in Supabase like `drizzle/module_runs.sql`
- Add to `brands`:
  - `stripe_customer_id text`
  - `stripe_subscription_id text`
  - `subscription_status text` (Stripe's own values: active, trialing,
    past_due, canceled, …)
  - `current_period_end timestamptz`
- Add to `lib/db/schema.ts` too. **Deploy order matters:** run the SQL before the
  code ships, or reading `brands` fails. (This is the same reason
  `module_runs` was a separate table. Here the columns are worth it, and the
  toggle doesn't protect against a missing column.)

### 3. Stripe routes
- `POST /api/billing/checkout`: creates (or reuses) the Stripe customer for the
  brand, then creates a Checkout Session in subscription mode with
  `STRIPE_PRICE_ID` and redirects to Stripe's hosted page. Pass `brand.id` in
  the metadata.
- `POST /api/billing/portal`: opens Stripe's hosted Customer Portal (cancel,
  change card, invoices). No custom billing screens are needed.
- `POST /api/billing/webhook`: verifies the signature with
  `STRIPE_WEBHOOK_SECRET` on the raw body, then handles:
  - `checkout.session.completed`: links the customer/subscription to the brand;
  - `customer.subscription.created` / `.updated` / `.deleted`: syncs
    `subscription_status` and `current_period_end`;
  - `invoice.payment_failed`: status becomes past_due; the user sees a banner.

  The webhook is the source of truth, not the browser redirect after checkout.
  The route must be excluded from the auth middleware, like `/api/cron/*` is.

### 4. Enforcement (server-side, not just hidden buttons)
- **Analyse:** both `app/api/modules/analyze/route.ts` and
  `lib/mcp/tools/analyze_module.ts` refuse paid modules for free brands (HTTP
  402 with an upgrade hint).
- **Locks:** `lib/modules/lock-state.ts` and the dashboard's `isModuleLocked`
  gain a second lock type, "paid", shown differently from the progress lock.
  Example: phase cards and pills show "Pro" instead of a padlock, and the
  module card shows "Unlock with Pro" and an Upgrade button.
- **Work tools (if gated):** each `app/(shell)/*` page checks on the server and
  renders an upgrade screen instead of the tool. The sidebar marks them "Pro".
- **Daily email cron:** skips free brands if the email is a paid feature.
- **Toggle off:** every check above returns "allowed".

### 5. UI (only when the toggle is on)
- `/pricing` inside the app: Free vs Paid, the current plan, and an Upgrade
  button that goes to Checkout.
- Settings gets a "Plan & billing" tab: current plan and status, renewal date,
  and a "Manage billing" button (opens the Stripe portal).
- Sidebar footer: a plan badge, plus a "Payment failed — update card" banner
  when past_due.

### 6. Rollout
1. Ship with `BILLING_ENABLED` unset: no behaviour change.
2. Stripe test mode on dev: set the test keys and price, create the webhook
   endpoint in the Stripe dashboard, and set `BILLING_ENABLED=true` on dev
   only. Test Free → Checkout → webhook → unlocked; cancel → access until
   period end; failed card → past_due.
3. Production: live keys, live webhook, decide existing users (below), then
   turn the toggle on.

## Open questions
1. Are the Work tools (Today, Outreach, Social, Lead Finder, Reminders,
   Analytics, daily email) paid as well, or only modules 4+?
2. The Paid price, and monthly only or monthly + yearly? Free trial?
3. Existing brands when the toggle flips on: straight to Free, a grace period,
   or free forever?
4. Is the Stripe account able to take international card subscriptions in USD?
   Confirm in the dashboard before building on it.

## Later (not now)
- The site's four tiers (Baseline/Starter/Growth): a `plan` column plus
  per-tier module lists in `lib/billing/plan.ts`.
- Re-analysis limits, Projected MRR, GEO Snapshot, findings history, Backlinks.
  All are advertised on growjin.com but not built.
- The stage reorder to match the site's 13 stages (decided earlier, not done).
