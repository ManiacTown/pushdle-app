-- Fixes a real production bug that broke the very first live run of
-- finalize_money_week's won_weekly_with_*/Leonardo da Vinci logic (added
-- 2026-08-21, migration 20260821164621): `p.active_money_upgrade = 'insurance'`
-- evaluates to SQL null (not false) whenever active_money_upgrade is null —
-- the common case, no upgrade active — and `false or null` is null, which
-- then violates won_weekly_with_insurance/_streak_bonus/_daredevil's
-- not-null constraint. This is exactly what happened on 2026-08-24: that
-- week's #1 finisher (Saitamasque) had no active upgrade, so the whole
-- finalize_money_week call threw, and api/weekly-money-reset.js's cron
-- left money_weekly_resets' 2026-08-24 row claimed but never completed —
-- no reset, no results modal, for anyone.
--
-- Fix: coalesce(p.active_money_upgrade, '') so the comparison is false
-- (not null) when nothing's active. Byte-for-byte the same as
-- 20260821164621's version otherwise.

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
      won_weekly_with_insurance = p.won_weekly_with_insurance or (prized.rnk = 1 and coalesce(p.active_money_upgrade, '') = 'insurance'),
      won_weekly_with_streak_bonus = p.won_weekly_with_streak_bonus or (prized.rnk = 1 and coalesce(p.active_money_upgrade, '') = 'streak_bonus'),
      won_weekly_with_daredevil = p.won_weekly_with_daredevil or (prized.rnk = 1 and coalesce(p.active_money_upgrade, '') = 'daredevil'),
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
