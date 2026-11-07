-- BOM red flag alerts (Nov 7 2026, requested by Robert Viloria)
-- 1. A BOM stays red-flagged until someone confirms it is complete.
-- 2. Long-lead / critical components (resin etc.) raise a red flag as soon as they
--    appear on ANY BOM row (even a partial BOM) and are not ordered, with an order-by date.
-- 3. Made-in-house finished goods with no BOM at all are flagged (they were skipped before).
-- 4. Every flag is logged; new flags email + notify the team, open critical flags repeat daily.

-- ── Product fields ───────────────────────────────────────────────────────────
alter table products add column if not exists bom_complete boolean not null default false;
alter table products add column if not exists bom_completed_at timestamptz;
alter table products add column if not exists bom_completed_by text;
alter table products add column if not exists is_long_lead boolean not null default false;
alter table products add column if not exists lead_time_days integer;

comment on column products.bom_complete is 'Someone confirmed every component is on this BOM. Until then open orders carry a BOM_UNCONFIRMED red flag.';
comment on column products.is_long_lead is 'Long-lead or critical component: red-flagged the moment it is on a BOM (even a partial one) and not ordered.';
comment on column products.lead_time_days is 'Supplier lead time in days, used to work out the order-by date on red flags.';

-- Resin is the long-lead material everyone worries about: start with every raw material marked long lead.
update products set is_long_lead = true where category = 'Raw Material' and not is_long_lead;

-- Existing BOMs that already have their material and add up are treated as complete (auto, visible on the BOM).
with b as (
  select upper(btrim(b.finished_good_sku)) fg,
         count(*) filter (where b.uom_type = 'percentage' or c.category = 'Component') n_material,
         count(*) filter (where b.uom_type = 'percentage') n_pct,
         coalesce(sum(coalesce(nullif(b.qty_value,0), b.percentage, 0)) filter (where b.uom_type = 'percentage' and (b.role = 'rm' or c.category = 'Raw Material')), 0) pct_rm
  from product_bom b left join products c on upper(btrim(c.sku)) = upper(btrim(b.component_sku))
  group by 1
)
update products p set bom_complete = true, bom_completed_at = now(),
       bom_completed_by = 'Auto: existing BOM passed checks (Nov 7 2026)'
from b where b.fg = upper(p.sku) and b.n_material > 0 and (b.n_pct = 0 or b.pct_rm >= 95) and not p.bom_complete;

