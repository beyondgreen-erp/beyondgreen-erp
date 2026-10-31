-- Client portal self-service: sign-up + onboarding, order requests with PO upload,
-- project (RFQ) submission, call booking (Outlook + Zoom), shared vendor-setup documents.
-- Additive only: new nullable columns and new tables. Nothing existing is changed or dropped.

-- 1) Portal accounts: sign-up, verification, approval, onboarding packet
alter table public.portal_clients
  add column if not exists phone text,
  add column if not exists title text,
  add column if not exists signup_source text,              -- 'staff' | 'self'
  add column if not exists email_verified_at timestamptz,
  add column if not exists approved_at timestamptz,          -- ordering unlocks when set
  add column if not exists approved_by text,
  add column if not exists onboarding jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_submitted_at timestamptz,
  add column if not exists signup_ip text;

-- Staff-created accounts are trusted: treat them as verified + approved.
update public.portal_clients
   set signup_source = coalesce(signup_source, 'staff'),
       approved_at = coalesce(approved_at, created_at),
       approved_by = coalesce(approved_by, 'staff-created'),
       email_verified_at = coalesce(email_verified_at, case when password_hash is not null then created_at end)
 where signup_source is null;

create unique index if not exists portal_clients_email_lower_uq on public.portal_clients (lower(email));

-- 2) Orders placed from the portal. Staff convert to a Sales Order in one click.
create table if not exists public.portal_order_requests (
  id uuid primary key default gen_random_uuid(),
  request_number text not null default ('WEB-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(md5(random()::text), 1, 4))),
  portal_client_id uuid not null references public.portal_clients(id) on delete cascade,
  customer_id uuid references public.customers(id),
  po_number text,
  po_storage_path text,
  po_file_name text,
  requested_ship_date date,
  ship_to text,
  delivery_notes text,
  lines jsonb not null default '[]'::jsonb,                  -- [{sku, description, product_id, quantity, unit, last_price}]
  notes text,
  status text not null default 'Submitted',                  -- Submitted | Converted | Declined | Cancelled
  sales_order_id uuid references public.sales_orders(id),
  decline_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  converted_at timestamptz,
  converted_by text
);
create index if not exists portal_order_requests_client_idx on public.portal_order_requests (portal_client_id, created_at desc);
create index if not exists portal_order_requests_status_idx on public.portal_order_requests (status);

-- 3) Calls booked from the portal (Outlook calendar + Zoom)
create table if not exists public.portal_bookings (
  id uuid primary key default gen_random_uuid(),
  portal_client_id uuid not null references public.portal_clients(id) on delete cascade,
  customer_id uuid references public.customers(id),
  topic text not null,
  quotation_id uuid references public.quotations(id),
  start_at timestamptz,
  end_at timestamptz,
  preferred_times jsonb,                                      -- when calendar is not connected: client's 3 picks
  status text not null default 'Confirmed',                   -- Confirmed | Requested | Cancelled
  host_email text,
  zoom_join_url text,
  zoom_meeting_id text,
  outlook_event_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists portal_bookings_client_idx on public.portal_bookings (portal_client_id, start_at desc);
create index if not exists portal_bookings_start_idx on public.portal_bookings (start_at) where status = 'Confirmed';
-- one confirmed booking per slot per host
create unique index if not exists portal_bookings_slot_uq on public.portal_bookings (host_email, start_at) where status = 'Confirmed';

-- 4) Documents customers can download for vendor setup (W-9, COI, certificates, spec sheets)
create table if not exists public.portal_shared_documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Company',                   -- Company | Certifications | Spec sheets | Forms
  description text,
  storage_path text,                                          -- erp-files bucket
  url text,                                                   -- or an external link
  is_active boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  created_by text
);

insert into public.portal_shared_documents (name, category, description, url, sort)
select * from (values
  ('Certifications and certificate numbers', 'Certifications', 'BPI, TÜV AUSTRIA, DIN CERTCO and USDA BioPreferred, with numbers and scope.', 'https://byndgrn.com/certifications', 10),
  ('BPI certified product listing', 'Certifications', 'All beyondGREEN products listed with the Biodegradable Products Institute.', 'https://products.bpiworld.org/companies/beyondgreen-biotech-inc', 20),
  ('Product catalog', 'Spec sheets', 'Every product line with sizes, pack-outs and certifications.', 'https://byndgrn.com/products', 30)
) v(name, category, description, url, sort)
where not exists (select 1 from public.portal_shared_documents);

-- RLS: these tables are only touched by the server (service role) and by signed-in staff.
alter table public.portal_order_requests enable row level security;
alter table public.portal_bookings enable row level security;
alter table public.portal_shared_documents enable row level security;

do $$ begin
  create policy staff_all_order_requests on public.portal_order_requests for all to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))
    with check (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_bookings on public.portal_bookings for all to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))
    with check (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_all_shared_docs on public.portal_shared_documents for all to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))
    with check (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;

-- Same "offsite gate" restrictive policies the rest of the ERP uses.
do $$
declare t text;
begin
  foreach t in array array['portal_order_requests', 'portal_bookings', 'portal_shared_documents'] loop
    begin execute format('create policy "offsite gate: read" on public.%I as restrictive for select to authenticated using ((select erp_can_read_now()))', t); exception when duplicate_object then null; end;
    begin execute format('create policy "offsite gate: insert" on public.%I as restrictive for insert to authenticated with check ((select erp_can_write_now()))', t); exception when duplicate_object then null; end;
    begin execute format('create policy "offsite gate: update" on public.%I as restrictive for update to authenticated using ((select erp_can_write_now()))', t); exception when duplicate_object then null; end;
    begin execute format('create policy "offsite gate: delete" on public.%I as restrictive for delete to authenticated using ((select erp_can_write_now()))', t); exception when duplicate_object then null; end;
  end loop;
end $$;
