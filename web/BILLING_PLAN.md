# Billing (Stripe): Free / Pro

Status: **built, switched off by default.** With `BILLING_ENABLED` unset the app
behaves exactly as before: everything is open and there are no Stripe calls.
Verified locally with billing off, billing on as a free user, billing on with an
email override, and signed test webhooks (see "What was tested").

## The rules

- **Free:** Foundation, Website Audit and SEO Health Audit, with full fixes.
- **Pro (monthly or yearly):** everything else.
  - Every other Growth Path module.
  - The tools: Today and the daily email, Outreach, Social Studio, Meta Ads,
    Lead Finder, Reminders, Analytics, Engagement Hub and Tools.
- Which modules are free is configuration (`BILLING_FREE_MODULES`), not code.
- There are no real users yet, so there's no grandfathering. When billing is
  switched on, everyone without a subscription is on Free.

The four tiers on growjin.com ($19/$39/$99) are not built. This is one Pro plan
billed monthly or yearly. Update the site, or extend `lib/billing/plan.ts`
later.

## Environment variables

| Variable | Example | Purpose |
|---|---|---|
| `BILLING_ENABLED` | `true` | **Master switch.** Anything else means billing is off and everything is open. |
| `BILLING_FREE_MODULES` | `foundation,website,seo` | Module types on the free plan (this is the default). |
| `BILLING_PRO_EMAILS` | `you@growjin.com,friend@x.com` | Always Pro, no payment (founders, testers). |
| `STRIPE_SECRET_KEY` | `sk_test_…` / `sk_live_…` | Stripe API key. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` | Signing secret of the webhook endpoint. |
| `STRIPE_PRICE_MONTHLY` | `price_…` or `prod_…` | Pro monthly price. A product id works too: its default price is used. |
| `STRIPE_PRICE_YEARLY` | `price_…` or `prod_…` | Pro yearly price. A product id works too: its default price is used. |
| `STRIPE_TRIAL_DAYS` | `7` | Optional free trial on new subscriptions. Unset means no trial. |
| `NEXT_PUBLIC_APP_URL` | `https://app.growjin.com` | Where Stripe sends people back. Defaults to the request's origin. |

Prices shown in the app come from Stripe, so changing a price in Stripe needs
no code change.

## Turning it on (do test mode first)

1. **Supabase:** run `web/drizzle/billing.sql` in the SQL editor. It creates
   `brand_subscriptions` and is safe to re-run. If you forget, the app still
   works, but nobody can become Pro.
2. **Stripe → Products:** create "GrowJin Pro" with two recurring prices
   (monthly and yearly). Copy their IDs into `STRIPE_PRICE_MONTHLY` and
   `STRIPE_PRICE_YEARLY`.
3. **Stripe → Developers → API keys:** set `STRIPE_SECRET_KEY`.
4. **Stripe → Developers → Webhooks:** add an endpoint at
   `https://<your-app-domain>/api/billing/webhook` with these events:
   - `checkout.session.completed`
   - `customer.subscription.created`, `customer.subscription.updated` and
     `customer.subscription.deleted`
   - `customer.subscription.paused` and `customer.subscription.resumed`

   Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
5. **Stripe → Settings → Billing → Customer portal:** turn it on. Allow
   cancelling, switching between the two Pro prices, updating the payment
   method and viewing invoices.
6. Set `BILLING_ENABLED=true` (and your own email in `BILLING_PRO_EMAILS`),
   then redeploy.
7. Test with Stripe's test card `4242 4242 4242 4242`:
   - Free → `/pricing` → Upgrade → pay → back on `/pricing` → Pro within a
     few seconds;
   - Manage billing → cancel → access until the period end;
   - use a failing test card → "payment failed" banner.
8. Switch to live keys, a live price and a live webhook secret when ready.

## How it works (code map)

- `lib/billing/plan.ts`: the single source of truth.
  - `billingEnabled()` and `freeModuleTypes()`;
  - `getAccess(brandId, email)` returns Free/Pro, status, interval and renewal
    date;
  - `canUseModule()` and `planLockedTypes()`.

  Pro means a Stripe status of `active`, `trialing` or `past_due` (Stripe is
  retrying the card), or an email listed in `BILLING_PRO_EMAILS`.
- `lib/billing/stripe.ts`:
  - the Stripe client and display prices (cached for 10 minutes);
  - `linkCustomer()` and `syncSubscription()`. The latter ignores out-of-order
    (older) events. The renewal date is read from the subscription's items,
    which is where it lives since API version 2025-03-31.
- `lib/billing/guard.ts`: `requirePro()` returns 402 for free accounts. It's
  used by 40 handlers in the tool APIs: Gmail (except connect, disconnect and
  callback), Frekto generate/suggest/series/schedule/meta-ad, blog generation,
  Lead Finder scrape, Meta Ads launch, outreach, reminders, today and social
  analytics.
- API routes:
  - `app/api/billing/checkout`: creates the Stripe customer and a Checkout
    session;
  - `app/api/billing/portal`: opens the Customer Portal;
  - `app/api/billing/webhook`: signature-verified, and exempt from the auth
    middleware.
- Module analysis: `app/api/modules/analyze` and the MCP `analyze_module` tool
  refuse Pro modules for free brands (402). Admins are exempt in the web route.
- `components/ProGate.tsx` and a `layout.tsx` in each Pro tool folder show an
  upgrade screen instead of the tool.
- Growth Path shows Pro badges on the phase cards and pills, a "part of GrowJin
  Pro" bar, and an upgrade panel on Pro module cards. Clicking Analyse on a Pro
  module goes to `/pricing`.
- The sidebar puts Pro badges on the tools, adds an "Upgrade to Pro" / "Pro ·
  Your plan" link in the footer, and shows a "payment failed" banner.
- `/pricing`: Free vs Pro, a monthly/yearly toggle (showing the yearly saving),
  Upgrade or Manage billing, and the checkout success/cancel messages.
- The daily email cron skips free brands.

## What was tested (locally, against a real Postgres)

- **Billing off:** no badges, gates or 402s, and checkout returns "Billing is
  not enabled". Behaviour is unchanged.
- **Billing on, free:**
  - Today and Analytics (including sub-pages) show the upgrade screen;
  - Pro badges appear in the sidebar, phases and pills;
  - the GEO card shows the upgrade panel and has no Analyse button;
  - analysing GEO, Reminders suggest and Today signals all return 402.
- **Billing on with `BILLING_PRO_EMAILS`:** everything opens, and the sidebar
  shows "Pro · Your plan".
- **Signed webhooks:**
  - a bad signature is rejected (400);
  - checkout links the customer;
  - active → Pro;
  - past_due → still Pro, with the banner;
  - an older event arriving late is ignored;
  - active again → the banner goes;
  - deleted → Free (402);
  - an unknown customer is ignored.
- **Phones (390/320px, real fonts):** Pricing, the upgrade screen and Growth
  Path, with no cut-off text.
- **Not tested here (the sandbox can't reach Stripe):** the real Checkout and
  Portal redirects, and loading real prices. Do step 7 above in test mode.

## Known gaps / later

- `BILLING_PRO_EMAILS` isn't checked by the MCP `analyze_module` tool (it only
  has the brand) or the daily-email cron (that uses the brand's notification
  email).
- Settings has no billing tab. `/pricing` doubles as the billing page, linked
  from the sidebar footer.
- Results of Pro modules analysed before billing was turned on stay readable
  (faded) behind the upgrade panel. They can't be re-analysed.
- The site's four tiers, re-analysis limits, Projected MRR, GEO Snapshot,
  findings history and Backlinks are not built.
