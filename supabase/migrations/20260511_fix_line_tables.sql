-- ─── FIX quotation_lines (add missing columns) ───────────────────────────────
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS line_number       integer  NOT NULL DEFAULT 1;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS product_id        uuid     REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS sku               text;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS description       text;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS quantity          numeric  DEFAULT 1;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS unit_of_measure   text;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS unit_price        numeric  DEFAULT 0;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS discount_pct      numeric  DEFAULT 0;
ALTER TABLE quotation_lines ADD COLUMN IF NOT EXISTS quotation_id      uuid     REFERENCES quotations(id) ON DELETE CASCADE;
ALTER TABLE quotation_lines DISABLE ROW LEVEL SECURITY;

-- ─── FIX sales_order_lines (add missing columns) ─────────────────────────────
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS line_number       integer  NOT NULL DEFAULT 1;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS sales_order_id    uuid     REFERENCES sales_orders(id) ON DELETE CASCADE;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS product_id        uuid     REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS sku               text;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS description       text;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS quantity          numeric  DEFAULT 1;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS quantity_shipped  numeric  DEFAULT 0;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS unit_of_measure   text;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS unit_price        numeric  DEFAULT 0;
ALTER TABLE sales_order_lines ADD COLUMN IF NOT EXISTS discount_pct      numeric  DEFAULT 0;
ALTER TABLE sales_order_lines DISABLE ROW LEVEL SECURITY;

-- ─── FIX products: ensure is_active defaults true so SKU search works ─────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true;
UPDATE products SET is_active = true WHERE is_active IS NULL;
