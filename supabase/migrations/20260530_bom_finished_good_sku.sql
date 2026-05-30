-- Add finished_good_sku column to product_bom and production_cost to products

ALTER TABLE product_bom
  ADD COLUMN IF NOT EXISTS finished_good_sku text;

-- Backfill from existing sku column
UPDATE product_bom SET finished_good_sku = sku WHERE finished_good_sku IS NULL AND sku IS NOT NULL;

-- Unique constraint on new column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'product_bom_fgsku_compsku_unique'
  ) THEN
    ALTER TABLE product_bom ADD CONSTRAINT product_bom_fgsku_compsku_unique
      UNIQUE (finished_good_sku, component_sku);
  END IF;
END$$;

-- Add production_cost to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS production_cost numeric DEFAULT 0;
