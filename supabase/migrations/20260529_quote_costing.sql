-- =====================================================
-- Quote Costing Tool — beyondGREEN ERP
-- Landed cost calculator + customer quote generator
-- =====================================================

CREATE TABLE IF NOT EXISTS quote_costing (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quotation_id uuid REFERENCES quotations(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  customer_name text,
  quote_number text,
  quote_date date DEFAULT CURRENT_DATE,
  valid_until date,
  prepared_by text,
  status text DEFAULT 'Draft',
  total_exw_cost numeric DEFAULT 0,
  total_landed_cost numeric DEFAULT 0,
  total_selling_price numeric DEFAULT 0,
  total_profit numeric DEFAULT 0,
  avg_margin_pct numeric DEFAULT 0,
  default_markup_pct numeric DEFAULT 45,
  default_duty_pct numeric DEFAULT 35,
  freight_method text DEFAULT 'OCEAN',
  include_freight_disclaimer boolean DEFAULT true,
  notes text,
  internal_notes text,
  created_by text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS quote_costing_lines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_costing_id uuid NOT NULL REFERENCES quote_costing(id) ON DELETE CASCADE,
  line_number integer DEFAULT 1,
  item_number text,
  associated_po text,
  description text NOT NULL,
  product_type text,
  specs text,
  country_of_origin text DEFAULT 'CHINA',
  hs_code text,
  freight_method text DEFAULT 'OCEAN',
  uom text DEFAULT 'Case',
  moq_qty integer DEFAULT 0,
  order_qty integer DEFAULT 0,
  packing_per_case integer DEFAULT 0,
  exw_cost_per_case numeric DEFAULT 0,
  freight_cost_per_case numeric DEFAULT 0,
  customs_cost_per_case numeric DEFAULT 0,
  duty_pct numeric DEFAULT 35,
  china_tariff_25_pct numeric DEFAULT 0,
  duty_10_pct numeric DEFAULT 0,
  mpf numeric DEFAULT 21.40,
  hmf numeric DEFAULT 1.28,
  total_duties_per_case numeric DEFAULT 0,
  packaging_cost_per_case numeric DEFAULT 0,
  other_cost_1_label text,
  other_cost_1_amount numeric DEFAULT 0,
  other_cost_2_label text,
  other_cost_2_amount numeric DEFAULT 0,
  other_cost_3_label text,
  other_cost_3_amount numeric DEFAULT 0,
  broker_inv_amount numeric DEFAULT 0,
  total_cost_per_case numeric DEFAULT 0,
  cost_per_piece numeric DEFAULT 0,
  markup_pct numeric DEFAULT 45,
  selling_price_per_case numeric DEFAULT 0,
  selling_price_per_piece numeric DEFAULT 0,
  profit_per_case numeric DEFAULT 0,
  profit_margin_pct numeric DEFAULT 0,
  total_profit numeric DEFAULT 0,
  total_income numeric DEFAULT 0,
  has_retail_packaging boolean DEFAULT false,
  retail_packaging_desc text,
  ddp_price_per_case numeric DEFAULT 0,
  product_id uuid REFERENCES products(id) ON DELETE SET NULL,
  sku text,
  inventory_status text DEFAULT 'Quoted-Not Launched',
  needs_freight_disclaimer boolean DEFAULT true,
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE quote_costing DISABLE ROW LEVEL SECURITY;
ALTER TABLE quote_costing_lines DISABLE ROW LEVEL SECURITY;

-- Safely add to realtime publication
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE quote_costing;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE quote_costing_lines;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Auto-calculate line totals
CREATE OR REPLACE FUNCTION calculate_quote_line_totals()
RETURNS TRIGGER AS $$
BEGIN
  NEW.china_tariff_25_pct := CASE NEW.country_of_origin
    WHEN 'CHINA' THEN NEW.exw_cost_per_case * 0.25
    ELSE 0
  END;

  NEW.duty_10_pct := NEW.exw_cost_per_case * 0.10;

  NEW.total_duties_per_case :=
    NEW.china_tariff_25_pct +
    NEW.duty_10_pct +
    COALESCE(NEW.mpf, 0) +
    COALESCE(NEW.hmf, 0);

  NEW.total_cost_per_case :=
    COALESCE(NEW.exw_cost_per_case, 0) +
    COALESCE(NEW.freight_cost_per_case, 0) +
    COALESCE(NEW.total_duties_per_case, 0) +
    COALESCE(NEW.packaging_cost_per_case, 0) +
    COALESCE(NEW.other_cost_1_amount, 0) +
    COALESCE(NEW.other_cost_2_amount, 0) +
    COALESCE(NEW.other_cost_3_amount, 0) +
    COALESCE(NEW.broker_inv_amount, 0);

  IF NEW.packing_per_case > 0 THEN
    NEW.cost_per_piece := NEW.total_cost_per_case / NEW.packing_per_case;
  END IF;

  NEW.selling_price_per_case := NEW.total_cost_per_case * (1 + NEW.markup_pct / 100);

  IF NEW.packing_per_case > 0 THEN
    NEW.selling_price_per_piece := NEW.selling_price_per_case / NEW.packing_per_case;
  END IF;

  NEW.profit_per_case := NEW.selling_price_per_case - NEW.total_cost_per_case;

  IF NEW.selling_price_per_case > 0 THEN
    NEW.profit_margin_pct := (NEW.profit_per_case / NEW.selling_price_per_case) * 100;
  END IF;

  IF NEW.order_qty > 0 THEN
    NEW.total_profit := NEW.profit_per_case * NEW.order_qty;
    NEW.total_income := NEW.selling_price_per_case * NEW.order_qty;
  END IF;

  NEW.ddp_price_per_case := NEW.total_cost_per_case;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quote_line_calc_trigger ON quote_costing_lines;
CREATE TRIGGER quote_line_calc_trigger
  BEFORE INSERT OR UPDATE ON quote_costing_lines
  FOR EACH ROW EXECUTE FUNCTION calculate_quote_line_totals();

-- Add inventory_status to products
ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory_status text DEFAULT 'Active';
