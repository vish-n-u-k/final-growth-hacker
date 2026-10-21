-- AI usage + cost log: one row per AI call (run in Supabase SQL editor). Safe to re-run.
-- Feeds the admin "AI Costs" tab. If this table is missing, calls still work; they just aren't logged.
CREATE TABLE IF NOT EXISTS ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid REFERENCES brands(id) ON DELETE CASCADE,
  module_type text NOT NULL,          -- module type, or the feature for calls outside a module run
  website_url text,
  model text NOT NULL,
  provider text NOT NULL,             -- 'sdk' | 'cli' | 'gemini'
  input_tokens integer,
  output_tokens integer,
  cost_usd text,                      -- decimal string, e.g. '0.001234'
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_logs_created_idx ON ai_usage_logs (created_at DESC);
