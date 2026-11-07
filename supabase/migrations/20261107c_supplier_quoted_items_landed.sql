-- Landed cost inputs on supplier quoted items + editable landed / pricing tier assumptions.
alter table public.supplier_quoted_items
  add column if not exists uom text,
  add column if not exists unit_weight_g numeric,
  add column if not exists units_per_container numeric,
  add column if not exists duty_pct_override numeric;

create table if not exists public.supplier_landed_settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.supplier_landed_settings enable row level security;
do $$ begin
  create policy staff_all_supplier_landed_settings on public.supplier_landed_settings for all to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))
    with check (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;