-- ── Red flag view (same first 10 columns as before, plus severity + order_by_date) ──
create or replace view v_material_red_flags as
with o as (
  select so.id, so.order_number, so.status, so.required_ship_date
  from sales_orders so
  where coalesce(so.archived,false) = false and coalesce(so.is_active,true)
    and coalesce(so.order_number,'') not like 'WALMART|%'
    and coalesce(so.status,'') <> all (array['Shipped','Cancelled','Canceled','Closed','Completed','Delivered','On Hold','QC','Ready for Packing List','Ready to Ship','Ready at Will Call','Ready for Invoice'])
), ln as (
  select o.id order_id, o.order_number, o.status order_status, o.required_ship_date,
         p.id product_id, p.sku, p.product_name, p.unit_of_measure fg_uom, p.weight_per_unit_grams,
         p.pieces_per_pack, p.packs_per_case, p.case_qty, p.category, coalesce(p.is_import,false) is_import,
         coalesce(p.requires_bom,false) requires_bom, coalesce(p.bom_complete,false) bom_complete,
         greatest(greatest(coalesce(l.quantity,l.qty,0) - coalesce(l.quantity_shipped,0),0)
           * coalesce(l.uom_factor, l.qty_base / nullif(coalesce(l.quantity,l.qty),0), 1)
           - greatest(coalesce(p.on_hand_qty,0),0), 0) fg_short
  from o
  join sales_order_lines l on l.sales_order_id = o.id
  join products p on upper(p.sku) = upper(btrim(l.sku))
  where l.sku is not null and btrim(l.sku) <> '' and coalesce(p.production_line,'') <> 'straw'
), bom as (
  select upper(btrim(b.finished_good_sku)) fg, count(*) n_bom,
         count(*) filter (where b.uom_type = 'percentage') n_pct,
         coalesce(sum(coalesce(nullif(b.qty_value,0), b.percentage, 0)) filter (where b.uom_type = 'percentage' and (b.role = 'rm' or c.category = 'Raw Material')), 0) pct_rm,
         count(*) filter (where b.uom_type = 'percentage' or c.category = 'Component') n_material
  from product_bom b left join products c on upper(btrim(c.sku)) = upper(btrim(b.component_sku))
  group by 1
), made as (
  select ln.*, coalesce(bom.n_bom,0) n_bom, coalesce(bom.n_pct,0) n_pct, coalesce(bom.pct_rm,0) pct_rm,
         coalesce(bom.n_material,0) n_material,
         upper(coalesce(ln.fg_uom,'')) = any (array['CASE','CASES','CS','CTN','CARTON','CARTONS','PALLET','PALLETS','PLT']) case_like
  from ln left join bom on bom.fg = upper(ln.sku)
  where ln.fg_short > 0
    and (ln.requires_bom or coalesce(bom.n_bom,0) > 0
         -- made-in-house finished goods need a BOM even when nobody ticked "requires BOM"
         or (ln.category = 'Finished Goods' and not ln.is_import))
), line_flags as (
  select order_id, order_number, order_status, required_ship_date, sku, product_name, null::text component_sku,
         'NO_BOM'::text kind,
         'No BOM on ' || sku || ' yet, so its materials (including resin) cannot be checked or ordered' detail
  from made where n_bom = 0
  union all
  select order_id, order_number, order_status, required_ship_date, sku, product_name, null,
         'BOM_INCOMPLETE', 'The ' || sku || ' BOM has packaging only, no resin or components'
  from made where n_bom > 0 and n_material = 0
  union all
  select order_id, order_number, order_status, required_ship_date, sku, product_name, null,
         'BOM_INCOMPLETE', 'Raw material on the ' || sku || ' BOM adds up to only ' || round(pct_rm)::text || '% of the product weight'
  from made where n_pct > 0 and pct_rm < 95
  union all
  select order_id, order_number, order_status, required_ship_date, sku, product_name, null,
         'BOM_UNCONFIRMED', 'The ' || sku || ' BOM has not been marked complete, so components may still be missing. Long-lead items already on it are still checked'
  from made where n_bom > 0 and n_material > 0 and not bom_complete and not (n_pct > 0 and pct_rm < 95)
  union all
  select order_id, order_number, order_status, required_ship_date, sku, product_name, null,
         'CANT_SIZE', 'No unit weight on ' || sku || ', so the resin needed cannot be calculated'
  from made where n_pct > 0 and coalesce(weight_per_unit_grams,0) <= 0
  union all
  select order_id, order_number, order_status, required_ship_date, sku, product_name, null,
         'CANT_SIZE', 'Pieces per pack / packs per case not set on ' || sku || ' (sold by ' || coalesce(fg_uom,'?') || '), so the resin needed cannot be calculated'
  from made
  where n_pct > 0 and coalesce(weight_per_unit_grams,0) > 0
    and ((case_like and (coalesce(pieces_per_pack,0) <= 0 or coalesce(packs_per_case,0) <= 0) and coalesce(case_qty,0) <= 1)
         or (not case_like and upper(coalesce(fg_uom,'')) <> all (array['','PCS','PC','EA','EACH','PIECE','PIECES','UNIT','UNITS']) and coalesce(pieces_per_pack,0) <= 0))
), req as (
  select m.order_id, m.order_number, m.order_status, m.required_ship_date, m.sku, m.product_name, m.fg_short,
         m.fg_uom, m.case_like, r.component_sku, r.component_id, r.component_uom, r.uom_type, r.qty need, r.warning
  from made m
  cross join lateral bom_requirements(m.product_id, m.fg_short) r(component_sku, component_id, component_name, component_uom, role, uom_type, qty, basis, warning)
  where m.n_bom > 0
), size_flags as (
  select order_id, order_number, order_status, required_ship_date, sku, product_name, null::text component_sku,
         'CHECK_SIZE'::text kind,
         'Material math on ' || sku || ' looks wrong: ' || to_char(round(sum(need) / max(fg_short), 1), 'FM999,990.0') || ' lb of material per ' || coalesce(fg_uom,'unit') || '. Check pieces per pack and unit weight' detail
  from req
  where uom_type = 'percentage' and upper(coalesce(component_uom,'LBS')) = any (array['LBS','LB','POUNDS','POUND'])
  group by order_id, order_number, order_status, required_ship_date, sku, product_name, fg_uom
  having sum(need) / nullif(max(fg_short),0) > case when bool_or(case_like) then 150 else 10 end
), bad as (
  select distinct order_id, sku from line_flags where kind = 'CANT_SIZE'
  union select distinct order_id, sku from size_flags
), supply as (
  select upper(btrim(pr.supplier_pn)) sku,
         sum(case when pr.status = any (array['Pending Order','Pending Review']) then greatest(coalesce(_pr_qty(pr.qty_ordered),0) - coalesce(_pr_qty(pr.qty_received),0),0) else 0 end) requested,
         sum(case when pr.status <> all (array['Pending Order','Pending Review']) then greatest(coalesce(_pr_qty(pr.qty_ordered),0) - coalesce(_pr_qty(pr.qty_received),0),0) else 0 end) placed
  from purchasing_requests pr
  where coalesce(pr.is_active,true) and coalesce(pr.status,'') <> all (array['Received','PO Canceled'])
    and pr.supplier_pn is not null and btrim(pr.supplier_pn) <> ''
  group by 1
), short as (
  select q.*, greatest(coalesce(c.on_hand_qty,0),0) on_hand, coalesce(s.placed,0) placed, coalesce(s.requested,0) requested,
         q.need - greatest(coalesce(c.on_hand_qty,0),0) - coalesce(s.placed,0) gap,
         coalesce(c.is_long_lead,false) long_lead, c.lead_time_days,
         q.uom_type = 'percentage' and exists (select 1 from bad b where b.order_id = q.order_id and b.sku = q.sku) untrusted
  from req q
  join products c on c.id = q.component_id
  left join supply s on s.sku = upper(btrim(q.component_sku))
  where q.warning is null
), comp_flags as (
  select order_id, order_number, order_status, required_ship_date, sku, product_name, component_sku,
         'COMPONENT_MISSING'::text kind, component_sku || ' on the ' || sku || ' BOM is not in Inventory' detail,
         null::date order_by_date
  from req where component_id is null
  union all
  select order_id, order_number, order_status, required_ship_date, sku, product_name, component_sku,
         case when long_lead then 'LONG_LEAD' when requested <= 0 then 'NOT_ORDERED' else 'NOT_PLACED' end,
         case when long_lead then 'Long lead: ' else '' end
         || component_sku || case when requested <= 0 then ' is not on the purchasing board' else ' is requested but not ordered from a supplier yet' end
         || ' (quantity cannot be confirmed until the ' || sku || ' setup is fixed)',
         case when long_lead and lead_time_days is not null then required_ship_date - lead_time_days end
  from short where untrusted and placed <= 0 and (on_hand <= 0 or long_lead)
  union all
  select order_id, order_number, order_status, required_ship_date, sku, product_name, component_sku,
         case when long_lead then 'LONG_LEAD' when requested <= 0 then 'NOT_ORDERED' else 'NOT_PLACED' end,
         case when long_lead then 'Long lead: ' else '' end ||
         case when requested <= 0 then 'Short ' || to_char(round(gap,1),'FM999,999,990.0') || ' ' || coalesce(component_uom,'') || ' of ' || component_sku
                || ' and nothing is on the purchasing board (need ' || to_char(round(need,1),'FM999,999,990.0') || ', on hand ' || to_char(round(on_hand,1),'FM999,999,990.0') || ', on order ' || to_char(round(placed,1),'FM999,999,990.0') || ')'
              when requested >= gap then component_sku || ' is requested but not ordered from a supplier yet (' || to_char(round(gap,1),'FM999,999,990.0') || ' ' || coalesce(component_uom,'') || ' still needed)'
              else 'Short ' || to_char(round(gap,1),'FM999,999,990.0') || ' ' || coalesce(component_uom,'') || ' of ' || component_sku || '; only ' || to_char(round(requested,1),'FM999,999,990.0') || ' requested and none of it ordered from a supplier yet'
         end,
         case when long_lead and lead_time_days is not null then required_ship_date - lead_time_days end
  from short where not untrusted and need > 0 and gap > 0.0001
)
select order_id, order_number, order_status, required_ship_date, sku, product_name, component_sku, kind, detail,
       md5(order_id::text || '|' || sku || '|' || coalesce(component_sku,'') || '|' || kind) flag_key,
       case when kind in ('LONG_LEAD','NO_BOM','BOM_INCOMPLETE','BOM_UNCONFIRMED','COMPONENT_MISSING') then 'critical' else 'warning' end severity,
       order_by_date
