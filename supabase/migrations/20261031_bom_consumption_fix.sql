-- BOM consumption fix (Oct 31 2026)
--
-- 1. One shared calculation, bom_requirements(), used by every production path.
--    Percentage rows are % of the MATERIAL WEIGHT OF THE STOCK UNIT BEING MADE:
--      qty (stock units) x pieces per stock unit x grams per piece.
--    The old copies multiplied by one piece (one bag) only, so a 45-bag pack used
--    1/45th of the resin it really did. Results are rounded (3 dp) instead of
--    being stored as long floats.
-- 2. bom_consume() writes the deduction (on-hand + inventory_movements) from it.
-- 3. consume_bom_for_production / wo_consume_bom / inventory_record_production /
--    straw_record_production now go through it. walmart_record_production is left
--    as is: Walmart SKUs are CASE units with piece-count BOMs only, which the old
--    and new math compute identically.
-- 4. wo_scrap_entries + wo_log_scrap()/wo_void_scrap(): start-up, shut-down and
--    production rejects logged against a work order, deducting material.
-- 5. bom_status() so the UI can flag products with no BOM / no material weight.
--
-- No existing inventory_movements rows are changed or deleted.

-- ─── 1. Shared requirement calculation ──────────────────────────────────────
create or replace function public.bom_requirements(p_product_id uuid, p_qty numeric)
returns table (
  component_sku text, component_id uuid, component_name text, component_uom text,
  role text, uom_type text, qty numeric, basis text, warning text
)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  f products;
  v_uom text; v_case_uom boolean; v_pcs_uom boolean;
  v_pieces numeric;      -- pieces (bags, straws, parts) in ONE stock unit of the finished good
  v_per_case numeric;    -- stock units in one shipping case
  v_wt numeric;          -- grams per piece
  v_lbs numeric;         -- total material weight being made, lbs
  b record; c products; v_raw numeric; v_cu text;
