-- Line pulls: product shipping takes straight off a run that is still on the line.
-- Shipping records it (so the shipment can go), flagged line_pull. When the daily
-- production sheet is posted, the sheet total is reduced by the open line pulls so
-- the same packs are not counted twice, and the pulls are marked matched.

alter table inventory_movements
  add column if not exists line_pull boolean not null default false,
  add column if not exists reconciled_at timestamptz,
  add column if not exists reconciled_by text,
  add column if not exists reconciled_movement_id uuid;

create index if not exists inventory_movements_open_line_pulls
  on inventory_movements (product_id) where line_pull and reconciled_at is null;

drop function if exists public.inventory_record_production(uuid, numeric, text, text);

create or replace function public.inventory_record_production(p_product_id uuid, p_qty numeric, p_lot text default null, p_note text default null, p_line_pull boolean default false)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v products; v_who text; v_lot text; v_mid uuid; v_onhand numeric;
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
  begin perform consume_bom_for_production(v.id, p_qty, v_who); exception when others then raise warning 'BOM consume skipped: %', sqlerrm; end;
  return json_build_object('ok', true, 'sku', v.sku, 'lot', v_lot, 'on_hand', v_onhand, 'movement_id', v_mid, 'line_pull', coalesce(p_line_pull,false));
end $function$;

create or replace function public.inventory_post_daily_production(p_product_id uuid, p_sheet_qty numeric, p_pull_ids uuid[] default '{}', p_note text default null)
 returns json language plpgsql security definer set search_path to 'public'
as $function$
declare v products; v_who text; v_pulls numeric := 0; v_n int := 0; v_net numeric; v_mid uuid; v_onhand numeric;
begin
  if not erp_can_write_now() then raise exception 'Production can only be recorded from the work network for this account'; end if;
  if p_sheet_qty is null or p_sheet_qty <= 0 then raise exception 'Sheet quantity must be greater than zero'; end if;
  select * into v from products where id = p_product_id for update;
  if v.id is null then raise exception 'Product not found'; end if;
  v_who := coalesce(erp_current_email(), 'unknown');
  select coalesce(sum(qty),0), count(*) into v_pulls, v_n from inventory_movements
   where id = any(coalesce(p_pull_ids,'{}')) and product_id = v.id and line_pull and reconciled_at is null;
  if v_n <> coalesce(array_length(p_pull_ids,1),0) then raise exception 'One or more line pulls were already matched to a sheet. Reload and try again.'; end if;
  if v_pulls > p_sheet_qty then raise exception 'Line pulls selected (%) are more than the sheet total (%). Untick the pulls that belong to a different day''s sheet.', v_pulls, p_sheet_qty; end if;
  v_net := p_sheet_qty - v_pulls;
  v_onhand := v.on_hand_qty;
  insert into inventory_movements (product_id, sku, movement_type, qty, uom, ref_table, note, created_by)
  values (v.id, v.sku, 'produce', v_net, v.unit_of_measure, 'manual',
    'Daily production sheet ' || p_sheet_qty || case when v_pulls > 0 then ' less ' || v_pulls || ' already pulled from the line at shipping = ' || v_net || ' posted' else '' end
      || coalesce(' · ' || nullif(btrim(coalesce(p_note,'')),''), ''),
    v_who)
  returning id into v_mid;
  if v_net > 0 then
    update products set on_hand_qty = coalesce(on_hand_qty,0) + v_net, qty_updated_at = now(), qty_updated_by = v_who, qty_updated_source = 'production', updated_at = now()
    where id = v.id returning on_hand_qty into v_onhand;
  end if;
  update inventory_movements set reconciled_at = now(), reconciled_by = v_who, reconciled_movement_id = v_mid
   where id = any(coalesce(p_pull_ids,'{}'));
  return json_build_object('ok', true, 'sku', v.sku, 'sheet', p_sheet_qty, 'pulls', v_pulls, 'posted', v_net, 'on_hand', v_onhand, 'movement_id', v_mid);
end $function$;

grant execute on function public.inventory_record_production(uuid, numeric, text, text, boolean) to authenticated;
grant execute on function public.inventory_post_daily_production(uuid, numeric, uuid[], text) to authenticated;