from (
  select order_id, order_number, order_status, required_ship_date, sku, product_name, component_sku, kind, detail, null::date order_by_date from line_flags
  union all
  select order_id, order_number, order_status, required_ship_date, sku, product_name, component_sku, kind, detail, null::date from size_flags
  union all
  select * from comp_flags
) f;

-- ── Flag log: every flag stays open (red) until its cause is fixed ─────────────
create table if not exists material_red_flag_log (
  flag_key text primary key,
  order_id uuid,
  order_number text,
  sku text,
  component_sku text,
  kind text not null,
  severity text,
  detail text,
  required_ship_date date,
  order_by_date date,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  resolved_at timestamptz,
  notified_at timestamptz
);
create index if not exists material_red_flag_log_open on material_red_flag_log (resolved_at) where resolved_at is null;
alter table material_red_flag_log enable row level security;
drop policy if exists material_red_flag_log_read on material_red_flag_log;
create policy material_red_flag_log_read on material_red_flag_log for select to authenticated using (true);

-- Who gets the alerts (add or remove people here, or from the Material Red Flags page)
insert into notification_settings (notification_type, user_email, in_app, email)
select 'material_red_flag', e, true, true
from unnest(array['robert@beyondgreenbiotech.com','shea@beyondgreenbiotech.com','rudyp@beyondgreenbiotech.com']) e
where not exists (select 1 from notification_settings n where n.notification_type = 'material_red_flag' and n.user_email = e);

