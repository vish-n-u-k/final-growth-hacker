-- Lifecycle emails (welcome, Pro, cancellation): one row per email sent, used to never send twice.
-- Run in the Supabase SQL editor. Safe to re-run. Until it's run, lifecycle emails are skipped (logged), nothing breaks.
CREATE TABLE IF NOT EXISTS lifecycle_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL,              -- 'welcome' | 'pro_trial_started' | 'pro_welcome' | 'cancel_scheduled' | 'cancel_undone' | 'access_ending' | 'subscription_ended' | 'winback_1' | 'winback_2' | 'unsubscribed'
  key text NOT NULL,               -- dedupe key within a kind (Stripe subscription id, period end, ...)
  to_email text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lifecycle_emails_unique UNIQUE (brand_id, kind, key)
);