begin
  if p_qty is null or p_qty = 0 then return; end if;
  select * into f from products where id = p_product_id;
  if f.id is null then return; end if;

  v_uom := upper(btrim(coalesce(f.unit_of_measure, '')));
  v_case_uom := v_uom in ('CASE','CASES','CS','CTN','CARTON','CARTONS');
  v_pcs_uom  := v_uom in ('', 'PCS','PC','EA','EACH','PIECE','PIECES','UNIT','UNITS');

  v_pieces := case
    when v_pcs_uom then 1
    when v_case_uom then greatest(coalesce(nullif(f.pieces_per_pack,0),1) * coalesce(nullif(f.packs_per_case,0),1), 1)
    else coalesce(nullif(f.pieces_per_pack,0), 1)          -- packs, rolls, bags
  end;
  v_per_case := case
    when v_case_uom then 1
    when f.production_line = 'straw' and coalesce(f.straw_stock_per_case,0) > 0 then f.straw_stock_per_case
    when v_pcs_uom then coalesce(nullif(f.case_qty,0), nullif(coalesce(f.pieces_per_pack,1) * coalesce(f.packs_per_case,1),0), 1)
    else coalesce(nullif(f.packs_per_case,0), nullif(f.case_qty,0), 1)
  end;
  v_wt := coalesce(nullif(f.weight_per_unit_grams,0), nullif(f.straw_weight_g,0));
  v_lbs := p_qty * v_pieces * coalesce(v_wt,0) / 453.59237;

  for b in
    select pb.component_sku, pb.uom_type, pb.qty_value, pb.percentage, pb.is_case_level, pb.role
      from product_bom pb
     where upper(btrim(pb.finished_good_sku)) = upper(btrim(f.sku))
     order by case when pb.uom_type = 'percentage' then 0 else 1 end, pb.component_sku
  loop
    select * into c from products where upper(btrim(sku)) = upper(btrim(b.component_sku)) order by (sku = b.component_sku) desc limit 1;
    v_cu := upper(btrim(coalesce(c.unit_of_measure, '')));
    component_sku := b.component_sku; component_id := c.id; component_name := c.product_name;
    component_uom := coalesce(c.unit_of_measure, case when b.uom_type = 'percentage' then 'LBS' else 'PCS' end);
    role := b.role; uom_type := b.uom_type; warning := null;

    if b.uom_type = 'percentage' then
      v_raw := coalesce(nullif(b.qty_value,0), b.percentage, 0) / 100.0 * v_lbs;
      basis := coalesce(nullif(b.qty_value,0), b.percentage, 0)::text || '% of ' || round(v_lbs, 2)::text || ' lb material ('
               || p_qty::text || ' ' || coalesce(nullif(f.unit_of_measure,''),'units')
               || case when v_pieces <> 1 then ' x ' || v_pieces::text || ' pcs' else '' end
               || ' x ' || coalesce(v_wt::text, '?') || ' g)';
      if v_wt is null then
        v_raw := 0; warning := 'No weight per piece on ' || f.sku || ', so this material cannot be calculated';
      elsif v_cu in ('KG','KGS') then
        v_raw := v_raw / 2.20462262;
      elsif v_cu in ('G','GRAMS','GRAM') then
        v_raw := v_raw * 453.59237;
      elsif c.id is not null and v_cu not in ('LBS','LB','POUNDS','POUND','') then
        v_raw := 0; warning := b.component_sku || ' is stocked in ' || c.unit_of_measure || ', not lbs, so a % row cannot deduct it';
      end if;
    elsif coalesce(b.is_case_level, false) then
      v_raw := coalesce(b.qty_value,0) * p_qty / v_per_case;
      basis := coalesce(b.qty_value,0)::text || ' per case, ' || v_per_case::text || ' ' || coalesce(nullif(f.unit_of_measure,''),'units') || ' per case';
    else
      v_raw := coalesce(b.qty_value,0) * p_qty;
      basis := coalesce(b.qty_value,0)::text || ' per ' || coalesce(nullif(f.unit_of_measure,''),'unit');
    end if;

    if c.id is null then warning := coalesce(warning || '; ', '') || b.component_sku || ' is not in Inventory'; end if;
    -- 3 dp is plenty for lbs and pieces; keep tiny ink/additive amounts visible.
    qty := case when round(v_raw, 3) = 0 and v_raw <> 0 then round(v_raw, 6) else round(v_raw, 3) end;
    return next;
  end loop;
end $$;

-- ─── 2. Shared deduction ────────────────────────────────────────────────────
-- Deducts every BOM line for p_qty stock units of the product. p_negative stores
-- the movement qty as a negative number (the Walmart/straw convention); the work
-- order and manual-production paths store positive qty, which wo_unbook_fg reads.
create or replace function public.bom_consume(
  p_product_id uuid, p_qty numeric, p_ref_table text, p_ref_id uuid,
  p_by text, p_note text, p_negative boolean default false)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record; v_out jsonb := '[]'::jsonb;
begin
  if p_qty is null or p_qty <= 0 then return v_out; end if;
  for r in select * from public.bom_requirements(p_product_id, p_qty) loop
    if r.component_id is not null and r.qty > 0 then
      update products set on_hand_qty = round(coalesce(on_hand_qty,0) - r.qty, 6), updated_at = now() where id = r.component_id;
      insert into inventory_movements (product_id, sku, movement_type, qty, uom, ref_table, ref_id, note, created_by, created_at)
      values (r.component_id, r.component_sku, 'consume', case when p_negative then -r.qty else r.qty end, r.component_uom,
              p_ref_table, p_ref_id, p_note || ' · ' || r.basis, coalesce(p_by, 'production'), now());
    end if;
    v_out := v_out || jsonb_build_object('sku', r.component_sku, 'name', r.component_name, 'qty', r.qty,
               'uom', r.component_uom, 'basis', r.basis, 'warning', r.warning,
               'deducted', r.component_id is not null and r.qty > 0);
  end loop;
  return v_out;
