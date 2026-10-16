-- Social Studio: saved suggestions, preview-before-schedule drafts, queue actions
-- (run in Supabase SQL editor)

ALTER TABLE frekto_scheduled_posts
  ADD COLUMN IF NOT EXISTS frekto_scheduled_id text,
  ADD COLUMN IF NOT EXISTS series_id text,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS slide_urls jsonb,
  ADD COLUMN IF NOT EXISTS caption text,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS suggestion_id uuid,
  ADD COLUMN IF NOT EXISTS error text;
CREATE INDEX IF NOT EXISTS frekto_posts_brand_status_idx ON frekto_scheduled_posts (brand_id, status);

CREATE TABLE IF NOT EXISTS social_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL,
  platform text NOT NULL,
  topic text NOT NULL,
  post_type text,
  suggested_at timestamptz,
  reason text,
  payload jsonb,
  status text NOT NULL DEFAULT 'suggested',
  post_id uuid,
  source text NOT NULL DEFAULT 'studio',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_suggestions_brand_status_idx ON social_suggestions (brand_id, status);
