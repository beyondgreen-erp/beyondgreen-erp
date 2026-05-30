-- 3-shift model + upsert support for walmart_production

-- Drop old constraint if it exists
ALTER TABLE walmart_production
  DROP CONSTRAINT IF EXISTS walmart_production_date_shift_key;

-- Add the unique constraint so upsert works
ALTER TABLE walmart_production
  ADD CONSTRAINT walmart_production_date_shift_key
    UNIQUE (production_date, shift);
