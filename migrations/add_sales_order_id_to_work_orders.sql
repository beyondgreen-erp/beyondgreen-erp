ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS sales_order_id UUID REFERENCES sales_orders(id);
