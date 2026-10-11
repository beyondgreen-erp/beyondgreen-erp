-- CRM cleanup (Oct 2026)
-- 1. Customer status is one of: Active Customer, Lead, Closed - Lost.
-- 2. Customer sales stats come from the Shipments board (shipped value, not freight cost).
-- 3. A shipment for a Lead converts that customer to Active Customer automatically.
-- 4. A new sales order links the customer's open quote and marks it Accepted.

-- ── 1. Three statuses only ───────────────────────────────────────────────
create or replace function public.normalize_customer_status(s text)
returns text language sql immutable as $$
  select case
    when lower(trim(coalesce(s, ''))) in ('active', 'active customer') then 'Active Customer'
    when lower(trim(coalesce(s, ''))) in ('inactive', 'do not contact', 'closed lost', 'closed - lost', 'lost', 'dead') then 'Closed - Lost'
    else 'Lead'
  end
$$;

create or replace function public.trg_normalize_customer_status()
returns trigger language plpgsql as $$
begin
  new.customer_status := public.normalize_customer_status(new.customer_status);
  return new;
end $$;

create or replace trigger trg_normalize_customer_status
  before insert or update of customer_status on public.customers
  for each row execute function public.trg_normalize_customer_status();

-- ── 2. Shipment-based customer stats ─────────────────────────────────────
-- A shipment counts when it actually shipped. It belongs to a customer through its
-- sales order; older imported shipments with no sales order match on the company name
-- (the part before any "|"). Duplicates merged into a customer roll up into it.
-- The main record for a company name (pre-ERP shipments only match by name, so duplicates
-- like "Walmart" / "WALMART" must not both count them).
create or replace function public.canonical_customer_for_name(p_name text)
returns uuid language sql stable security definer set search_path = public as $$
  select c.id from customers c
   where lower(trim(c.company_name)) = lower(trim(p_name)) and not coalesce(c.is_merged, false)
   order by (c.board = 'customer') desc,
            (select count(*) from sales_orders o where o.customer_id = c.id) desc,
            c.created_at asc, c.id
   limit 1
$$;

