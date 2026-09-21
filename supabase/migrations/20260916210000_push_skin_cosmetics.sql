-- Four new push-button skins for the diamond shop (Lucky Dice, Lucky
-- Clover, High Roller Chip, Golden Egg) — the push_skin slot's first
-- additions since diamond_button. Unlike diamond_button (its own
-- dedicated owns_diamond_button/purchase_diamond_button/active_push_skin
-- special case, predating the generic system), these four go through the
-- same owned_cosmetics/purchase_cosmetic/set_active_cosmetic path auras
-- and row styles already use, prefixed 'skin_' the same way those use
-- 'aura_'/'row_'.

alter table profiles add column if not exists owns_any_push_skin boolean not null default false;

-- owns_any_push_skin backs game.js's "Oooh Shiny" badge now instead of
-- owns_diamond_button directly (that badge means "bought A push-button
-- skin," not specifically THE diamond one) — see purchase_cosmetic/
-- purchase_diamond_button below for where it's set going forward.
-- Retroactive credit for existing diamond_button owners, same "recompute
-- from what's already true, safe to re-run" reasoning as
-- 20260821180500_backfill_shop_badge_tracking.sql.
update profiles set owns_any_push_skin = true where owns_diamond_button;

-- Newly-readable column needs an explicit grant under the corrected
-- column-level privilege model (see 20260916200000_fix_money_weekly_cents_
-- column_grant.sql's own comment on why a blanket table-level grant is no
-- longer what governs this).
grant select (owns_any_push_skin) on profiles to anon, authenticated;

alter table profiles drop constraint profiles_active_push_skin_check;
alter table profiles add constraint profiles_active_push_skin_check
  check (active_push_skin is null or active_push_skin in ('diamond_button', 'skin_dice', 'skin_clover', 'skin_chip', 'skin_golden_egg'));

create or replace function public.purchase_diamond_button(p_user_id uuid)
returns table(out_success boolean, out_diamonds int, out_owns_diamond_button boolean) as $$
declare
  v_diamonds int;
  v_owns boolean;
begin
  select money_diamonds, owns_diamond_button into v_diamonds, v_owns
    from profiles where id = p_user_id for update;

  if v_owns or v_diamonds < 10 then
    return query select false, v_diamonds, v_owns;
    return;
  end if;

  update profiles set
    money_diamonds = money_diamonds - 10,
    owns_diamond_button = true,
    money_diamonds_spent_lifetime = money_diamonds_spent_lifetime + 10,
    owns_any_push_skin = true
    where id = p_user_id
    returning money_diamonds, owns_diamond_button into v_diamonds, v_owns;

  return query select true, v_diamonds, v_owns;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.purchase_diamond_button from public, anon, authenticated;
grant execute on function public.purchase_diamond_button to service_role;

create or replace function public.set_active_cosmetic(p_user_id uuid, p_slot text, p_cosmetic_id text)
returns table(out_success boolean, out_active_cosmetic text) as $$
declare
  v_owns_diamond_button boolean;
  v_owned text[];
  v_current text;
begin
  select owns_diamond_button, owned_cosmetics into v_owns_diamond_button, v_owned
    from profiles where id = p_user_id for update;

  if p_slot = 'push_skin' then
    select active_push_skin into v_current from profiles where id = p_user_id;
    if p_cosmetic_id is null then
      update profiles set active_push_skin = null where id = p_user_id;
      return query select true, null::text;
    elsif p_cosmetic_id = 'diamond_button' and v_owns_diamond_button then
      update profiles set active_push_skin = 'diamond_button' where id = p_user_id;
      return query select true, 'diamond_button'::text;
    elsif p_cosmetic_id = any(v_owned) and p_cosmetic_id like 'skin_%' then
      update profiles set active_push_skin = p_cosmetic_id where id = p_user_id;
      return query select true, p_cosmetic_id;
    else
      return query select false, v_current;
    end if;
    return;
  end if;

  if p_slot = 'aura' then
    select active_aura into v_current from profiles where id = p_user_id;
    if p_cosmetic_id is null then
      update profiles set active_aura = null where id = p_user_id;
      return query select true, null::text;
    elsif p_cosmetic_id = any(v_owned) and p_cosmetic_id like 'aura_%' then
      update profiles set active_aura = p_cosmetic_id where id = p_user_id;
      return query select true, p_cosmetic_id;
    else
      return query select false, v_current;
    end if;
    return;
  end if;

  if p_slot = 'row_style' then
    select active_row_style into v_current from profiles where id = p_user_id;
    if p_cosmetic_id is null then
      update profiles set active_row_style = null where id = p_user_id;
      return query select true, null::text;
    elsif p_cosmetic_id = any(v_owned) and p_cosmetic_id like 'row_%' then
      update profiles set active_row_style = p_cosmetic_id where id = p_user_id;
      return query select true, p_cosmetic_id;
    else
      return query select false, v_current;
    end if;
    return;
  end if;

  return query select false, null::text;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.set_active_cosmetic from public, anon, authenticated;
grant execute on function public.set_active_cosmetic to service_role;

create or replace function public.purchase_cosmetic(p_user_id uuid, p_cosmetic_id text)
returns table(out_success boolean, out_diamonds int, out_owned_cosmetics text[]) as $$
declare
  v_diamonds int;
  v_owned text[];
  v_price int;
begin
  select money_diamonds, owned_cosmetics into v_diamonds, v_owned
    from profiles where id = p_user_id for update;

  v_price := case p_cosmetic_id
    when 'aura_gold' then 8
    when 'aura_violet' then 8
    when 'aura_green' then 8
    when 'aura_diamond' then 8
    when 'row_gold' then 12
    when 'row_violet' then 12
    when 'row_green' then 12
    when 'row_diamond' then 12
    when 'skin_dice' then 10
    when 'skin_clover' then 10
    when 'skin_chip' then 15
    when 'skin_golden_egg' then 25
    else null
  end;

  if v_price is null or p_cosmetic_id = any(v_owned) or v_diamonds < v_price then
    return query select false, v_diamonds, v_owned;
    return;
  end if;

  update profiles set
    money_diamonds = money_diamonds - v_price,
    owned_cosmetics = array_append(owned_cosmetics, p_cosmetic_id),
    money_diamonds_spent_lifetime = money_diamonds_spent_lifetime + v_price,
    owns_any_row_style = owns_any_row_style or (p_cosmetic_id like 'row_%'),
    owns_any_aura = owns_any_aura or (p_cosmetic_id like 'aura_%'),
    owns_any_push_skin = owns_any_push_skin or (p_cosmetic_id like 'skin_%')
    where id = p_user_id
    returning money_diamonds, owned_cosmetics into v_diamonds, v_owned;

  return query select true, v_diamonds, v_owned;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.purchase_cosmetic from public, anon, authenticated;
grant execute on function public.purchase_cosmetic to service_role;
