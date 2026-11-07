-- Bid Tracker: large multi-item bids (first one: PIC / Proud Impact Collective) where each item is
-- either made in Santa Ana, costed from supplier quotes we already have, or sent out for RFQ.
-- The Quotes & RFQs page shows it as its own tab; the Command Center reads it and logs supplier
-- replies into it through public.hub_bid (same secret as the other hub_* functions).

create table if not exists public.bid_projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'Open' check (status in ('Open', 'Submitted', 'Won', 'Lost', 'On Hold')),
  due_date date,
  profit_split_pct numeric not null default 50,
  notes text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bid_items (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bid_projects(id) on delete cascade,
  line_no integer,
  item_name text not null,
  case_pack numeric,
  annual_cases numeric,
  annual_units numeric,
  branded text,
  customer_notes text,
  category text,
  sourcing_path text,
  rfq_group text,
  cogs_unit numeric,
  cogs_basis text,
  delivered_unit numeric,
  origin text,
  target_suppliers text,
  status text not null default 'Open' check (status in ('Open', 'Costing', 'RFQ Sent', 'Quoted', 'Costed', 'Bid Ready', 'No Bid')),
  assigned_to text,
  notes text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bid_items_bid_idx on public.bid_items (bid_id, line_no);

create table if not exists public.bid_rfqs (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bid_projects(id) on delete cascade,
  supplier_name text not null,
  vendor_id uuid references public.vendors(id) on delete set null,
  email text,
  country text,
  rfq_group text,
  item_ids uuid[] not null default '{}',
  status text not null default 'Draft' check (status in ('Draft', 'Sent', 'Replied', 'Quoted', 'Declined', 'No Reply')),
  mailbox text,
  draft_id text,
  sent_at timestamptz,
  last_reply_at timestamptz,
  reply_count integer not null default 0,
  reply_preview text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bid_rfqs_bid_idx on public.bid_rfqs (bid_id);
create index if not exists bid_rfqs_email_idx on public.bid_rfqs (lower(email));

create table if not exists public.bid_quotes (
  id uuid primary key default gen_random_uuid(),
  bid_item_id uuid not null references public.bid_items(id) on delete cascade,
  rfq_id uuid references public.bid_rfqs(id) on delete set null,
  supplier_name text not null,
  unit_price numeric,
  incoterm text,
  landed_unit numeric,
  moq text,
  lead_time text,
  quote_date date default current_date,
  notes text,
  source text,
  is_selected boolean not null default false,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists bid_quotes_item_idx on public.bid_quotes (bid_item_id);

create table if not exists public.bid_activity (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bid_projects(id) on delete cascade,
  item_id uuid references public.bid_items(id) on delete cascade,
  rfq_id uuid references public.bid_rfqs(id) on delete cascade,
  kind text not null,
  message text not null,
  actor text,
  msg_id text,
  at timestamptz not null default now()
);
create index if not exists bid_activity_bid_idx on public.bid_activity (bid_id, at desc);
create unique index if not exists bid_activity_msg_uidx on public.bid_activity (msg_id) where msg_id is not null;

do $$
declare t text;
begin
  foreach t in array array['bid_projects', 'bid_items', 'bid_rfqs', 'bid_quotes', 'bid_activity'] loop
    execute format('alter table public.%I enable row level security', t);
    begin
      execute format($p$create policy staff_all_%1$s on public.%1$I for all to authenticated
        using (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))
        with check (split_part(lower(auth.jwt() ->> 'email'), '@', 2) in ('beyondgreenbiotech.com', 'byndgrn.com'))$p$, t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- Command Center link. Fixed actions only, no delete. Every change is written to bid_activity.
create or replace function public.hub_bid(p_secret text, p_action text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  a jsonb := coalesce(p_args, '{}'::jsonb);
  r public.bid_rfqs%rowtype; it public.bid_items%rowtype; v_new uuid; v_at timestamptz;
begin
  if not public.hub_ok(p_secret) then raise exception 'unauthorized'; end if;

  if p_action = 'rfq_reply' then
    select * into r from public.bid_rfqs where id = (a->>'rfq_id')::uuid;
    if r.id is null then raise exception 'No RFQ has that id'; end if;
    if nullif(a->>'msg_id', '') is not null and exists (select 1 from public.bid_activity where msg_id = a->>'msg_id') then
      return jsonb_build_object('ok', true, 'skipped', true);
    end if;
    v_at := coalesce(nullif(a->>'at', '')::timestamptz, now());
    update public.bid_rfqs set status = case when status in ('Draft', 'Sent', 'No Reply') then 'Replied' else status end,
      last_reply_at = greatest(coalesce(last_reply_at, v_at), v_at), reply_count = reply_count + 1,
      reply_preview = left(coalesce(a->>'preview', ''), 600), updated_at = now() where id = r.id;
    insert into public.bid_activity (bid_id, rfq_id, kind, message, actor, msg_id, at)
      values (r.bid_id, r.id, 'reply', left(r.supplier_name || ' replied: ' || coalesce(a->>'preview', ''), 900), 'Command Center', nullif(a->>'msg_id', ''), v_at);
    return jsonb_build_object('ok', true, 'summary', r.supplier_name || ' reply logged');

  elsif p_action = 'rfq_status' then
    select * into r from public.bid_rfqs where id = (a->>'rfq_id')::uuid;
    if r.id is null then raise exception 'No RFQ has that id'; end if;
    if (a->>'status') not in ('Draft', 'Sent', 'Replied', 'Quoted', 'Declined', 'No Reply') then raise exception 'Unknown RFQ status'; end if;
    update public.bid_rfqs set status = a->>'status', sent_at = case when a->>'status' = 'Sent' then coalesce(nullif(a->>'at','')::timestamptz, sent_at, now()) else sent_at end,
      notes = coalesce(nullif(a->>'notes', ''), notes), updated_at = now() where id = r.id;
    if nullif(a->>'msg_id', '') is null or not exists (select 1 from public.bid_activity where msg_id = a->>'msg_id') then
      insert into public.bid_activity (bid_id, rfq_id, kind, message, actor, msg_id)
        values (r.bid_id, r.id, 'rfq', r.supplier_name || ' RFQ set to ' || (a->>'status'), 'Command Center', nullif(a->>'msg_id', ''));
    end if;
    return jsonb_build_object('ok', true);

  elsif p_action = 'add_quote' then
    select * into it from public.bid_items where id = (a->>'item_id')::uuid;
    if it.id is null then raise exception 'No bid item has that id'; end if;
    if btrim(coalesce(a->>'supplier_name', '')) = '' then raise exception 'supplier_name is required'; end if;
    insert into public.bid_quotes (bid_item_id, rfq_id, supplier_name, unit_price, incoterm, landed_unit, moq, lead_time, notes, source, created_by)
      values (it.id, nullif(a->>'rfq_id', '')::uuid, left(a->>'supplier_name', 160), nullif(a->>'unit_price', '')::numeric,
        left(nullif(a->>'incoterm', ''), 20), nullif(a->>'landed_unit', '')::numeric, left(nullif(a->>'moq', ''), 120),
        left(nullif(a->>'lead_time', ''), 120), left(nullif(a->>'notes', ''), 1000), 'Command Center', 'Command Center')
      returning id into v_new;
    update public.bid_items set status = case when status in ('Open', 'Costing', 'RFQ Sent') then 'Quoted' else status end, updated_at = now(), updated_by = 'Command Center' where id = it.id;
    if nullif(a->>'rfq_id', '') is not null then
      update public.bid_rfqs set status = 'Quoted', updated_at = now() where id = (a->>'rfq_id')::uuid;
    end if;
    insert into public.bid_activity (bid_id, item_id, rfq_id, kind, message, actor)
      values (it.bid_id, it.id, nullif(a->>'rfq_id', '')::uuid, 'quote',
        left(a->>'supplier_name', 160) || ' quoted ' || it.item_name || coalesce(' at $' || (a->>'unit_price') || ' ' || coalesce(a->>'incoterm', ''), ''), 'Command Center');
    return jsonb_build_object('ok', true, 'id', v_new);

  elsif p_action = 'update_item' then
    select * into it from public.bid_items where id = (a->>'item_id')::uuid;
    if it.id is null then raise exception 'No bid item has that id'; end if;
    if a ? 'status' and (a->>'status') not in ('Open', 'Costing', 'RFQ Sent', 'Quoted', 'Costed', 'Bid Ready', 'No Bid') then raise exception 'Unknown item status'; end if;
    update public.bid_items set
      status = coalesce(nullif(a->>'status', ''), status),
      cogs_unit = case when a ? 'cogs_unit' then nullif(a->>'cogs_unit', '')::numeric else cogs_unit end,
      cogs_basis = case when a ? 'cogs_basis' then left(a->>'cogs_basis', 600) else cogs_basis end,
      delivered_unit = case when a ? 'delivered_unit' then nullif(a->>'delivered_unit', '')::numeric else delivered_unit end,
      notes = case when a ? 'notes' then left(a->>'notes', 2000) else notes end,
      updated_at = now(), updated_by = 'Command Center'
      where id = it.id;
    insert into public.bid_activity (bid_id, item_id, kind, message, actor)
      values (it.bid_id, it.id, 'item', it.item_name || ' updated from the Command Center', 'Command Center');
    return jsonb_build_object('ok', true);
  end if;
  raise exception 'Unknown action %', p_action;
end $$;
revoke all on function public.hub_bid(text, text, jsonb) from public;
grant execute on function public.hub_bid(text, text, jsonb) to anon, authenticated;