-- ── Sync: log new flags, close fixed ones, alert on anything new ───────────────
create or replace function material_red_flags_sync(p_send boolean default true)
returns int
language plpgsql security definer set search_path = public, pg_temp
as $$
declare n_new int; v_html text; v_to text[]; v_inapp text[];
begin
  create temp table _cur on commit drop as select * from v_material_red_flags;

  update material_red_flag_log l
     set last_seen = now(), detail = c.detail, severity = c.severity, order_by_date = c.order_by_date,
         required_ship_date = c.required_ship_date, resolved_at = null
    from _cur c where c.flag_key = l.flag_key;

  insert into material_red_flag_log (flag_key, order_id, order_number, sku, component_sku, kind, severity, detail, required_ship_date, order_by_date)
  select c.flag_key, c.order_id, c.order_number, c.sku, c.component_sku, c.kind, c.severity, c.detail, c.required_ship_date, c.order_by_date
    from _cur c on conflict (flag_key) do nothing;

  update material_red_flag_log set resolved_at = now()
   where resolved_at is null and flag_key not in (select flag_key from _cur);

  select count(*) into n_new from material_red_flag_log where resolved_at is null and notified_at is null;
  if n_new = 0 or not p_send then
    if not p_send then update material_red_flag_log set notified_at = now() where notified_at is null; end if;
    return n_new;
  end if;

  select array_agg(user_email) filter (where email), array_agg(user_email) filter (where in_app)
    into v_to, v_inapp from notification_settings where notification_type = 'material_red_flag';

  select string_agg('<tr><td style="padding:4px 8px;color:' || case when severity='critical' then '#b91c1c' else '#b45309' end || ';font-weight:bold">'
           || case when severity='critical' then 'RED FLAG' else 'Check' end || '</td><td style="padding:4px 8px">'
           || erp_html_escape(coalesce(order_number,'')) || '</td><td style="padding:4px 8px">' || erp_html_escape(coalesce(sku,''))
           || '</td><td style="padding:4px 8px">' || erp_html_escape(detail)
           || coalesce(' <b>Order by ' || to_char(order_by_date,'Mon DD') || '</b>','')
           || coalesce('<br><span style="color:#666">Ship date ' || to_char(required_ship_date,'Mon DD') || '</span>','') || '</td></tr>',
           '' order by (severity <> 'critical'), required_ship_date nulls last)
    into v_html from material_red_flag_log where resolved_at is null and notified_at is null;

  if v_to is not null and array_length(v_to,1) > 0 then
    perform erp_send_email(v_to,
      'Material RED FLAG: ' || n_new || ' new item' || case when n_new = 1 then '' else 's' end || ' need attention',
      '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>These material issues just came up on open orders. Each one stays red in the ERP until it is fixed.</p>'
      || '<table style="border-collapse:collapse;font-size:13px">' || v_html || '</table>'
      || '<p><a href="https://beyondgreen-erp.vercel.app/production/material-flags">Open Material Red Flags</a></p></div>',
      null, 'material_red_flags');
  end if;

  if v_inapp is not null then
    insert into notifications (recipient_email, sender_email, title, message, page, type, is_read, context_url)
    select r, 'system', 'Material RED FLAG',
           n_new || ' new material red flag' || case when n_new = 1 then '' else 's' end || ' on open orders', 'Material Red Flags',
           'material_red_flag', false, '/production/material-flags'
      from unnest(v_inapp) r;
  end if;

  update material_red_flag_log set notified_at = now() where resolved_at is null and notified_at is null;
  return n_new;
