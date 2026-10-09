-- Progress stage for a running analysis (run in Supabase SQL editor). Safe to re-run.
-- 'fetch' (reading the website) → 'analyse' (checking it and writing fixes) → 'save' (saving the checklist).
-- Without this column the dashboard still works; it shows elapsed time but not the current stage.
ALTER TABLE module_runs ADD COLUMN IF NOT EXISTS stage text;
