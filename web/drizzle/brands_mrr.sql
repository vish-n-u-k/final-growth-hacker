-- Projected MRR inputs the user enters on Growth Path / Analytics: { price, currency, payingPct }.
-- Read and written with raw SQL (lib/mrr.ts) so the app keeps working before this runs.
ALTER TABLE brands ADD COLUMN IF NOT EXISTS mrr_settings jsonb;
