-- Adds tracking for the new "Shop" and "Secret" badge categories (see
-- src/lib/game.js's BADGES) — 9 new profiles columns, an updated
-- selected_emoji CHECK constraint (8 new flair emoji), an updated client-
-- update grant (clicked_contact), and 8 modified RPCs. See schema.sql's
-- own comments throughout for the full reasoning on each piece.

alter table profiles
  add column money_diamonds_spent_lifetime int not null default 0 check (money_diamonds_spent_lifetime >= 0),
  add column owns_any_row_style boolean not null default false,
  add column owns_any_aura boolean not null default false,
  add column money_daredevil_run_200 boolean not null default false,
  add column clicked_contact boolean not null default false,
  add column won_weekly_with_insurance boolean not null default false,
  add column won_weekly_with_streak_bonus boolean not null default false,
  add column won_weekly_with_daredevil boolean not null default false,
  add column artemis_earned boolean not null default false;

-- Backfill owns_any_row_style/owns_any_aura for existing owners, same
-- reasoning as every prior "this column didn't exist when the real event
-- already happened" backfill this project has done — without this, an
-- account that bought a row style or name color before this migration
-- would never see "Time to Decorate"/"Standing Out" without buying
-- another one.
update profiles set owns_any_row_style = true
  where exists (select 1 from unnest(owned_cosmetics) c where c like 'row_%');
update profiles set owns_any_aura = true
  where exists (select 1 from unnest(owned_cosmetics) c where c like 'aura_%');

-- Backfill money_diamonds_spent_lifetime too — every purchase here is
-- permanent (nothing is ever un-bought or refunded), so current ownership
-- alone fully and accurately reconstructs historical spend; this isn't an
-- approximation. Guarded to freshly-defaulted rows only.
update profiles set money_diamonds_spent_lifetime =
  (case when owns_diamond_button then 10 else 0 end) +
  (case when owns_insurance then 30 else 0 end) +
  (case when owns_streak_bonus then 30 else 0 end) +
  (case when owns_daredevil then 30 else 0 end) +
  coalesce((
    select sum(case when c like 'aura_%' then 8 when c like 'row_%' then 12 else 0 end)
    from unnest(owned_cosmetics) c
  ), 0)
where money_diamonds_spent_lifetime = 0;

alter table profiles drop constraint profiles_selected_emoji_check;

alter table profiles add constraint profiles_selected_emoji_check
  check (selected_emoji is null or selected_emoji in
    ('⭐','🌀','🍀','🎲','🎲💯🎲','💀','🔥','⚡','🚀','🟢','🔴','💥',
     '🧓','🏦','💰','💵','🙌','🤑','🪿','😵',
     '💠','💎','🗡️','🪶','👑','⚖️','☄️','☢️'));

grant update (username, selected_emoji, onboarding_seen, money_unlock_seen, pity_intro_seen, money_weekly_results_seen, clicked_contact) on profiles to authenticated;

create or replace function public.resolve_push(p_user_id uuid, p_date date)
returns table(
  out_streak int, out_status text, out_success boolean,
  out_best_streak int, out_total_pushes int, out_day_streak int,
  out_busted_at_zero boolean, out_busted_at_one boolean,
  out_pity_count int, out_boosted boolean
) as $$
declare
  v_id bigint;
  v_streak int;
  v_status text;
  v_boosted boolean;
  v_chance numeric;
  v_success boolean;
  v_is_new boolean := false;
  v_best_streak int;
  v_total_pushes int;
  v_day_streak int;
  v_last_played date;
  v_busted_zero boolean;
  v_busted_one boolean;
  v_first_run_guaranteed boolean;
  v_pity_count int;
  v_artemis_qualifies boolean;
begin
  select best_streak, total_pushes, day_streak, last_played_date, busted_at_zero, busted_at_one, pity_count
    into v_best_streak, v_total_pushes, v_day_streak, v_last_played, v_busted_zero, v_busted_one, v_pity_count
    from profiles where id = p_user_id for update;

  select id, streak, status, boosted into v_id, v_streak, v_status, v_boosted
    from daily_runs
    where user_id = p_user_id and date = p_date
    for update;

  if not found then
    insert into daily_runs (user_id, date, streak, status, boosted)
    values (p_user_id, p_date, 0, 'playing', v_pity_count >= 3)
    returning id, streak, status, boosted into v_id, v_streak, v_status, v_boosted;
    v_is_new := true;
  end if;

  if v_status = 'dead' then
    return query select v_streak, v_status, false, v_best_streak, v_total_pushes, v_day_streak, v_busted_zero, v_busted_one, v_pity_count, v_boosted;
    return;
  end if;

  if v_is_new then
    v_day_streak := case when v_last_played = p_date - 1 then v_day_streak + 1 else 1 end;
    v_last_played := p_date;
  end if;

  v_first_run_guaranteed := v_total_pushes = v_streak and v_streak < 10;

  v_total_pushes := v_total_pushes + 1;

  v_chance := case
    when v_first_run_guaranteed or (v_boosted and v_streak < 10) then 1.0
    when v_streak = 0 then 0.999
    else 0.9
  end;
  v_success := random() < v_chance;

  if v_success then
    update daily_runs set streak = v_streak + 1 where id = v_id
      returning streak, status into v_streak, v_status;
    v_best_streak := greatest(v_best_streak, v_streak);
    if not v_boosted and v_streak >= 7 then
      v_pity_count := 0;
    end if;
    if v_streak >= 50 then
      select exists(
        select 1 from money_runs
        where user_id = p_user_id and date = p_date
          and status = 'cashed_out' and earnings_cents >= 10000
      ) into v_artemis_qualifies;
    end if;
  else
    update daily_runs set status = 'dead' where id = v_id
      returning streak, status into v_streak, v_status;
    if v_streak = 0 then v_busted_zero := true; end if;
    if v_streak = 1 then v_busted_one := true; end if;
    if v_boosted then
      v_pity_count := 0;
    elsif v_streak <= 5 then
      v_pity_count := least(v_pity_count + 1, 3);
    end if;
  end if;

  update profiles set
    best_streak = v_best_streak,
    total_pushes = v_total_pushes,
    day_streak = v_day_streak,
    last_played_date = v_last_played,
    busted_at_zero = v_busted_zero,
    busted_at_one = v_busted_one,
    pity_count = v_pity_count,
    artemis_earned = artemis_earned or coalesce(v_artemis_qualifies, false)
  where id = p_user_id;

  return query select v_streak, v_status, v_success, v_best_streak, v_total_pushes, v_day_streak, v_busted_zero, v_busted_one, v_pity_count, v_boosted;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.resolve_money_cashout(p_user_id uuid, p_date date)
returns table(
  out_earnings_cents int, out_status text, out_wallet_cents int, out_lifetime_cents int,
  out_weekly_cents int, out_success boolean
) as $$
declare
  v_id bigint;
  v_earnings int;
  v_pushes int;
  v_status text;
  v_wallet int;
  v_lifetime int;
  v_weekly int;
  v_last_banked date;
  v_prev_streak int;
  v_new_streak int;
  v_active_money_upgrade text;
  v_artemis_qualifies boolean;
begin
  select id, earnings_cents, pushes, status into v_id, v_earnings, v_pushes, v_status
    from money_runs
    where user_id = p_user_id and date = p_date
    for update;

  if not found or v_status <> 'playing' then
    select money_wallet_cents, money_lifetime_cents, money_weekly_cents into v_wallet, v_lifetime, v_weekly
      from profiles where id = p_user_id;
    return query select coalesce(v_earnings, 0), coalesce(v_status, 'dead'), v_wallet, v_lifetime, v_weekly, false;
    return;
  end if;

  select money_last_banked_date, money_bank_streak, active_money_upgrade
    into v_last_banked, v_prev_streak, v_active_money_upgrade
    from profiles where id = p_user_id for update;

  v_new_streak := case when v_last_banked = p_date - 1 then v_prev_streak + 1 else 1 end;

  if v_earnings >= 10000 then
    select exists(
      select 1 from daily_runs
      where user_id = p_user_id and date = p_date and streak >= 50
    ) into v_artemis_qualifies;
  end if;

  update profiles set
    money_wallet_cents = money_wallet_cents + v_earnings,
    money_lifetime_cents = money_lifetime_cents + v_earnings,
    money_best_run_cents = greatest(money_best_run_cents, v_earnings),
    money_weekly_cents = money_weekly_cents + v_earnings,
    money_best_weekly_cents = greatest(money_best_weekly_cents, money_weekly_cents + v_earnings),
    money_banked_after_one_push = money_banked_after_one_push or (v_pushes = 1),
    money_bank_streak = v_new_streak,
    money_best_bank_streak = greatest(money_best_bank_streak, v_new_streak),
    money_last_banked_date = p_date,
    money_daredevil_run_200 = money_daredevil_run_200 or (v_active_money_upgrade = 'daredevil' and v_earnings >= 20000),
    artemis_earned = artemis_earned or coalesce(v_artemis_qualifies, false)
  where id = p_user_id
  returning money_wallet_cents, money_lifetime_cents, money_weekly_cents into v_wallet, v_lifetime, v_weekly;

  update money_runs set status = 'cashed_out' where id = v_id;

  return query select v_earnings, 'cashed_out', v_wallet, v_lifetime, v_weekly, true;
end;
$$ language plpgsql security definer set search_path = public;

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
    money_diamonds_spent_lifetime = money_diamonds_spent_lifetime + 10
    where id = p_user_id
    returning money_diamonds, owns_diamond_button into v_diamonds, v_owns;

  return query select true, v_diamonds, v_owns;
end;
$$ language plpgsql security definer set search_path = public;

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
    owns_any_aura = owns_any_aura or (p_cosmetic_id like 'aura_%')
    where id = p_user_id
    returning money_diamonds, owned_cosmetics into v_diamonds, v_owned;

  return query select true, v_diamonds, v_owned;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.purchase_weekly_insurance(p_user_id uuid)
returns table(out_success boolean, out_diamonds int, out_owns_insurance boolean) as $$
declare
  v_diamonds int;
  v_owns boolean;
begin
  select money_diamonds, owns_insurance into v_diamonds, v_owns
    from profiles where id = p_user_id for update;

  if v_owns or v_diamonds < 30 then
    return query select false, v_diamonds, v_owns;
    return;
  end if;

  update profiles set
    money_diamonds = money_diamonds - 30,
    owns_insurance = true,
    money_diamonds_spent_lifetime = money_diamonds_spent_lifetime + 30
    where id = p_user_id
    returning money_diamonds, owns_insurance into v_diamonds, v_owns;

  return query select true, v_diamonds, v_owns;
end;
$$ language plpgsql security definer set search_path = public;

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

  update profiles set
    money_diamonds = money_diamonds - 30,
    owns_streak_bonus = true,
    money_diamonds_spent_lifetime = money_diamonds_spent_lifetime + 30
    where id = p_user_id
    returning money_diamonds, owns_streak_bonus into v_diamonds, v_owns;

  return query select true, v_diamonds, v_owns;
end;
$$ language plpgsql security definer set search_path = public;

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

  update profiles set
    money_diamonds = money_diamonds - 30,
    owns_daredevil = true,
    money_diamonds_spent_lifetime = money_diamonds_spent_lifetime + 30
    where id = p_user_id
    returning money_diamonds, owns_daredevil into v_diamonds, v_owns;

  return query select true, v_diamonds, v_owns;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.finalize_money_week(p_week_start date)
returns jsonb as $$
declare
  v_top3 jsonb;
  v_full_board jsonb;
begin
  update profiles set money_currently_top3 = false where money_currently_top3;

  with ranked as (
    select id, money_weekly_cents,
           row_number() over (order by money_weekly_cents desc, id asc) as rnk
    from profiles
    where money_weekly_cents > 0
  ),
  prized as (
    select id, money_weekly_cents, rnk,
      case
        when rnk = 1 then 20
        when rnk = 2 then 15
        when rnk = 3 then 10
        when rnk <= 10 then 5
        else 0
      end as prize
    from ranked
  ),
  updated as (
    update profiles p set
      money_diamonds = p.money_diamonds + prized.prize,
      money_reached_top3_weekly = p.money_reached_top3_weekly or (prized.rnk <= 3),
      money_weekly_wins = p.money_weekly_wins + (case when prized.rnk = 1 then 1 else 0 end),
      money_top3_finishes = p.money_top3_finishes + (case when prized.rnk <= 3 then 1 else 0 end),
      money_currently_top3 = (prized.rnk <= 3),
      won_weekly_with_insurance = p.won_weekly_with_insurance or (prized.rnk = 1 and p.active_money_upgrade = 'insurance'),
      won_weekly_with_streak_bonus = p.won_weekly_with_streak_bonus or (prized.rnk = 1 and p.active_money_upgrade = 'streak_bonus'),
      won_weekly_with_daredevil = p.won_weekly_with_daredevil or (prized.rnk = 1 and p.active_money_upgrade = 'daredevil'),
      money_last_week_rank = prized.rnk,
      money_last_week_score_cents = prized.money_weekly_cents,
      money_last_week_diamonds_awarded = prized.prize,
      money_weekly_results_seen = false
    from prized
    where p.id = prized.id
    returning p.id, p.username, p.selected_emoji, prized.money_weekly_cents as score_cents, prized.rnk, prized.prize
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'userId', id, 'username', username, 'emoji', selected_emoji, 'scoreCents', score_cents
    ) order by score_cents desc, id asc) filter (where rnk <= 3), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object(
      'userId', id, 'username', username, 'emoji', selected_emoji, 'scoreCents', score_cents,
      'rank', rnk, 'diamondsAwarded', prize
    ) order by rnk), '[]'::jsonb)
  into v_top3, v_full_board
  from updated;

  update money_weekly_resets set top3 = v_top3, full_board = v_full_board where week_start = p_week_start;

  return v_top3;
end;
$$ language plpgsql security definer set search_path = public;
