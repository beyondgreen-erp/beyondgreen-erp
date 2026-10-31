-- Inquiries from the public website forms (contact, investors, careers, press). Additive.
create table if not exists public.website_inquiries (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'contact',
  topic text,
  name text not null,
  company text,
  email text not null,
  phone text,
  message text,
  details jsonb not null default '{}'::jsonb,
  page text,
  ip text,
  customer_id uuid references public.customers(id),
  status text not null default 'New',
  created_at timestamptz not null default now()
);
create index if not exists website_inquiries_created_idx on public.website_inquiries (created_at desc);
create index if not exists website_inquiries_ip_idx on public.website_inquiries (ip, created_at desc);
alter table public.website_inquiries enable row level security;
do $$ begin
  create policy staff_all_website_inquiries on public.website_inquiries for all to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))
    with check (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;
