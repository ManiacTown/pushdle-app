-- Adds the weekly lock-in for money-mode upgrades: money_upgrade_choice_seen
-- tracks whether this account has made its one choice of active_money_upgrade
-- for the current money week yet. set_active_money_upgrade now also flips
-- it true on every successful choice (whether made via
-- MoneyUpgradeChoiceModal.jsx or a direct change in MoneyShop.jsx), and
-- the weekly reset (api/weekly-money-reset.js) flips it back false for
-- everyone, same pass as insurance_used_this_week/money_weekly_cents. See
-- schema.sql's own comments on both for the full reasoning.

alter table profiles
  add column money_upgrade_choice_seen boolean not null default true;

create or replace function public.set_active_money_upgrade(p_user_id uuid, p_upgrade text)
returns table(out_success boolean, out_active_money_upgrade text) as $$
declare
  v_owns_insurance boolean;
  v_owns_streak_bonus boolean;
  v_owns_daredevil boolean;
  v_current text;
begin
  select owns_insurance, owns_streak_bonus, owns_daredevil, active_money_upgrade
    into v_owns_insurance, v_owns_streak_bonus, v_owns_daredevil, v_current
    from profiles where id = p_user_id for update;

  if p_upgrade is null then
    update profiles set active_money_upgrade = null, money_upgrade_choice_seen = true where id = p_user_id;
    return query select true, null::text;
  elsif p_upgrade = 'insurance' and v_owns_insurance then
    update profiles set active_money_upgrade = 'insurance', money_upgrade_choice_seen = true where id = p_user_id;
    return query select true, 'insurance'::text;
  elsif p_upgrade = 'streak_bonus' and v_owns_streak_bonus then
    update profiles set active_money_upgrade = 'streak_bonus', money_upgrade_choice_seen = true where id = p_user_id;
    return query select true, 'streak_bonus'::text;
  elsif p_upgrade = 'daredevil' and v_owns_daredevil then
    update profiles set active_money_upgrade = 'daredevil', money_upgrade_choice_seen = true where id = p_user_id;
    return query select true, 'daredevil'::text;
  else
    return query select false, v_current;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.set_active_money_upgrade from public, anon, authenticated;
grant execute on function public.set_active_money_upgrade to service_role;
