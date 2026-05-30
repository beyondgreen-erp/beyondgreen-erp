-- Add new product columns and product_bom table

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS product_category text,
  ADD COLUMN IF NOT EXISTS product_location text,
  ADD COLUMN IF NOT EXISTS weight_per_unit_grams numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS upc_gtin text,
  ADD COLUMN IF NOT EXISTS distribution_price numeric,
  ADD COLUMN IF NOT EXISTS wholesale_price numeric,
  ADD COLUMN IF NOT EXISTS msrp numeric,
  ADD COLUMN IF NOT EXISTS imap numeric,
  ADD COLUMN IF NOT EXISTS map_price numeric,
  ADD COLUMN IF NOT EXISTS bom_cost numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS case_cost numeric,
  ADD COLUMN IF NOT EXISTS requires_bom boolean DEFAULT false;

-- BOM table: each row is one component of a finished good
CREATE TABLE IF NOT EXISTS product_bom (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sku text NOT NULL,
  component_sku text NOT NULL,
  percentage numeric NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(sku, component_sku)
);

-- RLS
ALTER TABLE product_bom ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "product_bom_all" ON product_bom FOR ALL USING (true) WITH CHECK (true);
