-- Three "fusion" two-tone gradient colors — Ashy (crimson/black), Phoenix
-- (gold/fire), Nebula (violet/cyan, the site's own brand gradient) — for
-- both Name Color and Row Background, a premium tier alongside the
-- existing flat colors. No new columns: these go through the exact same
-- owned_cosmetics/purchase_cosmetic/set_active_cosmetic path the flat
-- aura_*/row_* colors already use (owns_any_aura/owns_any_row_style
-- already match on prefix, so they cover these too with no changes).
-- Rendering (gradient-text for auras, gradient background for rows) lives
-- entirely client-side in cosmetics.js's AURA_GRADIENTS/ROW_STYLE_GRADIENTS
-- — this migration is purely "these ids are now purchasable/equippable."

alter table profiles drop constraint profiles_active_aura_check;
alter table profiles add constraint profiles_active_aura_check
  check (active_aura is null or active_aura in ('aura_gold', 'aura_violet', 'aura_green', 'aura_diamond', 'aura_ashy', 'aura_phoenix', 'aura_nebula'));

alter table profiles drop constraint profiles_active_row_style_check;
alter table profiles add constraint profiles_active_row_style_check
  check (active_row_style is null or active_row_style in ('row_gold', 'row_violet', 'row_green', 'row_diamond', 'row_ashy', 'row_phoenix', 'row_nebula'));

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
    when 'aura_ashy' then 15
    when 'aura_phoenix' then 15
    when 'aura_nebula' then 15
    when 'row_ashy' then 20
    when 'row_phoenix' then 20
    when 'row_nebula' then 20
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
