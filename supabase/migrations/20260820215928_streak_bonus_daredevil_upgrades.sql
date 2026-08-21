-- Adds two new Money Mode shop upgrades — Streak Bonus and Daredevil —
-- alongside the existing Weekly Bust Insurance, plus the single
-- active_money_upgrade slot that makes all three mutually exclusive. See
-- schema.sql's own comments on active_money_upgrade and resolve_money_push
-- for the full reasoning; this migration is the same content, just applied
-- incrementally to the live database.

alter table profiles
  add column owns_streak_bonus boolean not null default false,
  add column owns_daredevil boolean not null default false,
  add column active_money_upgrade text check (active_money_upgrade is null or active_money_upgrade in ('insurance', 'streak_bonus', 'daredevil'));

-- Existing insurance owners keep working exactly as before this migration
-- (own it = it just applies) rather than silently going inert the moment
-- this ships, since active_money_upgrade defaults to null for everyone.
update profiles set active_money_upgrade = 'insurance' where owns_insurance and active_money_upgrade is null;

create or replace function public.purchase_streak_bonus(p_user_id uuid)
returns table(out_success boolean, out_diamonds int, out_owns_streak_bonus boolean) as $$
declare
  v_diamonds int;
  v_owns boolean;
begin
  select money_diamonds, owns_streak_bonus into v_diamonds, v_owns
    from profiles where id = p_user_id for update;

  if v_owns or v_diamonds < 30 then
    return query select false, v_diamonds, v_owns;
    return;
  end if;

  update profiles set money_diamonds = money_diamonds - 30, owns_streak_bonus = true
    where id = p_user_id
    returning money_diamonds, owns_streak_bonus into v_diamonds, v_owns;

  return query select true, v_diamonds, v_owns;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.purchase_streak_bonus from public, anon, authenticated;
grant execute on function public.purchase_streak_bonus to service_role;

create or replace function public.purchase_daredevil(p_user_id uuid)
returns table(out_success boolean, out_diamonds int, out_owns_daredevil boolean) as $$
declare
  v_diamonds int;
  v_owns boolean;
begin
  select money_diamonds, owns_daredevil into v_diamonds, v_owns
    from profiles where id = p_user_id for update;

  if v_owns or v_diamonds < 30 then
    return query select false, v_diamonds, v_owns;
    return;
  end if;

  update profiles set money_diamonds = money_diamonds - 30, owns_daredevil = true
    where id = p_user_id
    returning money_diamonds, owns_daredevil into v_diamonds, v_owns;

  return query select true, v_diamonds, v_owns;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.purchase_daredevil from public, anon, authenticated;
grant execute on function public.purchase_daredevil to service_role;

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
    update profiles set active_money_upgrade = null where id = p_user_id;
    return query select true, null::text;
  elsif p_upgrade = 'insurance' and v_owns_insurance then
    update profiles set active_money_upgrade = 'insurance' where id = p_user_id;
    return query select true, 'insurance'::text;
  elsif p_upgrade = 'streak_bonus' and v_owns_streak_bonus then
    update profiles set active_money_upgrade = 'streak_bonus' where id = p_user_id;
    return query select true, 'streak_bonus'::text;
  elsif p_upgrade = 'daredevil' and v_owns_daredevil then
    update profiles set active_money_upgrade = 'daredevil' where id = p_user_id;
    return query select true, 'daredevil'::text;
  else
    return query select false, v_current;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.set_active_money_upgrade from public, anon, authenticated;
grant execute on function public.set_active_money_upgrade to service_role;

create or replace function public.resolve_money_push(p_user_id uuid, p_date date)
returns table(
  out_pushes int, out_earnings_cents int, out_status text, out_success boolean, out_bonus_cents int,
  out_diamond_earned boolean, out_next_diamond boolean, out_insurance_used boolean,
  out_wallet_cents int, out_lifetime_cents int, out_weekly_cents int
) as $$
declare
  v_id bigint;
  v_pushes int;
  v_earnings int;
  v_active_upgrade text;
  v_next_diamond boolean;
  v_status text;
  v_chance numeric;
  v_success boolean;
  v_bonus int := 0;
  v_diamond boolean := false;
  v_insurance_used boolean := false;
  v_wallet int;
  v_lifetime int;
  v_weekly int;
  v_owns_insurance boolean;
  v_insurance_used_this_week boolean;
  v_insured_cents int;
  v_last_banked date;
  v_prev_streak int;
  v_new_streak int;
