-- Tool suggestions (lib/db/schema.ts `toolSuggestions`): every lead, email draft, topic and link
-- the tools come up with, one row each, like social_suggestions does for Social Studio.
-- Run in the Supabase SQL editor. Safe to re-run.

CREATE TABLE IF NOT EXISTS tool_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  tool text NOT NULL,
  kind text NOT NULL,
  external_id text NOT NULL,
  group_id text,
  title text NOT NULL,
  payload jsonb,
  status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_suggestions_unique UNIQUE (brand_id, tool, external_id)
);
CREATE INDEX IF NOT EXISTS tool_suggestions_brand_tool_idx ON tool_suggestions (brand_id, tool, kind, created_at DESC);
