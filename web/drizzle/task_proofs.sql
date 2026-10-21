-- Proof that a task was done: a link (pull request, live page, post) and a short note on what changed
-- (run in Supabase SQL editor). Safe to re-run. Without this table tasks still complete; links just aren't kept.
CREATE TABLE IF NOT EXISTS task_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  item_id uuid REFERENCES module_items(id) ON DELETE CASCADE,     -- a checklist item, or
  signal_id uuid REFERENCES brand_signals(id) ON DELETE CASCADE,  -- an alert / play
  url text,
  note text,
  source text NOT NULL,              -- 'claude' (GrowJin MCP) | 'agent' (auto-fix PR) | 'ai' (AI check) | 'user'
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_proofs_brand_idx ON task_proofs (brand_id, created_at DESC);