end $$;

-- Daily reminder of every RED FLAG still open (they don't go quiet until fixed)
create or replace function material_red_flags_daily()
returns void
language plpgsql security definer set search_path = public, pg_temp
as $$
declare v_html text; n int; v_to text[];
begin
  perform material_red_flags_sync(true);
  select count(*), string_agg('<li><b>' || erp_html_escape(coalesce(order_number,'')) || ' / ' || erp_html_escape(coalesce(sku,'')) || ':</b> '
           || erp_html_escape(detail) || coalesce(' <b>Order by ' || to_char(order_by_date,'Mon DD') || '</b>','')
           || ' <span style="color:#666">(open ' || (current_date - first_seen::date) || ' days)</span></li>', '' order by required_ship_date nulls last)
    into n, v_html from material_red_flag_log where resolved_at is null and severity = 'critical';
  if coalesce(n,0) = 0 then return; end if;
  select array_agg(user_email) into v_to from notification_settings where notification_type = 'material_red_flag' and email;
  if v_to is null then return; end if;
  perform erp_send_email(v_to, 'Material RED FLAGS still open: ' || n,
    '<div style="font-family:Arial,sans-serif;font-size:14px;color:#111"><p>These are still open and could delay material:</p><ul>' || v_html
    || '</ul><p><a href="https://beyondgreen-erp.vercel.app/production/material-flags">Open Material Red Flags</a></p></div>', null, 'material_red_flags');
end $$;

-- Mark a BOM complete / not complete from the app
create or replace function set_bom_complete(p_sku text, p_complete boolean, p_by text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update products set bom_complete = p_complete,
         bom_completed_at = case when p_complete then now() end,
         bom_completed_by = case when p_complete then p_by end
   where upper(sku) = upper(btrim(p_sku));
$$;
grant execute on function set_bom_complete(text, boolean, text) to authenticated;
grant execute on function material_red_flags_sync(boolean) to authenticated;

-- Baseline today's flags quietly (no email blast for old items); the daily reminder covers open critical ones.
select material_red_flags_sync(false);

-- New flags: check every 15 minutes. Open RED FLAGS: daily reminder 7:05am Pacific (15:05 UTC), Mon-Fri.
select cron.unschedule(jobid) from cron.job where jobname in ('material-red-flags-sync','material-red-flags-daily');
select cron.schedule('material-red-flags-sync', '*/15 * * * *', $$select public.material_red_flags_sync(true)$$);
select cron.schedule('material-red-flags-daily', '5 15 * * 1-5', $$select public.material_red_flags_daily()$$);

-- Nav entry
insert into boards (board_key, label, icon, nav_group, href, sort_order)
select '/production/material-flags', 'Material Red Flags', 'ti-flag', 'Production', '/production/material-flags', 2
where not exists (select 1 from boards where board_key = '/production/material-flags');
