-- Daily production sheet posting (Add to stock with open line pulls) now deducts the BOM
-- for the net quantity it posts, using the shared bom_consume(). Line pulls already deduct
-- their own share, so only v_net is consumed here.
create or replace function public.inventory_post_daily_production(p_product_id uuid, p_sheet_qty numeric, p_pull_ids uuid[] default '{}'::uuid[], p_note text default null::text)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v products; v_who text; v_pulls numeric := 0; v_n int := 0; v_net numeric; v_mid uuid; v_onhand numeric; v_used jsonb := '[]'::jsonb;
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
    v_used := public.bom_consume(v.id, v_net, 'manual_production', v_mid, v_who,
      'Consumed building ' || v_net || ' x ' || v.sku || ' (daily production sheet)', false);
  end if;
  update inventory_movements set reconciled_at = now(), reconciled_by = v_who, reconciled_movement_id = v_mid
   where id = any(coalesce(p_pull_ids,'{}'));
  return json_build_object('ok', true, 'sku', v.sku, 'sheet', p_sheet_qty, 'pulls', v_pulls, 'posted', v_net, 'on_hand', v_onhand, 'movement_id', v_mid, 'consumed', v_used);
end $function$;
