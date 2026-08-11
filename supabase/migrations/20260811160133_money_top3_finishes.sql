-- Adds profiles.money_top3_finishes (lifetime count of top-3 weekly
-- finishes, every week counted separately — unlike money_reached_top3_weekly's
-- one-time flag) and wires finalize_money_week to increment it alongside
-- money_weekly_wins. See schema.sql's own comments for the full reasoning.

alter table profiles
  add column money_top3_finishes int not null default 0 check (money_top3_finishes >= 0);

create or replace function public.finalize_money_week(p_week_start date)
returns jsonb as $$
declare
  v_top3 jsonb;
  v_full_board jsonb;
begin
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