begin
  select id, pushes, earnings_cents, next_bonus_is_diamond, status
    into v_id, v_pushes, v_earnings, v_next_diamond, v_status
    from money_runs
    where user_id = p_user_id and date = p_date
    for update;

  if not found then
    insert into money_runs (user_id, date) values (p_user_id, p_date)
      returning id, pushes, earnings_cents, next_bonus_is_diamond, status
      into v_id, v_pushes, v_earnings, v_next_diamond, v_status;
  end if;

  if v_status <> 'playing' then
    return query select v_pushes, v_earnings, v_status, false, v_bonus, v_diamond, v_next_diamond, v_insurance_used, v_wallet, v_lifetime, v_weekly;
    return;
  end if;

  select active_money_upgrade into v_active_upgrade from profiles where id = p_user_id;

  v_chance := case
    when v_active_upgrade = 'daredevil' then (case when v_pushes < 5 then 1.0 else 0.92 end)
    else (case when v_pushes < 10 then 1.0 else 0.97 end)
  end;
  v_success := random() < v_chance;

  if v_success then
    v_pushes := v_pushes + 1;
    if v_pushes % 5 = 0 then
      v_diamond := v_next_diamond;
      if v_diamond then
        update profiles set money_diamonds = money_diamonds + 1 where id = p_user_id;
      else
        v_bonus := (1 + floor(random() * 5))::int * 100;
      end if;
      if v_active_upgrade = 'streak_bonus' then
        v_bonus := v_bonus + 100;
      end if;
      v_next_diamond := random() < 0.10;
    end if;
    v_earnings := v_earnings + (case when v_active_upgrade = 'daredevil' then (100 + v_bonus) * 2 else 100 + v_bonus end);
    update money_runs set pushes = v_pushes, earnings_cents = v_earnings,
      next_bonus_is_diamond = v_next_diamond where id = v_id;
  else
    select owns_insurance, insurance_used_this_week, active_money_upgrade
      into v_owns_insurance, v_insurance_used_this_week, v_active_upgrade
      from profiles where id = p_user_id for update;

    if v_active_upgrade = 'insurance' and v_owns_insurance and not v_insurance_used_this_week then
      v_insurance_used := true;
      v_insured_cents := v_earnings / 2;

      select money_last_banked_date, money_bank_streak into v_last_banked, v_prev_streak
        from profiles where id = p_user_id;
      v_new_streak := case when v_last_banked = p_date - 1 then v_prev_streak + 1 else 1 end;

      update profiles set
        money_wallet_cents = money_wallet_cents + v_insured_cents,
        money_lifetime_cents = money_lifetime_cents + v_insured_cents,
        money_best_run_cents = greatest(money_best_run_cents, v_insured_cents),
        money_weekly_cents = money_weekly_cents + v_insured_cents,
        money_best_weekly_cents = greatest(money_best_weekly_cents, money_weekly_cents + v_insured_cents),
        money_banked_after_one_push = money_banked_after_one_push or (v_pushes = 1),
        money_bank_streak = v_new_streak,
        money_best_bank_streak = greatest(money_best_bank_streak, v_new_streak),
        money_last_banked_date = p_date,
        insurance_used_this_week = true
      where id = p_user_id
      returning money_wallet_cents, money_lifetime_cents, money_weekly_cents into v_wallet, v_lifetime, v_weekly;

      update money_runs set status = 'cashed_out', earnings_cents = v_insured_cents where id = v_id returning status into v_status;
      v_earnings := v_insured_cents;
    else
      update money_runs set status = 'dead' where id = v_id returning status into v_status;
      update profiles set
        money_busted_over100 = money_busted_over100 or (v_earnings >= 10000),
        money_bank_streak = 0
      where id = p_user_id;
    end if;
  end if;

  return query select v_pushes, v_earnings, v_status, v_success, v_bonus, v_diamond, v_next_diamond, v_insurance_used, v_wallet, v_lifetime, v_weekly;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.resolve_money_push from public, anon, authenticated;
grant execute on function public.resolve_money_push to service_role;
