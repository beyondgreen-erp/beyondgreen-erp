-- SRP Production entries per shift
CREATE TABLE IF NOT EXISTS walmart_production (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  production_date date NOT NULL DEFAULT CURRENT_DATE,
  shift text NOT NULL DEFAULT 'Day',
  week_number integer,
  month_number integer,
  year_number integer,
  logged_by text NOT NULL,
  srp_22GVF24 integer DEFAULT 0,
  srp_22GVA24 integer DEFAULT 0,
  srp_22GVK48 integer DEFAULT 0,
  srp_22GVA48 integer DEFAULT 0,
  srp_22GVS48 integer DEFAULT 0,
  srp_22GVS24 integer DEFAULT 0,
  srp_22GVF48 integer DEFAULT 0,
  packs_22GVF24 integer DEFAULT 0,
  packs_22GVA24 integer DEFAULT 0,
  packs_22GVK48 integer DEFAULT 0,
  packs_22GVA48 integer DEFAULT 0,
  packs_22GVS48 integer DEFAULT 0,
  packs_22GVS24 integer DEFAULT 0,
  packs_22GVF48 integer DEFAULT 0,
  total_srps integer DEFAULT 0,
  total_packs integer DEFAULT 0,
  notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE walmart_production DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE walmart_production;

-- BOM (Bill of Materials) for Walmart SKUs
CREATE TABLE IF NOT EXISTS walmart_bom (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  finished_sku text NOT NULL,
  component_sku text NOT NULL,
  component_name text,
  quantity_per_srp numeric NOT NULL DEFAULT 1,
  quantity_per_pack numeric NOT NULL DEFAULT 1,
  component_type text DEFAULT 'packaging',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(finished_sku, component_sku)
);

ALTER TABLE walmart_bom DISABLE ROW LEVEL SECURITY;

-- Walmart inventory snapshot
CREATE TABLE IF NOT EXISTS walmart_inventory (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  product_name text NOT NULL,
  srps_available integer DEFAULT 0,
  packs_available integer DEFAULT 0,
  safety_stock_srps integer DEFAULT 0,
  last_updated timestamptz DEFAULT now(),
  last_order_deduction timestamptz
);

ALTER TABLE walmart_inventory DISABLE ROW LEVEL SECURITY;

-- Walmart order tracking
CREATE TABLE IF NOT EXISTS walmart_orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  po_number text,
  order_date date DEFAULT CURRENT_DATE,
  ship_date date,
  status text DEFAULT 'Open',
  sku text NOT NULL,
  product_name text,
  srps_ordered integer DEFAULT 0,
  packs_ordered integer DEFAULT 0,
  srps_shipped integer DEFAULT 0,
  packs_shipped integer DEFAULT 0,
  notes text,
  sales_order_id uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE walmart_orders DISABLE ROW LEVEL SECURITY;
ALTER PUBLICATION supabase_realtime ADD TABLE walmart_orders, walmart_inventory, walmart_bom;

-- Seed the 7 Walmart SKUs into walmart_inventory
INSERT INTO walmart_inventory (sku, product_name, srps_available, packs_available, safety_stock_srps)
SELECT
  p.sku,
  p.product_name,
  COALESCE(p.on_hand_qty, 0)::integer,
  (COALESCE(p.on_hand_qty, 0) * 6)::integer,
  CASE p.sku
    WHEN '22GVF24' THEN 500
    WHEN '22GVA24' THEN 300
    WHEN '22GVK48' THEN 200
    WHEN '22GVA48' THEN 200
    WHEN '22GVS48' THEN 300
    WHEN '22GVS24' THEN 500
    WHEN '22GVF48' THEN 200
    ELSE 100
  END
FROM products p
WHERE p.sku IN ('22GVF24','22GVA24','22GVK48','22GVA48','22GVS48','22GVS24','22GVF48')
ON CONFLICT (sku) DO UPDATE SET product_name = EXCLUDED.product_name;

-- Seed default BOM entries
INSERT INTO walmart_bom (finished_sku, component_sku, component_name, quantity_per_srp, quantity_per_pack, component_type)
VALUES
('22GVF24','22GVF24-P','Printed Box 24ct Fork',1,0.1667,'packaging'),
('22GVF24','22GVF','Fork Individual Piece',24,4,'raw_material'),
('22GVA24','22GVA24-P','Printed Box 24ct Assorted',1,0.1667,'packaging'),
('22GVA24','22GVF','Fork Individual Piece',8,1.333,'raw_material'),
('22GVA24','22GVS','Spoon Individual Piece',8,1.333,'raw_material'),
('22GVA24','22GVK','Knife Individual Piece',8,1.333,'raw_material'),
('22GVK48','22GVK48-P','Printed Box 48ct Knife',1,0.1667,'packaging'),
('22GVK48','22GVK','Knife Individual Piece',48,8,'raw_material'),
('22GVA48','22GVA48-P','Printed Box 48ct Assorted',1,0.1667,'packaging'),
('22GVA48','22GVF','Fork Individual Piece',16,2.667,'raw_material'),
('22GVA48','22GVS','Spoon Individual Piece',16,2.667,'raw_material'),
('22GVA48','22GVK','Knife Individual Piece',16,2.667,'raw_material'),
('22GVS48','22GVS48-P','Printed Box 48ct Spoon',1,0.1667,'packaging'),
('22GVS48','22GVS','Spoon Individual Piece',48,8,'raw_material'),
('22GVS24','22GVS24-P','Printed Box 24ct Spoon',1,0.1667,'packaging'),
('22GVS24','22GVS','Spoon Individual Piece',24,4,'raw_material'),
('22GVF48','22GVF48-P','Printed Box 48ct Fork',1,0.1667,'packaging'),
('22GVF48','22GVF','Fork Individual Piece',48,8,'raw_material')
ON CONFLICT (finished_sku, component_sku) DO NOTHING;

-- Auto-calculate period and packs on insert/update
CREATE OR REPLACE FUNCTION set_production_period()
RETURNS TRIGGER AS $$
BEGIN
  NEW.week_number := EXTRACT(WEEK FROM NEW.production_date);
  NEW.month_number := EXTRACT(MONTH FROM NEW.production_date);
  NEW.year_number := EXTRACT(YEAR FROM NEW.production_date);
  NEW.packs_22GVF24 := NEW.srp_22GVF24 * 6;
  NEW.packs_22GVA24 := NEW.srp_22GVA24 * 6;
  NEW.packs_22GVK48 := NEW.srp_22GVK48 * 6;
  NEW.packs_22GVA48 := NEW.srp_22GVA48 * 6;
  NEW.packs_22GVS48 := NEW.srp_22GVS48 * 6;
  NEW.packs_22GVS24 := NEW.srp_22GVS24 * 6;
  NEW.packs_22GVF48 := NEW.srp_22GVF48 * 6;
  NEW.total_srps := NEW.srp_22GVF24 + NEW.srp_22GVA24 + NEW.srp_22GVK48 + NEW.srp_22GVA48 + NEW.srp_22GVS48 + NEW.srp_22GVS24 + NEW.srp_22GVF48;
  NEW.total_packs := NEW.total_srps * 6;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS production_period_trigger ON walmart_production;
CREATE TRIGGER production_period_trigger
  BEFORE INSERT OR UPDATE ON walmart_production
  FOR EACH ROW EXECUTE FUNCTION set_production_period();

-- Update walmart_inventory when production logged
CREATE OR REPLACE FUNCTION update_walmart_inventory_on_production()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE walmart_inventory SET srps_available = srps_available + NEW.srp_22GVF24, packs_available = packs_available + NEW.packs_22GVF24, last_updated = now() WHERE sku = '22GVF24';
  UPDATE walmart_inventory SET srps_available = srps_available + NEW.srp_22GVA24, packs_available = packs_available + NEW.packs_22GVA24, last_updated = now() WHERE sku = '22GVA24';
  UPDATE walmart_inventory SET srps_available = srps_available + NEW.srp_22GVK48, packs_available = packs_available + NEW.packs_22GVK48, last_updated = now() WHERE sku = '22GVK48';
  UPDATE walmart_inventory SET srps_available = srps_available + NEW.srp_22GVA48, packs_available = packs_available + NEW.packs_22GVA48, last_updated = now() WHERE sku = '22GVA48';
  UPDATE walmart_inventory SET srps_available = srps_available + NEW.srp_22GVS48, packs_available = packs_available + NEW.packs_22GVS48, last_updated = now() WHERE sku = '22GVS48';
  UPDATE walmart_inventory SET srps_available = srps_available + NEW.srp_22GVS24, packs_available = packs_available + NEW.packs_22GVS24, last_updated = now() WHERE sku = '22GVS24';
  UPDATE walmart_inventory SET srps_available = srps_available + NEW.srp_22GVF48, packs_available = packs_available + NEW.packs_22GVF48, last_updated = now() WHERE sku = '22GVF48';

  UPDATE products SET on_hand_qty = on_hand_qty + NEW.srp_22GVF24, updated_at = now() WHERE sku = '22GVF24' AND NEW.srp_22GVF24 > 0;
  UPDATE products SET on_hand_qty = on_hand_qty + NEW.srp_22GVA24, updated_at = now() WHERE sku = '22GVA24' AND NEW.srp_22GVA24 > 0;
  UPDATE products SET on_hand_qty = on_hand_qty + NEW.srp_22GVK48, updated_at = now() WHERE sku = '22GVK48' AND NEW.srp_22GVK48 > 0;
  UPDATE products SET on_hand_qty = on_hand_qty + NEW.srp_22GVA48, updated_at = now() WHERE sku = '22GVA48' AND NEW.srp_22GVA48 > 0;
  UPDATE products SET on_hand_qty = on_hand_qty + NEW.srp_22GVS48, updated_at = now() WHERE sku = '22GVS48' AND NEW.srp_22GVS48 > 0;
  UPDATE products SET on_hand_qty = on_hand_qty + NEW.srp_22GVS24, updated_at = now() WHERE sku = '22GVS24' AND NEW.srp_22GVS24 > 0;
  UPDATE products SET on_hand_qty = on_hand_qty + NEW.srp_22GVF48, updated_at = now() WHERE sku = '22GVF48' AND NEW.srp_22GVF48 > 0;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS walmart_inventory_production_trigger ON walmart_production;
CREATE TRIGGER walmart_inventory_production_trigger
  AFTER INSERT ON walmart_production
  FOR EACH ROW EXECUTE FUNCTION update_walmart_inventory_on_production();

-- Helper functions for inventory deduction
CREATE OR REPLACE FUNCTION decrement_product_qty(p_sku text, p_amount numeric)
RETURNS void AS $$
BEGIN
  UPDATE products SET on_hand_qty = GREATEST(0, on_hand_qty - p_amount), updated_at = now() WHERE sku = p_sku;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_walmart_srps(p_sku text, p_amount integer)
RETURNS void AS $$
BEGIN
  UPDATE walmart_inventory
  SET srps_available = GREATEST(0, srps_available - p_amount),
      packs_available = GREATEST(0, packs_available - (p_amount * 6)),
      last_updated = now()
  WHERE sku = p_sku;
END;
$$ LANGUAGE plpgsql;