end $$;

-- ─── 3. Callers ─────────────────────────────────────────────────────────────
create or replace function public.consume_bom_for_production(p_product_id uuid, p_qty numeric, p_by text default 'production')
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.bom_consume(p_product_id, p_qty, 'production', p_product_id, p_by,
    'Consumed building ' || p_qty || ' x ' || coalesce((select sku from products where id = p_product_id), '?'), false);
end $$;

create or replace function public.wo_consume_bom(p_wo_id uuid, p_product_id uuid, p_qty numeric, p_by text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text;
begin
  select coalesce(wo_code, 'WO-' || wo_number::text) into v_code from work_orders where id = p_wo_id;
  perform public.bom_consume(p_product_id, p_qty, 'work_orders', p_wo_id, p_by,
    'Used building ' || p_qty || ' x ' || coalesce((select sku from products where id = p_product_id), '?')
      || ' on ' || coalesce(v_code, 'work order'), false);
end $$;

create or replace function public.inventory_record_production(p_product_id uuid, p_qty numeric, p_lot text default null, p_note text default null, p_line_pull boolean default false)
returns json
language plpgsql security definer set search_path = public as $$
declare v products; v_who text; v_lot text; v_mid uuid; v_onhand numeric; v_used jsonb := '[]'::jsonb;
begin
  if not erp_can_write_now() then raise exception 'Production can only be recorded from the work network for this account'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  select * into v from products where id = p_product_id for update;
  if v.id is null then raise exception 'Product not found'; end if;
  v_who := coalesce(erp_current_email(), 'unknown');
  v_lot := coalesce(nullif(btrim(coalesce(p_lot,'')),''), v.sku || '-' || to_char(current_date, 'YYMMDD'));
  update products set on_hand_qty = coalesce(on_hand_qty,0) + p_qty, qty_updated_at = now(), qty_updated_by = v_who, qty_updated_source = 'production', updated_at = now()
  where id = v.id returning on_hand_qty into v_onhand;
  insert into inventory_movements (product_id, sku, movement_type, qty, uom, lot_number, ref_table, note, created_by, line_pull)
  values (v.id, v.sku, 'produce', p_qty, v.unit_of_measure, v_lot, 'manual_production',
    coalesce(nullif(btrim(coalesce(p_note,'')),''), 'Production recorded without a work order')
      || case when coalesce(p_line_pull,false) then ' · Pulled from the production line before the daily sheet was posted' else '' end,
    v_who, coalesce(p_line_pull,false))
  returning id into v_mid;
  begin
    insert into lot_codes (lot_number, sku, product_name, qty_produced, qty_remaining, quantity, produced_date, status, lot_type, notes)
    values (v_lot, v.sku, v.product_name, p_qty, p_qty, p_qty, current_date, 'Active', 'Finished Goods', coalesce(p_note, 'Recorded at shipping'))
    on conflict do nothing;
  exception when others then null; end;
  begin
    v_used := public.bom_consume(v.id, p_qty, 'manual_production', v_mid, v_who,
                'Used making ' || p_qty || ' ' || coalesce(v.unit_of_measure, '') || ' x ' || v.sku || ' (production entry)', false);
  exception when others then raise warning 'BOM consume skipped: %', sqlerrm; end;
  return json_build_object('ok', true, 'sku', v.sku, 'lot', v_lot, 'on_hand', v_onhand, 'movement_id', v_mid,
                           'line_pull', coalesce(p_line_pull,false), 'consumed', v_used);
end $$;

create or replace function public.straw_record_production(p_sku text, p_qty numeric, p_date date default current_date, p_wo uuid default null, p_note text default null)
returns json
language plpgsql security definer set search_path = public as $$
declare v products; v_who text := coalesce(erp_current_email(),'unknown'); v_wo uuid := p_wo; v_id uuid; v_lot text;
        n int := 0; v_f numeric; v_used jsonb;
begin
  if not erp_can_edit_board('/production/straw') then raise exception 'You do not have edit access to Straw Production'; end if;
  if not erp_can_write_now() then raise exception 'Production can only be recorded from the work network for this account'; end if;
  if not (upper(coalesce(p_sku,'')) = any(straw_skus())) then raise exception 'Pick a straw SKU'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Enter the number of cases made (more than zero)'; end if;
  if p_qty > 2000 then raise exception '% cases in one entry looks like a typo — enter it in smaller entries or ask the office', p_qty; end if;
  if p_date is null or p_date > current_date + 1 or p_date < current_date - 14 then raise exception 'Production date must be within the last 14 days'; end if;
  select * into v from products where upper(sku) = upper(p_sku) for update;
  v_f := v.straw_stock_per_case;
  if coalesce(v_f,0) <= 0 then raise exception 'Set how many % are in one case for % first (Straw board → finished goods → case size)', coalesce(v.unit_of_measure,'units'), v.sku; end if;
  if v_wo is null then v_wo := straw_pick_wo(v.sku); end if;
  v_lot := 'ST-' || v.sku || '-' || to_char(p_date,'YYMMDD');
  insert into straw_production_entries (work_order_id, production_date, sku, qty, lot_number, note, entered_by)
  values (v_wo, p_date, upper(v.sku), p_qty, v_lot, nullif(btrim(coalesce(p_note,'')),''), v_who) returning id into v_id;
  insert into inventory_movements (product_id, sku, movement_type, qty, uom, lot_number, ref_table, ref_id, note, created_by)
  values (v.id, v.sku, 'produce', round(p_qty * v_f, 4), v.unit_of_measure, v_lot, 'straw_production_entries', v_id,
          'Straw production ' || to_char(p_date,'Mon DD') || ' · ' || p_qty || ' case(s)', v_who);
  -- BOM out through the shared calculation, in stock units (cases x stock units per case).
  v_used := public.bom_consume(v.id, round(p_qty * v_f, 6), 'straw_production_entries', v_id, v_who,
              'Used making ' || p_qty || ' case(s) x ' || v.sku || ' (straw)', true);
  select count(*) into n from jsonb_array_elements(v_used) e where (e->>'deducted')::boolean;
  begin
    insert into lot_codes (lot_number, sku, product_name, qty_produced, qty_remaining, quantity, produced_date, status, lot_type, work_order_id, notes)
    values (v_lot, v.sku, v.product_name, p_qty, p_qty, p_qty, p_date, 'Active', 'Finished Goods', v_wo, 'Straw daily production (cases)')
    on conflict do nothing;
  exception when others then null; end;
  insert into straw_activity (actor, action, sku, qty, ref_id, work_order_id, detail) values (v_who, 'logged', v.sku, p_qty, v_id, v_wo, p_note);
  perform straw_wo_sync(v_wo);
  return json_build_object('ok', true, 'id', v_id, 'sku', v.sku, 'qty', p_qty, 'components', n, 'work_order_id', v_wo, 'lot', v_lot);
end $$;

-- ─── 4. Scrap / rejects against a work order ────────────────────────────────
create table if not exists public.wo_scrap_entries (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  scrap_type text not null check (scrap_type in ('startup','shutdown','reject')),
  basis text not null check (basis in ('material','finished_good')),
  sku text not null,
  lbs numeric not null check (lbs > 0),
  note text,
  entered_by text,
  created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by text, void_reason text
);
create index if not exists wo_scrap_entries_wo_idx on public.wo_scrap_entries(work_order_id);
alter table public.wo_scrap_entries enable row level security;
drop policy if exists wo_scrap_read on public.wo_scrap_entries;
create policy wo_scrap_read on public.wo_scrap_entries for select to authenticated using (true);
-- Writes only through the functions below, which also post the inventory.

create or replace function public.wo_log_scrap(p_wo_id uuid, p_type text, p_sku text, p_lbs numeric, p_note text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare w work_orders; fg products; m products; v_who text := coalesce(erp_current_email(), 'unknown');
        v_id uuid; v_basis text; v_code text; v_label text; b record; v_out jsonb := '[]'::jsonb; v_q numeric; v_total_pct numeric;
begin
  if not erp_can_write_now() then raise exception 'Production can only be recorded from the work network for this account'; end if;
  if p_type not in ('startup','shutdown','reject') then raise exception 'Pick start-up, shut-down or reject'; end if;
  if p_lbs is null or p_lbs <= 0 then raise exception 'Enter the scrap weight in lbs (more than zero)'; end if;
  if p_lbs > 5000 then raise exception '% lbs of scrap in one entry looks like a typo — split it or ask the office', p_lbs; end if;
  select * into w from work_orders where id = p_wo_id;
  if w.id is null then raise exception 'Work order not found'; end if;
  v_code := coalesce(w.wo_code, 'WO-' || w.wo_number::text);
  v_label := case p_type when 'startup' then 'Start-up scrap' when 'shutdown' then 'Shut-down scrap' else 'Production reject' end;
  if w.product_id is not null then select * into fg from products where id = w.product_id; end if;

  if fg.id is not null and upper(btrim(p_sku)) = upper(btrim(fg.sku)) then
    -- Finished-good scrap: split the weight across the BOM's material (%) rows.
    v_basis := 'finished_good';
    select coalesce(sum(coalesce(nullif(qty_value,0), percentage, 0)),0) into v_total_pct
      from product_bom where upper(btrim(finished_good_sku)) = upper(btrim(fg.sku)) and uom_type = 'percentage';
    if v_total_pct <= 0 then raise exception '% has no material (%%) rows on its BOM, so finished-good scrap cannot be split into materials. Log it against the material instead.', fg.sku; end if;
    insert into wo_scrap_entries (work_order_id, scrap_type, basis, sku, lbs, note, entered_by)
    values (w.id, p_type, v_basis, fg.sku, round(p_lbs,3), nullif(btrim(coalesce(p_note,'')),''), v_who) returning id into v_id;
    for b in select pb.component_sku, coalesce(nullif(pb.qty_value,0), pb.percentage, 0) pct, c.id cid, c.product_name cname, c.unit_of_measure cu
               from product_bom pb left join products c on upper(btrim(c.sku)) = upper(btrim(pb.component_sku))
              where upper(btrim(pb.finished_good_sku)) = upper(btrim(fg.sku)) and pb.uom_type = 'percentage' loop
      v_q := round(p_lbs * b.pct / 100.0, 3);
      if v_q = 0 and b.pct > 0 then v_q := round(p_lbs * b.pct / 100.0, 6); end if;
      if b.cid is not null and v_q > 0 then
        update products set on_hand_qty = round(coalesce(on_hand_qty,0) - v_q, 6), updated_at = now() where id = b.cid;
        insert into inventory_movements (product_id, sku, movement_type, qty, uom, ref_table, ref_id, note, created_by)
        values (b.cid, b.component_sku, 'scrap', v_q, coalesce(b.cu,'LBS'), 'wo_scrap_entries', v_id,
                v_label || ' on ' || v_code || ': ' || round(p_lbs,3) || ' lb of ' || fg.sku || ' x ' || b.pct || '%', v_who);
      end if;
      v_out := v_out || jsonb_build_object('sku', b.component_sku, 'name', b.cname, 'qty', v_q, 'uom', coalesce(b.cu,'LBS'));
    end loop;
  else
    -- Material scrap: deduct the weight straight from that material.
    v_basis := 'material';
    select * into m from products where upper(btrim(sku)) = upper(btrim(p_sku)) limit 1;
    if m.id is null then raise exception '% is not in Inventory', p_sku; end if;
    if upper(coalesce(m.unit_of_measure,'')) not in ('LBS','LB','POUNDS','POUND') then
      raise exception '% is stocked in %, not lbs. Scrap is logged in lbs against a resin/colour/additive or the finished good.', m.sku, coalesce(m.unit_of_measure,'?');
    end if;
    insert into wo_scrap_entries (work_order_id, scrap_type, basis, sku, lbs, note, entered_by)
    values (w.id, p_type, v_basis, m.sku, round(p_lbs,3), nullif(btrim(coalesce(p_note,'')),''), v_who) returning id into v_id;
    update products set on_hand_qty = round(coalesce(on_hand_qty,0) - round(p_lbs,3), 6), updated_at = now() where id = m.id;
    insert into inventory_movements (product_id, sku, movement_type, qty, uom, ref_table, ref_id, note, created_by)
    values (m.id, m.sku, 'scrap', round(p_lbs,3), m.unit_of_measure, 'wo_scrap_entries', v_id,
            v_label || ' on ' || v_code || coalesce(' · ' || nullif(btrim(coalesce(p_note,'')),''), ''), v_who);
    v_out := jsonb_build_array(jsonb_build_object('sku', m.sku, 'name', m.product_name, 'qty', round(p_lbs,3), 'uom', m.unit_of_measure));
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'basis', v_basis, 'deducted', v_out);
end $$;

create or replace function public.wo_void_scrap(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare e wo_scrap_entries; r record; v_who text := coalesce(erp_current_email(), 'unknown');
begin
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'Give a reason for removing this scrap entry'; end if;
  select * into e from wo_scrap_entries where id = p_id for update;
  if e.id is null then raise exception 'Scrap entry not found'; end if;
  if e.voided_at is not null then raise exception 'This scrap entry was already removed'; end if;
  for r in select * from inventory_movements where ref_table = 'wo_scrap_entries' and ref_id = e.id and movement_type = 'scrap' loop
    update products set on_hand_qty = round(coalesce(on_hand_qty,0) + abs(r.qty), 6), updated_at = now() where id = r.product_id;
    insert into inventory_movements (product_id, sku, movement_type, qty, uom, ref_table, ref_id, note, created_by)
    values (r.product_id, r.sku, 'adjust', abs(r.qty), r.uom, 'wo_scrap_entries', e.id, 'Scrap entry removed: ' || p_reason, v_who);
  end loop;
  update wo_scrap_entries set voided_at = now(), voided_by = v_who, void_reason = p_reason where id = e.id;
  return jsonb_build_object('ok', true);
end $$;

-- ─── 5. BOM status for "No BOM" flags ───────────────────────────────────────
-- 'none'        no product_bom rows at all
-- 'no_weight'   has material (%) rows but no weight per piece, so nothing is deducted for them
-- 'no_material' only piece-count rows (packaging / assembled kits): OK for assembled items
-- 'ok'
create or replace function public.bom_status(p_sku text)
returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when not exists (select 1 from product_bom b where upper(btrim(b.finished_good_sku)) = upper(btrim(p_sku))) then 'none'
    when exists (select 1 from product_bom b where upper(btrim(b.finished_good_sku)) = upper(btrim(p_sku)) and b.uom_type = 'percentage')
         and not exists (select 1 from products p where upper(btrim(p.sku)) = upper(btrim(p_sku))
                           and coalesce(nullif(p.weight_per_unit_grams,0), nullif(p.straw_weight_g,0)) is not null) then 'no_weight'
    when not exists (select 1 from product_bom b where upper(btrim(b.finished_good_sku)) = upper(btrim(p_sku)) and b.uom_type = 'percentage') then 'no_material'
    else 'ok' end
$$;

grant execute on function public.bom_requirements(uuid, numeric) to authenticated;
grant execute on function public.bom_status(text) to authenticated;
grant execute on function public.wo_log_scrap(uuid, text, text, numeric, text) to authenticated;
grant execute on function public.wo_void_scrap(uuid, text) to authenticated;
revoke execute on function public.bom_consume(uuid, numeric, text, uuid, text, text, boolean) from public, anon, authenticated;
