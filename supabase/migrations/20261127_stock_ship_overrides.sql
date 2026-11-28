-- Manager override for the shipping stock guard (Nov 27, 2026).
-- The guard refuses a ship movement that would take on-hand below zero. A manager can now
-- approve the shipment anyway with the Shipped Override password and a required reason.
-- Every override is logged here for review; on-hand still goes negative so the watchdog
-- keeps flagging the item until it is counted or the missing production is recorded.

create table if not exists public.stock_ship_overrides (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid,
  order_number text,
  sku text not null,
  product_id uuid,
  qty_needed numeric,
  on_hand numeric,
  reason text not null,
  requested_by text,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  movement_id uuid,
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
);

alter table public.stock_ship_overrides enable row level security;
drop policy if exists sso_read on public.stock_ship_overrides;
create policy sso_read on public.stock_ship_overrides for select to authenticated using (true);
drop policy if exists sso_review on public.stock_ship_overrides;
create policy sso_review on public.stock_ship_overrides for update to authenticated using (true) with check (true);

alter table public.inventory_movements add column if not exists override_id uuid references public.stock_ship_overrides(id);

-- Approve an override for one or more short lines. Only the RPC can create rows.
create or replace function public.grant_stock_override(pw text, p_sales_order_id uuid, p_order_number text, p_reason text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ok boolean; l jsonb; v_id uuid; v_out jsonb := '{}'::jsonb; v_user text; v_list text := '';
begin
  select exists (select 1 from app_secrets where key = 'ship_override_password' and value = pw) into v_ok;
  if not coalesce(v_ok, false) then raise exception 'Incorrect override password' using errcode = 'P0001'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'A reason is required for a stock override' using errcode = 'P0001'; end if;
  v_user := coalesce(auth.jwt() ->> 'email', 'unknown');
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    insert into stock_ship_overrides (sales_order_id, order_number, sku, product_id, qty_needed, on_hand, reason, requested_by)
    values (p_sales_order_id, p_order_number, l->>'sku', nullif(l->>'product_id','')::uuid, (l->>'need')::numeric, (l->>'on_hand')::numeric, btrim(p_reason), v_user)
    returning id into v_id;
    v_out := v_out || jsonb_build_object(l->>'sku', v_id);
    v_list := v_list || case when v_list = '' then '' else ', ' end || (l->>'sku') || ' (ship ' || (l->>'need') || ', on hand ' || (l->>'on_hand') || ')';
  end loop;
  -- Rudy and production review every override.
  insert into notifications (recipient_email, sender_email, message, page, record_id, record_type, type, title, context_url)
  select r, v_user,
         'Stock override on ' || coalesce(p_order_number, 'an order') || ': ' || v_list || '. Reason: ' || btrim(p_reason),
         'Shipping Queue', p_sales_order_id, 'sales_order', 'warning', 'Shipped with a stock override',
         'https://beyondgreen-erp.vercel.app/production/shipping-queue'
  from unnest(array['rudyp@beyondgreenbiotech.com', 'robert@beyondgreenbiotech.com']) r;
  return v_out;
end $$;
revoke all on function public.grant_stock_override(text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.grant_stock_override(text, uuid, text, text, jsonb) to authenticated;

-- Guard: an unused, same-day override for the same SKU lets one ship movement through.
create or replace function public.inventory_guard_ship()
returns trigger language plpgsql as $$
declare v_oh numeric; v_sku text; v_line text;
begin
  if new.movement_type <> 'ship' or new.qty >= 0 then return new; end if;
  if coalesce(current_setting('erp.ship_guard_skip', true), '') = '1' then return new; end if;
  if upper(coalesce(new.sku,'')) = any(walmart_skus()) then return new; end if;
  select coalesce(on_hand_qty,0), sku, production_line into v_oh, v_sku, v_line from products where id = new.product_id;
  if v_line = 'straw' then return new; end if;
  if v_oh is null then return new; end if;
  if v_oh + new.qty < -0.0001 then
    if new.override_id is not null and exists (
      select 1 from stock_ship_overrides o
      where o.id = new.override_id and o.used_at is null and o.created_at > now() - interval '1 day'
        and upper(o.sku) = upper(coalesce(v_sku, new.sku))
    ) then
      update stock_ship_overrides set used_at = now(), movement_id = new.id where id = new.override_id;
      new.note := coalesce(new.note, '') || ' [stock override]';
      return new;
    end if;
    raise exception 'Cannot ship % × %: only % on hand. Record the production (or receive the stock) first — nothing leaves the building on paper that is not in inventory.', abs(new.qty), coalesce(v_sku, new.sku), v_oh
      using errcode = 'P0001', hint = 'insufficient_stock';
  end if;
  return new;
end $$;
