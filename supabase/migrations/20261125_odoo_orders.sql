-- Civil Doody consumer orders pulled from their Odoo database (one row per Odoo delivery order).
-- Kept off sales_orders on purpose: each one is a single box shipped to a consumer, so the sales
-- order automations (work orders, QC, invoices, address learning) must not run for them.
-- target = 'test' (civildoody-workflow-testing) or 'live' (civildoody). Shipping a row sends the
-- shipped quantity, carrier and tracking number back to Odoo and validates the Odoo delivery.

create table if not exists public.odoo_orders (
  id uuid primary key default gen_random_uuid(),
  target text not null default 'test' check (target in ('test', 'live')),
  picking_id integer not null,
  picking_name text not null,
  sale_order_name text,
  odoo_state text,
  customer_name text,
  customer_email text,
  customer_phone text,
  ship_address text,
  scheduled_date timestamptz,
  order_date timestamptz,
  is_subscription boolean,
  lines jsonb not null default '[]'::jsonb,
  status text not null default 'New' check (status in ('New', 'On Hold', 'Waiting on Stock', 'Packed', 'Shipped', 'Partial', 'Cancelled', 'Closed in Odoo')),
  carrier text,
  tracking_number text,
  shipped_at timestamptz,
  shipped_by text,
  shipped_lines jsonb,
  sync_status text check (sync_status in ('sent', 'failed', 'blocked')),
  sync_message text,
  synced_at timestamptz,
  notes text,
  pulled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target, picking_id)
);
create index if not exists odoo_orders_status_idx on public.odoo_orders (target, status);

alter table public.odoo_orders enable row level security;
do $$ begin
  create policy staff_all_odoo_orders on public.odoo_orders for all to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))
    with check (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;

-- No nav entry: the board is the Civil Doody Orders tab on Sales Orders (/sales/orders?view=civildoody).
