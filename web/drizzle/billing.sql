-- Billing (Stripe): one row per brand with a Stripe customer/subscription. Run in Supabase SQL editor. Safe to re-run.
-- Kept in its own table (not columns on brands) so the app keeps working if this hasn't been run yet:
-- billing code reads it defensively, and nothing else selects from it.
CREATE TABLE IF NOT EXISTS brand_subscriptions (
  brand_id uuid PRIMARY KEY REFERENCES brands(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text,
  status text,                     -- Stripe subscription status: active | trialing | past_due | canceled | unpaid | incomplete | ...
  price_id text,
  billing_interval text,           -- 'month' | 'year'
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS brand_subscriptions_customer_idx ON brand_subscriptions (stripe_customer_id);
