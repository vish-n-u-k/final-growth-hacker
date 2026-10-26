-- Reminders table (lib/db/schema.ts `reminders`) — previously only created via db:push.
-- Run in the Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  category text NOT NULL,
  interval_days integer NOT NULL DEFAULT 30,
  last_done_at timestamptz,
  next_due_at timestamptz NOT NULL,
  snoozed_until timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  is_preset boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Gmail follow-up reply tracking (also in tracking.sql)
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS followup_status text;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS followup_note text;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS followup_checked_at timestamptz;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS followup_last_seen_at timestamptz;
-- What a reply is about (Inbox tab sorting)
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS followup_intent text;

-- Link to the listing / profile a recurring check is about
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS url text;

CREATE INDEX IF NOT EXISTS reminders_brand_due_idx ON reminders (brand_id, next_due_at);
