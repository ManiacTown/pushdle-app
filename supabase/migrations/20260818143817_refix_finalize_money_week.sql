-- Re-applies finalize_money_week's money_weekly_wins/money_top3_finishes/
-- money_currently_top3 logic (added 2026-08-11, migrations
-- 20260811155300/160133/161845). The columns from those migrations landed
-- fine, but the function body itself apparently never actually took —
-- the 2026-08-17 weekly reset ran without any of this logic, leaving
-- last week's flags stale instead of rotating. This migration is
-- byte-for-byte the same function body as 20260811161845; the fix here
-- is operational (verify pg_get_functiondef actually reflects this after
-- pushing, which wasn't done last time), not a content change.

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

revoke execute on function public.finalize_money_week from public, anon, authenticated;
grant execute on function public.finalize_money_week to service_role;
