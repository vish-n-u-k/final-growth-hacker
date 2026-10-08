-- Tracking tables: email suppressions, activity events, brand history, ad launches
-- Run in the Supabase SQL editor. Safe to re-run.

-- Gmail follow-up reply tracking (columns in lib/db/schema.ts `reminders`, used by lib/gmail/reply-check.ts)
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS followup_status text;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS followup_note text;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS followup_checked_at timestamptz;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS followup_last_seen_at timestamptz;

CREATE TABLE IF NOT EXISTS email_suppressions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  email text NOT NULL,
  reason text NOT NULL,
  note text,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT email_suppressions_unique UNIQUE (brand_id, email)
);

CREATE TABLE IF NOT EXISTS activity_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  type text NOT NULL,
  detail jsonb,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_events_brand_created_idx ON activity_events (brand_id, created_at);

CREATE TABLE IF NOT EXISTS brand_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  date text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT brand_history_unique UNIQUE (brand_id, date)
);

CREATE TABLE IF NOT EXISTS ad_launches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  module_id uuid,
  platform text NOT NULL DEFAULT 'meta',
  campaign_id text NOT NULL,
  ad_set_id text,
  ad_id text,
  name text NOT NULL,
  objective text,
  daily_budget real,
  currency text,
  brief jsonb,
  status text NOT NULL DEFAULT 'PAUSED',
  activated_at timestamptz,
  metrics jsonb,
  launched_at timestamptz DEFAULT now(),
  checked_at timestamptz,
  CONSTRAINT ad_launches_unique UNIQUE (platform, campaign_id)
);
