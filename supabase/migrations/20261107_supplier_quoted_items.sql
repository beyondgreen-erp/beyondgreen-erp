-- Supplier Quoted Items: every supplier price we have received, grouped by product type,
-- whether it came in through an ERP RFQ response or by email.
create table if not exists public.supplier_quoted_items (
  id uuid primary key default gen_random_uuid(),
  product_type text not null,
  item_name text not null,
  size text,
  spec text,
  supplier_name text not null,
  vendor_id uuid references public.vendors(id) on delete set null,
  contact_name text,
  country text,
  unit_price numeric,
  currency text not null default 'USD',
  case_price numeric,
  pcs_per_case integer,
  incoterm text,
  port text,
  qty_basis numeric,
  moq text,
  plate_charge text,
  lead_time text,
  validity text,
  payment_terms text,
  certifications text,
  quote_ref text,
  quote_date date,
  rfq_number text,
  quotation_id uuid references public.quotations(id) on delete set null,
  source text,
  notes text,
  status text not null default 'Active',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists supplier_quoted_items_type_idx on public.supplier_quoted_items (product_type);
alter table public.supplier_quoted_items enable row level security;
do $$ begin
  create policy staff_all_supplier_quoted_items on public.supplier_quoted_items for all to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))
    with check (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;