create or replace function public.recompute_customer_stats(p_customer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_keys text[];
  v_ids uuid[];
  v_spend numeric; v_cnt int; v_first date; v_last date;
begin
  if not exists (select 1 from customers where id = p_customer) then return; end if;

  select array(
    select lower(trim(c.company_name)) from customers c
     where c.id = p_customer and public.canonical_customer_for_name(c.company_name) = p_customer
    union
    select lower(trim(n)) from customers c, unnest(coalesce(c.merged_from_names, '{}'::text[])) n
     where c.id = p_customer
       and not exists (select 1 from customers x where lower(trim(x.company_name)) = lower(trim(n))
                         and not coalesce(x.is_merged, false) and x.id <> p_customer)
  ) into v_keys;

  v_ids := array(select p_customer union select id from customers where merged_into = p_customer);

  with counted as (
    select s.total_value, s.ship_date
      from shipments s
      join sales_orders o on o.id = coalesce(s.sales_order_id, s.order_id)
     where o.customer_id = any(v_ids)
       and s.ship_date is not null
       and coalesce(s.status, 'Shipped') in ('Shipped', 'Partially Shipped')
    union all
    select s.total_value, s.ship_date
      from shipments s
     where coalesce(s.sales_order_id, s.order_id) is null
       and s.ship_date is not null
       and coalesce(s.status, 'Shipped') in ('Shipped', 'Partially Shipped')
       and lower(trim(split_part(s.customer_name, '|', 1))) = any(v_keys)
  )
  select coalesce(sum(total_value), 0), count(*), min(ship_date), max(ship_date)
    into v_spend, v_cnt, v_first, v_last
    from counted;

  update customers c
     set lifetime_spend      = case when coalesce(c.manual_spend_override, false) then c.lifetime_spend else round(v_spend, 2) end,
         total_shipments     = v_cnt,
         first_shipment_date = v_first,
         last_shipment_date  = v_last
   where c.id = p_customer
     and (c.total_shipments is distinct from v_cnt
       or c.first_shipment_date is distinct from v_first
       or c.last_shipment_date is distinct from v_last
       or (not coalesce(c.manual_spend_override, false) and c.lifetime_spend is distinct from round(v_spend, 2)));
end $$;

-- Lead -> Active Customer once something has actually shipped to them.
create or replace function public.promote_customer_on_shipment(p_customer uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_target uuid;
begin
  select coalesce(merged_into, id) into v_target from customers where id = p_customer;
  if v_target is null then return; end if;
  update customers
     set customer_status = 'Active Customer', board = 'customer', is_active = true, updated_at = now()
   where id = v_target
     and (customer_status is distinct from 'Active Customer' or board is distinct from 'customer');
end $$;

-- Re-totals the customer a shipment belongs to (and promotes them when it shipped).
create or replace function public.apply_shipment_to_customer(p_so uuid, p_name text, p_ship_date date, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cust uuid;
  v_key text;
begin
  if p_so is not null then
    select coalesce(c.merged_into, c.id) into v_cust
      from sales_orders o join customers c on c.id = o.customer_id
     where o.id = p_so;
  end if;

  if v_cust is not null then
    perform public.recompute_customer_stats(v_cust);
    if p_ship_date is not null and coalesce(p_status, 'Shipped') in ('Shipped', 'Partially Shipped') then
      perform public.promote_customer_on_shipment(v_cust);
    end if;
  elsif p_so is null then
    v_key := lower(trim(split_part(coalesce(p_name, ''), '|', 1)));
    if v_key <> '' then
      perform public.recompute_customer_stats(c.id) from customers c
       where lower(trim(c.company_name)) = v_key and not coalesce(c.is_merged, false);
    end if;
  end if;
end $$;

-- Replaces the old name-only trigger body (which summed freight cost as spend).
create or replace function public.update_customer_shipment_totals()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op <> 'DELETE' then
    perform public.apply_shipment_to_customer(coalesce(new.sales_order_id, new.order_id), new.customer_name, new.ship_date, new.status);
  end if;
  if tg_op <> 'INSERT' and (tg_op = 'DELETE'
      or coalesce(old.sales_order_id, old.order_id) is distinct from coalesce(new.sales_order_id, new.order_id)
      or old.customer_name is distinct from new.customer_name) then
    perform public.apply_shipment_to_customer(coalesce(old.sales_order_id, old.order_id), old.customer_name, old.ship_date, old.status);
  end if;
  return coalesce(new, old);
end $$;

create or replace trigger shipment_customer_totals
  after insert or update or delete on public.shipments
  for each row execute function public.update_customer_shipment_totals();

-- ── 4. Orders pick up the customer's open quote ──────────────────────────
-- If the order has no quote, link the customer's most recent open quote
-- (Draft / Quoting / Quoted / Sent) dated within 120 days before the order that
-- no other order has claimed. Whatever quote the order ends up with is marked Accepted.
create or replace function public.link_order_to_open_quote()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_q record;
begin
  if new.customer_id is null then return new; end if;

  if new.quotation_id is null then
    v_ids := array(
      select coalesce(c.merged_into, c.id) from customers c where c.id = new.customer_id
      union select c2.id from customers c2
       where c2.merged_into = (select coalesce(merged_into, id) from customers where id = new.customer_id)
      union select new.customer_id);
    select q.id, q.quote_number into v_q
      from quotations q
     where q.customer_id = any(v_ids)
       and q.status in ('Draft', 'Quoting', 'Quoted', 'Sent')
       and coalesce(q.is_active, true)
       and coalesce(q.quote_date, q.created_at::date) between coalesce(new.order_date, current_date) - 120 and coalesce(new.order_date, current_date)
       and not exists (select 1 from sales_orders o where o.quotation_id = q.id and o.id is distinct from new.id)
     order by coalesce(q.quote_date, q.created_at::date) desc, q.created_at desc
     limit 1;
    if v_q.id is not null then
      new.quotation_id := v_q.id;
      new.source_quote_number := coalesce(new.source_quote_number, v_q.quote_number);
    end if;
  end if;

  if new.quotation_id is not null then
    update quotations
       set status = 'Accepted', updated_at = now()
     where id = new.quotation_id
       and coalesce(status, '') not in ('Accepted', 'Converted');
  end if;
  return new;
end $$;

create or replace trigger trg_link_order_to_open_quote
  before insert or update of customer_id, quotation_id on public.sales_orders
  for each row execute function public.link_order_to_open_quote();

-- One-time data work run alongside this (Oct 11 2026), with backups in
-- customers_backup_20261011 / quotations_backup_20261011:
--   * statuses normalized to the three values
--   * recompute_customer_stats() run for every Customer/Leads record
--   * Imperial Dade and Edward Don & Company un-flagged as merged (they are the live accounts)
--     and their empty duplicates folded in
--   * Leads with shipped history converted to Active Customer
--   * orders 31674 and 31721 linked to quotes Q-2026-0042 and Q-2026-0061
