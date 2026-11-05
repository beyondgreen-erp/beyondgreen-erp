-- Walmart pallet planner: keep like SKUs together.
--
-- 1. Mixed ("floor") pallets in walmart_pallet_replan used to write a SKU's whole layers and its
--    short top layer as two separate rows (e.g. "F24 40" ... "F24 2"), so the build sheet showed the
--    same SKU twice with other SKUs in between. Each SKU is now one block per pallet.
-- 2. walmart_pallet_fit (used when the team sets a pallet count) used to cut the whole stack by
--    height, which spread every SKU across the cut points and made a mixed pallet at every SKU
--    boundary. It now gives each SKU its own pallets whenever the count allows (evenly split, the
--    short layer on top of the last one) and only shares a pallet when the count forces it, under
--    the 54" load cap (60" including the 6" deck). The old even cut is kept as
--    walmart_pallet_fit_seq and used only when the cap cannot be met.
--
-- Pallet counts per PO are unchanged (the target is honoured exactly, and the natural count of
-- the auto plan is unchanged), and total weight is unchanged (same SRPs, same pallet count).

create or replace function public.walmart_pallet_fit_seq(p_order uuid, p_n integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare l record; s record; v_total numeric := 0; v_t numeric; v_c numeric := 0; v_k int; v_mid numeric; i int; j int;
  v_pid uuid; v_seq int; b record; f record; v_max numeric := 0;
begin
  if p_n is null or p_n < 1 then return json_build_object('ok', false, 'reason', 'no target'); end if;
  delete from walmart_build_pallets where order_id = p_order;
  create temp table if not exists _wm_layers (n serial, sku text, q numeric, per_layer int, ti int, hi int, layer_h numeric, lb numeric, partial boolean, pallet int) on commit drop;
  delete from _wm_layers;
  for l in select upper(btrim(part_number)) sku, sum(coalesce(qty,0)) q from walmart_board_lines
           where order_id = p_order and coalesce(qty,0) > 0 group by 1 order by 1 loop
    select * into s from wm_pallet_spec(l.sku);
    if s.sku is null or coalesce(s.per_layer,0) <= 0 then
      insert into _wm_layers (sku, q, per_layer, ti, hi, layer_h, lb, partial) values (l.sku, l.q, null, null, null, 4, coalesce(s.srp_lb,0), true);
      continue;
    end if;
    for i in 1..floor(l.q / s.per_layer)::int loop
      insert into _wm_layers (sku, q, per_layer, ti, hi, layer_h, lb, partial) values (l.sku, s.per_layer, s.per_layer, s.ti, s.hi, s.layer_h, s.srp_lb, false);
    end loop;
    if l.q - floor(l.q / s.per_layer) * s.per_layer > 0 then
      insert into _wm_layers (sku, q, per_layer, ti, hi, layer_h, lb, partial)
      values (l.sku, l.q - floor(l.q / s.per_layer) * s.per_layer, s.per_layer, s.ti, s.hi, s.layer_h, s.srp_lb, true);
    end if;
  end loop;
  select coalesce(sum(layer_h),0) into v_total from _wm_layers;
  if v_total = 0 then return json_build_object('ok', true, 'pallets', 0); end if;
  select count(*) into j from _wm_layers;
  v_k := 1; v_c := 0; i := 0;
  for f in select n, layer_h from _wm_layers order by n loop
    i := i + 1;
    if v_c > 0 and v_k < p_n and (
         (j - i + 1) <= (p_n - v_k)
         or v_c + f.layer_h / 2 > (v_total) / (p_n - v_k + 1)) then
      v_total := v_total - v_c; v_k := v_k + 1; v_c := 0;
    end if;
    update _wm_layers set pallet = v_k where n = f.n;
    v_c := v_c + f.layer_h;
  end loop;
  for b in select pallet, sum(q) q, sum(layer_h) h, sum(q*lb) lb, count(distinct sku) ns from _wm_layers group by pallet order by pallet loop
    insert into walmart_build_pallets (order_id, pallet_no, kind, srps, height_in, cbm, weight_lb)
    values (p_order, b.pallet, case when b.ns = 1 then 'full' else 'floor' end, b.q, round(b.h,1), wm_pallet_cbm(b.h), round(b.lb + 50, 1))
    returning id into v_pid;
    v_max := greatest(v_max, b.h);
    v_seq := 0;
    for f in select sku, max(per_layer) per_layer, max(ti) ti, max(hi) hi, max(layer_h) layer_h,
                    count(*) filter (where not partial) fl, coalesce(sum(q) filter (where partial),0) pq, sum(q) q, sum(q*lb) wlb
             from _wm_layers where pallet = b.pallet group by sku
             order by (coalesce(sum(q) filter (where partial),0) > 0), sum(q*lb) desc, sku loop
      v_seq := v_seq + 1;
      insert into walmart_build_pallet_items (pallet_id, order_id, seq, sku, srps, per_layer, ti, hi, full_layers, partial, layer_h)
      values (v_pid, p_order, v_seq, f.sku, f.q, f.per_layer, f.ti, f.hi, f.fl, f.pq, f.layer_h);
    end loop;
  end loop;
  return json_build_object('ok', true, 'pallets', p_n, 'max_height_in', round(v_max,1), 'method', 'even cut');
end $function$;


create or replace function public.walmart_pallet_fit(p_order uuid, p_n integer)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cap constant numeric := 54;   -- tallest load the team builds: 60" including the 6" deck
  l record; s record; r record;
  v_cnt int; v_m int; v_d int; v_s int; v_extra int; v_pick text; v_bin int; v_bins numeric[] := '{}';
  v_free numeric; v_lay int; v_base int; v_rem int; v_fl int; v_pq numeric; v_srps numeric; v_ph numeric;
  v_no int := 0; v_pid uuid; v_seq int; i int; j int; v_max numeric := 0; v_mixed int := 0;
begin
  if p_n is null or p_n < 1 then return json_build_object('ok', false, 'reason', 'no target'); end if;
  delete from walmart_build_pallets where order_id = p_order;

  -- one row per SKU: layers (lay = whole layers + 1 if there is a short top layer), cap = most layers
  -- that fit under 54", d = pallets of its own, shr = layers it puts on a shared pallet (bin)
  create temp table if not exists _wm_sku (
    sku text primary key, q numeric, per_layer int, ti int, hi int, layer_h numeric, lb numeric,
    fl int, pq numeric, lay int, cap int, d int, rem int, bin int, shr int
  ) on commit drop;
  delete from _wm_sku;
  for l in select upper(btrim(part_number)) sku, sum(coalesce(qty,0)) q from walmart_board_lines
           where order_id = p_order and coalesce(qty,0) > 0 group by 1 order by 1 loop
    select * into s from wm_pallet_spec(l.sku);
    if s.sku is null or coalesce(s.per_layer,0) <= 0 then
      -- no pallet arrangement on file: the whole quantity is one 4" block
      insert into _wm_sku (sku,q,per_layer,ti,hi,layer_h,lb,fl,pq,lay,cap) values (l.sku, l.q, null, null, null, 4, coalesce(s.srp_lb,0), 0, l.q, 1, 1);
    else
      v_fl := floor(l.q / s.per_layer); v_pq := l.q - v_fl * s.per_layer;
      insert into _wm_sku (sku,q,per_layer,ti,hi,layer_h,lb,fl,pq,lay,cap)
      values (l.sku, l.q, s.per_layer, s.ti, s.hi, s.layer_h, s.srp_lb, v_fl, v_pq, v_fl + case when v_pq > 0 then 1 else 0 end,
              greatest(coalesce(s.layers,1), floor(v_cap / s.layer_h)::int));
    end if;
  end loop;
  select count(*) into v_cnt from _wm_sku;
  if v_cnt = 0 then return json_build_object('ok', true, 'pallets', 0); end if;

  -- every SKU on its own pallets if the count allows
  update _wm_sku set d = ceil(lay::numeric / cap)::int, rem = 0, bin = null, shr = 0;
  select sum(d) into v_m from _wm_sku;

  if v_m > p_n then
    -- the count forces sharing: each SKU keeps its full-height pallets, the leftovers share pallets
    update _wm_sku set d = floor(lay::numeric / cap)::int;
    update _wm_sku set rem = lay - d * cap;
    for r in select * from _wm_sku where rem > 0 order by rem * layer_h desc, sku loop
      v_bin := null;
      for i in 1..coalesce(array_length(v_bins,1),0) loop
        if v_bins[i] + r.rem * r.layer_h <= v_cap then v_bin := i; exit; end if;
      end loop;
      if v_bin is null then v_bins := v_bins || (r.rem * r.layer_h); v_bin := array_length(v_bins,1);
      else v_bins[v_bin] := v_bins[v_bin] + r.rem * r.layer_h; end if;
      update _wm_sku set bin = v_bin, shr = rem where sku = r.sku;
    end loop;
    select coalesce(sum(d),0) into v_d from _wm_sku;
    v_s := coalesce(array_length(v_bins,1),0);
    if v_d + v_s > p_n then
      -- cannot be done under the height cap in this many pallets: fall back to the even cut
      return walmart_pallet_fit_seq(p_order, p_n);
    end if;
    v_extra := p_n - v_d - v_s;
    -- spare pallets go to un-mixing first: the biggest leftover on a shared pallet gets its own
    while v_extra > 0 loop
      v_pick := null;
      select a.sku into v_pick from _wm_sku a
       where a.bin is not null and (select count(*) from _wm_sku b where b.bin = a.bin) > 1
       order by a.rem * a.layer_h desc, a.sku limit 1;
      exit when v_pick is null;
      v_bins := v_bins || 0::numeric;
      update _wm_sku set bin = array_length(v_bins,1) where sku = v_pick;
      v_extra := v_extra - 1;
    end loop;
    -- a leftover alone on a pallet is just another pallet of its own
    update _wm_sku a set d = d + 1, rem = 0, bin = null, shr = 0
     where a.bin is not null and (select count(*) from _wm_sku b where b.bin = a.bin) = 1;
  else
    v_extra := p_n - v_m;
  end if;

  -- any spare pallets left: split the SKU whose pallets are tallest on average
  while v_extra > 0 loop
    v_pick := null;
    select sku into v_pick from _wm_sku where d + case when bin is null then 0 else 1 end < lay
     order by lay * layer_h / (d + case when bin is null then 0 else 1 end) desc, sku limit 1;
    exit when v_pick is null;
    update _wm_sku set d = d + 1 where sku = v_pick;
    v_extra := v_extra - 1;
  end loop;

  -- layers on each shared pallet: grow each leftover toward the SKU's average pallet, within the
  -- pallet's free height, so a SKU's own pallets and its share are about the same height
  for r in select * from _wm_sku where bin is not null order by bin, rem * layer_h desc, sku loop
    select v_cap - coalesce(sum(shr * layer_h),0) into v_free from _wm_sku where bin = r.bin;
    v_lay := round(r.lay::numeric / (r.d + 1))::int;
    v_lay := least(v_lay, r.lay - r.d, r.shr + floor(v_free / r.layer_h)::int);
    v_lay := greatest(v_lay, r.lay - r.d * r.cap, 1);
    update _wm_sku set shr = v_lay where sku = r.sku;
  end loop;

  -- pallets of their own, SKU by SKU, evenly split; the short top layer goes on the last one
  -- (or on the shared pallet when the SKU has one)
  for r in select * from _wm_sku where d > 0 order by sku loop
    v_lay := r.lay - r.shr;
    v_base := v_lay / r.d; v_rem := v_lay - v_base * r.d;
    for j in 1..r.d loop
      i := v_base + case when j <= v_rem then 1 else 0 end;
      if r.bin is null and j = r.d and r.pq > 0 then v_fl := i - 1; v_pq := r.pq; else v_fl := i; v_pq := 0; end if;
      v_srps := v_fl * coalesce(r.per_layer,0) + v_pq;
      v_ph := i * r.layer_h;
      v_no := v_no + 1; v_max := greatest(v_max, v_ph);
      insert into walmart_build_pallets (order_id, pallet_no, kind, srps, height_in, cbm, weight_lb)
      values (p_order, v_no, 'full', v_srps, round(v_ph,1), wm_pallet_cbm(v_ph), round(v_srps * r.lb + 50, 1)) returning id into v_pid;
      insert into walmart_build_pallet_items (pallet_id, order_id, seq, sku, srps, per_layer, ti, hi, full_layers, partial, layer_h)
      values (v_pid, p_order, 1, r.sku, v_srps, r.per_layer, r.ti, r.hi, v_fl, v_pq, r.layer_h);
    end loop;
  end loop;

  -- shared pallets: one block per SKU, heaviest at the bottom
  for v_bin in select distinct bin from _wm_sku where bin is not null order by bin loop
    select sum(case when pq > 0 then (shr - 1) * coalesce(per_layer,0) + pq else shr * coalesce(per_layer,0) end),
           sum(shr * layer_h),
           sum((case when pq > 0 then (shr - 1) * coalesce(per_layer,0) + pq else shr * coalesce(per_layer,0) end) * lb)
      into v_srps, v_ph, v_free from _wm_sku where bin = v_bin;
    v_no := v_no + 1; v_mixed := v_mixed + 1; v_max := greatest(v_max, v_ph);
    insert into walmart_build_pallets (order_id, pallet_no, kind, srps, height_in, cbm, weight_lb)
    values (p_order, v_no, 'floor', v_srps, round(v_ph,1), wm_pallet_cbm(v_ph), round(v_free + 50, 1)) returning id into v_pid;
    v_seq := 0;
    for r in select *, case when pq > 0 then (shr - 1) * coalesce(per_layer,0) + pq else shr * coalesce(per_layer,0) end bs
             from _wm_sku where bin = v_bin
             order by (case when pq > 0 then (shr - 1) * coalesce(per_layer,0) + pq else shr * coalesce(per_layer,0) end) * lb desc, sku loop
      v_seq := v_seq + 1;
      insert into walmart_build_pallet_items (pallet_id, order_id, seq, sku, srps, per_layer, ti, hi, full_layers, partial, layer_h)
      values (v_pid, p_order, v_seq, r.sku, r.bs, r.per_layer, r.ti, r.hi, case when r.pq > 0 then r.shr - 1 else r.shr end, r.pq, r.layer_h);
    end loop;
  end loop;

  return json_build_object('ok', true, 'pallets', v_no, 'mixed', v_mixed, 'max_height_in', round(v_max,1), 'method', 'grouped');
end $function$;


create or replace function public.walmart_pallet_replan(p_order uuid, p_force boolean DEFAULT false)
 returns json
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare o walmart_board_orders; l record; s record; v_no int := 0; v_pid uuid; v_progress int;
  v_floor jsonb := '[]'; f record; v_h numeric; v_full int; v_rem numeric; v_cap constant numeric := 54;
  v_bins numeric[] := '{}'; v_bin int; i int; v_seq int; b int;
begin
  select * into o from walmart_board_orders where id = p_order;
  if o.id is null then return json_build_object('ok', false); end if;
  select count(*) into v_progress from walmart_build_pallets where order_id = o.id and status <> 'planned';
  if v_progress > 0 and not p_force then
    update walmart_board_orders set plan_stale = (
      select coalesce(sum(qty),0) from walmart_board_lines where order_id = o.id and coalesce(qty,0) > 0)
      <> (select coalesce(sum(srps),0) from walmart_build_pallets where order_id = o.id) where id = o.id;
    return json_build_object('ok', false, 'reason', 'in progress');
  end if;
  delete from walmart_build_pallets where order_id = o.id and (status = 'planned' or p_force);

  for l in select upper(btrim(part_number)) sku, sum(coalesce(qty,0)) q from walmart_board_lines
           where order_id = o.id and coalesce(qty,0) > 0 group by 1 order by 1 loop
    select * into s from wm_pallet_spec(l.sku);
    if s.sku is null or coalesce(s.per_pallet,0) <= 0 or s.per_layer is null then
      v_floor := v_floor || jsonb_build_object('sku', l.sku, 'q', l.q, 'per_layer', null, 'ti', null, 'hi', null, 'layer_h', 4, 'lb', coalesce(s.srp_lb,0), 'h', 4);
      continue;
    end if;
    v_full := floor(l.q / s.per_pallet);
    for i in 1..v_full loop
      v_no := v_no + 1;
      v_h := s.layers * s.layer_h;
      insert into walmart_build_pallets (order_id, pallet_no, kind, srps, height_in, cbm, weight_lb)
      values (o.id, v_no, 'full', s.per_pallet, round(v_h,1), wm_pallet_cbm(v_h), round(s.per_pallet * s.srp_lb + 50, 1)) returning id into v_pid;
      insert into walmart_build_pallet_items (pallet_id, order_id, seq, sku, srps, per_layer, ti, hi, full_layers, partial, layer_h)
      values (v_pid, o.id, 1, l.sku, s.per_pallet, s.per_layer, s.ti, s.hi, s.layers, 0, s.layer_h);
    end loop;
    v_rem := l.q - v_full * s.per_pallet;
    if v_rem > 0 then
      v_floor := v_floor || jsonb_build_object('sku', l.sku, 'q', v_rem, 'per_layer', s.per_layer, 'ti', s.ti, 'hi', s.hi,
                   'layer_h', s.layer_h, 'lb', s.srp_lb, 'h', ceil(v_rem / s.per_layer) * s.layer_h);
    end if;
  end loop;

  -- Floor: leftovers of this PO share mixed pallets. Tallest blocks are placed first, each SKU stays in one block,
  -- a new pallet is started only when the next block would push the load past 54".
  create temp table if not exists _wm_floor (sku text, q numeric, per_layer int, ti int, hi int, layer_h numeric, lb numeric, h numeric, bin int) on commit drop;
  delete from _wm_floor;
  insert into _wm_floor select x->>'sku', (x->>'q')::numeric, (x->>'per_layer')::int, (x->>'ti')::int, (x->>'hi')::int,
    (x->>'layer_h')::numeric, (x->>'lb')::numeric, (x->>'h')::numeric, null from jsonb_array_elements(v_floor) x;
  for f in select * from _wm_floor order by h desc, sku loop
    v_bin := null;
    for i in 1..coalesce(array_length(v_bins,1),0) loop
      if v_bins[i] + f.h <= v_cap then v_bin := i; exit; end if;
    end loop;
    if v_bin is null then v_bins := v_bins || f.h; v_bin := array_length(v_bins,1);
    else v_bins[v_bin] := v_bins[v_bin] + f.h; end if;
    update _wm_floor set bin = v_bin where sku = f.sku;
  end loop;
  for b in 1..coalesce(array_length(v_bins,1),0) loop
    v_no := v_no + 1;
    insert into walmart_build_pallets (order_id, pallet_no, kind, srps, height_in, cbm, weight_lb)
    select o.id, v_no, 'floor', sum(q), round(sum(h),1), wm_pallet_cbm(sum(h)), round(sum(q*lb) + 50, 1) from _wm_floor where bin = b
    returning id into v_pid;
    v_seq := 0;
    -- one block per SKU (its whole layers with its short top layer on top of them), heaviest at the bottom
    for f in select sku, q, per_layer, ti, hi, layer_h,
                    case when per_layer is null then 0 else floor(q / per_layer)::int end wl,
                    case when per_layer is null then q else q - floor(q / per_layer) * per_layer end rq
             from _wm_floor where bin = b
             order by q * lb desc, sku loop
      v_seq := v_seq + 1;
      insert into walmart_build_pallet_items (pallet_id, order_id, seq, sku, srps, per_layer, ti, hi, full_layers, partial, layer_h)
      values (v_pid, o.id, v_seq, f.sku, f.q, f.per_layer, f.ti, f.hi, f.wl, f.rq, f.layer_h);
    end loop;
  end loop;

  if coalesce(o.pallet_target,0) > 0 and o.pallet_target <> v_no then perform walmart_pallet_fit(o.id, o.pallet_target); v_no := o.pallet_target; end if;
  update walmart_build_pallets set cube_ft = wm_pallet_cube(height_in) where order_id = o.id;
  perform set_config('wm.replan', '1', true);
  update walmart_board_orders set
    cube_ft = (select round(sum(cube_ft),2) from walmart_build_pallets where order_id = o.id),
    cbm = (select round(sum(cbm),3) from walmart_build_pallets where order_id = o.id),
    plan_pallets = (select count(*) from walmart_build_pallets where order_id = o.id),
    plan_weight = (select round(sum(weight_lb)) from walmart_build_pallets where order_id = o.id),
    plan_stale = false, plan_at = now(),
    pallets = case when coalesce(o.pallet_target,0) > 0 then o.pallet_target::text else coalesce(nullif(btrim(pallets),''), (select count(*)::text from walmart_build_pallets where order_id = o.id)) end,
    qty = coalesce(qty, (select count(*) from walmart_build_pallets where order_id = o.id)),
    weight = coalesce(weight, (select round(sum(weight_lb)) from walmart_build_pallets where order_id = o.id))
  where id = o.id;
  perform set_config('wm.replan', '', true);
  return json_build_object('ok', true, 'pallets', v_no);
end $function$;
