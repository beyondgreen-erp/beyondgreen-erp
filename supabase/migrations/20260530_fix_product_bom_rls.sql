-- Fix RLS on product_bom — the previous policy creation may have been silently
-- skipped on Postgres < 15 which does not support CREATE POLICY IF NOT EXISTS

ALTER TABLE product_bom DISABLE ROW LEVEL SECURITY;
