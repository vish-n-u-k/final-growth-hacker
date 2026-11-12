-- Work log: growth work done outside GrowJin, saved through the MCP tools
-- log_work / list_work / update_work / delete_work (run in Supabase SQL editor). Safe to re-run.
-- Nothing else in the app reads this table.
CREATE TABLE IF NOT EXISTS work_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  kind text NOT NULL,                 -- blog | community | outreach | listing | social | other
  title text NOT NULL,                -- what was done
  url text,
  done_on text NOT NULL,              -- YYYY-MM-DD
  how text,                           -- how it was done
  status text NOT NULL DEFAULT 'done',-- done | waiting | follow_up
  next_check text,                    -- YYYY-MM-DD, optional
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS work_log_brand_done_idx ON work_log (brand_id, done_on DESC);
