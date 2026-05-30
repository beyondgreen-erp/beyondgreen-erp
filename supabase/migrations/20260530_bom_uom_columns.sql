-- BOM editor: UOM type, qty value, case-level packaging support

ALTER TABLE product_bom
  ADD COLUMN IF NOT EXISTS uom_type text DEFAULT 'percentage',
  ADD COLUMN IF NOT EXISTS qty_value numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_case_level boolean DEFAULT false;

-- Backfill qty_value from percentage for existing rows
UPDATE product_bom SET qty_value = percentage WHERE qty_value = 0 AND percentage > 0;

-- Production cost per unit for finished goods
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS production_cost numeric DEFAULT 0;
