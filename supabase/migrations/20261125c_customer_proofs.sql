-- Customer proof approval: send a mockup / proof from a sales order to the customer,
-- who approves it or asks for changes on a public page (proof host, no login).
create table if not exists public.customer_proofs (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid references public.sales_orders(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  token text not null unique,
  round_no integer not null default 1,
  title text,
  file_attachment_id uuid references public.file_attachments(id) on delete set null,
  storage_path text not null,
  file_name text,
  recipient_name text,
  recipient_email text not null,
  cc_emails text[] not null default '{}',
  message text,
  status text not null default 'sent' check (status in ('sent', 'approved', 'changes_requested', 'cancelled')),
  sent_by text,
  sent_at timestamptz not null default now(),
  email_sent boolean not null default false,
  viewed_at timestamptz,
  view_count integer not null default 0,
  decided_at timestamptz,
  decided_name text,
  decided_email text,
  decision_note text,
  created_at timestamptz not null default now()
);

create index if not exists customer_proofs_order_idx on public.customer_proofs(sales_order_id, created_at desc);

alter table public.customer_proofs enable row level security;
do $$ begin
  create policy staff_all_customer_proofs on public.customer_proofs for all to authenticated
    using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))
    with check (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'));
exception when duplicate_object then null; end $$;
