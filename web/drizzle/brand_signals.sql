-- Signals: change-detected tasks (run in Supabase SQL editor)
CREATE TABLE IF NOT EXISTS brand_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source text NOT NULL,
  signal_key text NOT NULL,
  title text NOT NULL,
  detail text,
  action text,
  route text NOT NULL DEFAULT 'manual',
  priority integer NOT NULL DEFAULT 2,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX IF NOT EXISTS brand_signals_brand_status_idx ON brand_signals (brand_id, status);

CREATE TABLE IF NOT EXISTS signal_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  source text NOT NULL,
  data jsonb NOT NULL,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT signal_snapshots_unique UNIQUE (brand_id, source)
);
