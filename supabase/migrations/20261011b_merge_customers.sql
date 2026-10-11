-- Customer merges (Oct 11 2026)
-- merge_customers(primary, duplicates[], note) moves every record that points at a duplicate
-- (all foreign keys to customers, plus comments and tasks), fills missing contact fields,
-- archives the duplicates (is_merged, merged_into) and recalculates totals from shipments.
-- The Customer/Leads "Merge" button calls it through /api/customers/merge.
-- link_order_to_open_quote now ignores orders being re-pointed by a merge.
--
-- One-time work run with this (backups: merge_log_20261011, shipments_value_backup_20261011):
--   * Walmart #1203 absorbed WALMART #1025 and 22 Walmart buyer records (emails kept as contacts)
--   * CHEWY #1046 absorbed Chewy #1226 and 12 Chewy buyer records (emails kept as contacts);
--     "Chewy.com" and "Chewy_Inc_*" shipment names added to its merged names
--   * Amy Franz #1198 renamed Merde Bag and absorbed Merde Bag #1182
--   * Living Balance set to Closed - Lost
--   * 76 older shipments got their value from the one sales order with the same PO
--   * 365 Chewy shipments (Sep 2025 on) got an estimated value: that day's Chewy total from the
--     Daily Ship Report, less already-valued Chewy shipments, split evenly (noted on each shipment)

create or replace function public.link_order_to_open_quote()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ids uuid[];
  v_q record;
begin
  if new.customer_id is null then return new; end if;
  -- Re-pointing existing orders to another record (account merges) is not a new order.
  if tg_op = 'UPDATE' and old.customer_id is not null and old.customer_id <> new.customer_id
     and new.quotation_id is not distinct from old.quotation_id then
    return new;
  end if;

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

create or replace function public.merge_customers(p_primary uuid, p_dups uuid[], p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  t record;
  v_names text[];
  n int;
begin
  p_dups := array(select d from unnest(p_dups) d where d <> p_primary);
  if array_length(p_dups, 1) is null then return 0; end if;

  for t in
    select conrelid::regclass::text tbl, a.attname col
      from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.confrelid = 'public.customers'::regclass and c.contype = 'f'
       and conrelid <> 'public.customers'::regclass
  loop
    execute format('update %s set %I = $1 where %I = any($2)', t.tbl, t.col, t.col) using p_primary, p_dups;
  end loop;
  update customers set parent_customer_id = p_primary where parent_customer_id = any(p_dups);
  update comments set record_id = p_primary where record_type = 'customers' and record_id = any(p_dups);
  update tasks set customer_id = p_primary where customer_id = any(p_dups);

  select array(select distinct x from (
      select unnest(coalesce(merged_from_names, '{}')) x from customers where id = p_primary
      union all select company_name from customers where id = any(p_dups)
      union all select unnest(coalesce(merged_from_names, '{}')) from customers where id = any(p_dups)) s
    where x is not null and lower(trim(x)) <> lower(trim((select company_name from customers where id = p_primary))))
    into v_names;

  update customers p set
    merged_from_names = v_names,
    email   = coalesce(nullif(p.email, ''),   (select d.email   from customers d where d.id = any(p_dups) and coalesce(d.email,'')   <> '' limit 1)),
    phone   = coalesce(nullif(p.phone, ''),   (select d.phone   from customers d where d.id = any(p_dups) and coalesce(d.phone,'')   <> '' limit 1)),
    contact_name = coalesce(nullif(p.contact_name, ''), (select d.contact_name from customers d where d.id = any(p_dups) and coalesce(d.contact_name,'') <> '' limit 1)),
    billing_address  = coalesce(nullif(p.billing_address, ''),  (select d.billing_address  from customers d where d.id = any(p_dups) and coalesce(d.billing_address,'')  <> '' limit 1)),
    shipping_address = coalesce(nullif(p.shipping_address, ''), (select d.shipping_address from customers d where d.id = any(p_dups) and coalesce(d.shipping_address,'') <> '' limit 1)),
    updated_at = now()
  where p.id = p_primary;

  update customers set is_active = false, is_merged = true, merged_into = p_primary, updated_at = now()
   where id = any(p_dups);
  get diagnostics n = row_count;

  insert into customer_activity (customer_id, activity_type, source_type, source_id, source_label, author_email, content)
  values (p_primary, 'note', 'customers', p_primary, 'Account Merge', 'system',
          coalesce(p_note, 'Merged ' || n || ' duplicate record(s) into this account. Orders, quotes, invoices, contacts and history moved here.'));

  perform public.recompute_customer_stats(p_primary);
  return n;
end $$;
