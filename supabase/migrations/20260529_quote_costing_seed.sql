-- =====================================================
-- Quote Costing Seed Data — Imperial Dade File Import
-- beyondGREEN ERP
-- =====================================================

-- Live Nation quote header
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, email, is_active)
  VALUES ('Live Nation Entertainment', 'Purchasing', 'purchasing@livenation.com', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
),
qh AS (
  INSERT INTO quote_costing (
    quote_number, customer_id, customer_name,
    quote_date, valid_until, prepared_by, status,
    default_markup_pct, default_duty_pct, freight_method
  )
  SELECT
    'QC-2026-1001', cust.id, 'Live Nation Entertainment',
    '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft',
    45, 35, 'OCEAN'
  FROM cust
  RETURNING id
)
INSERT INTO quote_costing_lines (
  quote_costing_id, line_number, description, product_type,
  country_of_origin, freight_method, uom,
  moq_qty, order_qty, packing_per_case,
  exw_cost_per_case, freight_cost_per_case,
  mpf, hmf, markup_pct, needs_freight_disclaimer
)
SELECT
  qh.id,
  ln.line_number, ln.description, ln.product_type,
  'CHINA', 'OCEAN', 'Case',
  ln.moq, ln.order_qty, ln.packing,
  ln.exw, ln.freight,
  21.40, 1.28, 45, true
FROM qh,
(VALUES
  (1,  'Mosh | Liner Wrap | Kraft | 12×12"',          'Liner Wrap',  5000, 17,  5000,  50.60, 20.35),
  (2,  'Mosh | Liner Wrap | Kraft | 16×16"',          'Liner Wrap',  2500, 12,  2500,  68.40, 22.10),
  (3,  'Mosh | Burger Bag | Kraft | #4',               'Burger Bag',  5000, 20,  2000,  42.80, 18.50),
  (4,  'Mosh | Burger Bag | Kraft | #8',               'Burger Bag',  3000, 15,  1500,  55.20, 19.80),
  (5,  'Mosh | Fry Cup | 32oz | White',                'Fry Cup',     2000, 10,  1000,  88.50, 24.30),
  (6,  'Mosh | Fry Cup | 48oz | Kraft',                'Fry Cup',     2000,  8,   800,  96.20, 25.60),
  (7,  'Mosh | Sandwich Wrap | Deli Sheet | 14×14"',   'Deli Sheet',  5000, 25,  5000,  38.40, 16.20),
  (8,  'Mosh | Hot Dog Bag | Kraft | Plain',           'Hot Dog Bag', 5000, 18,  4000,  35.60, 15.90),
  (9,  'Mosh | Tray Liner | 12×8" | Natural',         'Tray Liner',  5000, 22, 10000,  28.30, 14.50),
  (10, 'Mosh | Tray Cover | 9×12" | Kraft',           'Tray Cover',  3000, 12,  3000,  44.10, 17.80),
  (11, 'Mosh | Napkin | 1/4 Fold | 2-Ply',            'Napkin',      5000, 30, 50000,  22.50, 12.30),
  (12, 'Mosh | Tissue | 1-Ply | 12×8.5"',             'Tissue Paper',5000, 20, 20000,  19.80, 11.60),
  (13, 'Mosh | Food Box | 9×5×3" | Kraft',            'Food Box',    2000, 10,   500,  78.90, 23.40),
  (14, 'Mosh | Sleeve | Medium | White 1-Color',       'Sleeve',      3000, 15,  2000,  62.30, 21.20),
  (15, 'Mosh | Liner Wrap | White | 12×12"',           'Liner Wrap',  5000, 17,  5000,  48.20, 19.80),
  (16, 'Mosh | Liner Wrap | Kraft | 18×18"',           'Liner Wrap',  2000,  8,  2000,  82.60, 26.40)
) AS ln(line_number, description, product_type, moq, order_qty, packing, exw, freight);

-- King Taco quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('King Taco Restaurants', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1002', cust.id, 'King Taco Restaurants',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'OCEAN'
FROM cust;

-- Living Balance quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('Living Balance', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1003', cust.id, 'Living Balance',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'OCEAN'
FROM cust;

-- Paris Baguette quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('Paris Baguette', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1004', cust.id, 'Paris Baguette',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'OCEAN'
FROM cust;

-- Erewhon quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('Erewhon Market', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1005', cust.id, 'Erewhon Market',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'OCEAN'
FROM cust;

-- Wolfies Drive Thru quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('Wolfies Drive Thru', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1006', cust.id, 'Wolfies Drive Thru',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'OCEAN'
FROM cust;

-- Little Lenny's quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('Little Lenny''s', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1007', cust.id, 'Little Lenny''s',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'OCEAN'
FROM cust;

-- FLA. Born & Glazed quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('FLA. Born & Glazed', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1008', cust.id, 'FLA. Born & Glazed',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'DOMESTIC'
FROM cust;

-- Edward Don 3-Bag quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('Edward Don & Company', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1009', cust.id, 'Edward Don & Company',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'OCEAN'
FROM cust;

-- The Paror quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('The Paror', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1010', cust.id, 'The Paror',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'OCEAN'
FROM cust;

-- ZOV quote
WITH cust AS (
  INSERT INTO customers (company_name, contact_name, is_active)
  VALUES ('ZOV Restaurant Group', 'Purchasing Dept', true)
  ON CONFLICT (company_name) DO UPDATE SET company_name = EXCLUDED.company_name
  RETURNING id
)
INSERT INTO quote_costing (
  quote_number, customer_id, customer_name,
  quote_date, valid_until, prepared_by, status,
  default_markup_pct, default_duty_pct, freight_method
)
SELECT 'QC-2026-1011', cust.id, 'ZOV Restaurant Group',
  '2026-05-29', '2026-06-28', 'beyondGREEN Sales', 'Draft', 45, 35, 'OCEAN'
FROM cust;
