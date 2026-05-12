ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS srp_22GVF24 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS srp_22GVA24 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS srp_22GVK48 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS srp_22GVA48 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS srp_22GVS48 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS srp_22GVS24 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS srp_22GVF48 integer DEFAULT 0;

ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS packs_22GVF24 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS packs_22GVA24 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS packs_22GVK48 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS packs_22GVA48 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS packs_22GVS48 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS packs_22GVS24 integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS packs_22GVF48 integer DEFAULT 0;

ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS total_srps integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS total_packs integer DEFAULT 0;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS week_number integer;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS month_number integer;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS year_number integer;
ALTER TABLE walmart_production ADD COLUMN IF NOT EXISTS notes text;
