-- New columns for sales_orders (Monday.com import schema)
ALTER TABLE sales_orders
  ADD COLUMN IF NOT EXISTS monday_item_id      text,
  ADD COLUMN IF NOT EXISTS order_section       text,
  ADD COLUMN IF NOT EXISTS facility            text,
  ADD COLUMN IF NOT EXISTS purchase_order_url  text,
  ADD COLUMN IF NOT EXISTS packing_slip_url    text,
  ADD COLUMN IF NOT EXISTS bol                 text,
  ADD COLUMN IF NOT EXISTS production_start    date,
  ADD COLUMN IF NOT EXISTS estimated_completion date,
  ADD COLUMN IF NOT EXISTS customer_email      text,
  ADD COLUMN IF NOT EXISTS customer_phone      text,
  ADD COLUMN IF NOT EXISTS additional_comments text,
  ADD COLUMN IF NOT EXISTS total_amount        numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ship_date           date;

-- New columns for sales_order_lines
ALTER TABLE sales_order_lines
  ADD COLUMN IF NOT EXISTS monday_item_id     text,
  ADD COLUMN IF NOT EXISTS detail_bom_url     text,
  ADD COLUMN IF NOT EXISTS completed_qty      numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS qty_per_case       numeric,
  ADD COLUMN IF NOT EXISTS packaging          text,
  ADD COLUMN IF NOT EXISTS production_status  text,
  ADD COLUMN IF NOT EXISTS added_details      text,
  ADD COLUMN IF NOT EXISTS sku_flagged        boolean DEFAULT false;
