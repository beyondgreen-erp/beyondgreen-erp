-- Daily Odoo sync for Civil Doody: one row per run per database, and one settings row for the
-- report email. Staff can read both; only the server (service role) writes them.
create table if not exists public.odoo_sync_runs (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('test', 'live')),
  trigger text not null default 'daily',
  ran_at timestamptz not null default now(),
  period_start timestamptz,
  pulled jsonb,
  new_orders jsonb not null default '[]'::jsonb,
  shipments jsonb not null default '[]'::jsonb,
  problems jsonb not null default '[]'::jsonb,
  totals jsonb,
  email_status text,
  email_to text,
  email_cc text,
  emailed_at timestamptz
);
create index if not exists odoo_sync_runs_target_idx on public.odoo_sync_runs (target, ran_at desc);

create table if not exists public.odoo_sync_settings (
  id integer primary key default 1 check (id = 1),
  report_enabled boolean not null default false,
  report_to text not null default 'shannan@civildoody.com',
  report_cc text not null default 'rudyp@beyondgreenbiotech.com',
  report_target text not null default 'test' check (report_target in ('test', 'live')),
  updated_by text,
  updated_at timestamptz not null default now()
);
insert into public.odoo_sync_settings (id) values (1) on conflict (id) do nothing;

alter table public.odoo_sync_runs enable row level security;
alter table public.odoo_sync_settings enable row level security;
do $$ begin
  create policy staff_read_odoo_sync_runs on public.odoo_sync_runs for select to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;
do $$ begin
  create policy staff_read_odoo_sync_settings on public.odoo_sync_settings for select to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;
