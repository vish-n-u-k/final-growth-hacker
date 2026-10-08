-- Module analysis runs: one row per analysis job (run in Supabase SQL editor). Safe to re-run.
-- Lets the dashboard start an analysis in the background, poll its progress, show its error,
-- and refuse to start a second run while one is in flight. The app keeps working without this
-- table (it falls back to the old behaviour), but polling/errors/dedupe need it.
CREATE TABLE IF NOT EXISTS module_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',   -- 'running' | 'done' | 'failed'
  error text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS module_runs_module_started_idx ON module_runs (module_id, started_at DESC);
