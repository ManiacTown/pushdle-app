-- Anti-sniping for the weekly money leaderboard's last day (Sunday,
-- Pacific): the top 10 standings become fully hidden for everyone — not
-- just a UI toggle, see the REVOKE at the bottom for why — so nobody can
-- nudge a rival by exactly $1 in the closing hours. Four pieces:
--
-- 1. pacific_money_blackout() — the shared "is it blackout day" check,
--    computed in Postgres itself (not trusted from the client) so the
--    real enforcement lives server-side regardless of what a client
--    claims the date is.
-- 2. get_money_weekly_leaderboard() — replaces Leaderboard.jsx's old
--    direct `profiles` query for the money/weekly view. Returns every
--    ranked profile with its own explicit `rank`, but OMITS rows ranked
--    1-10 entirely during blackout (not just their score — their
--    username/emoji/existence in the list too), plus a `hiddenCount` so
--    the client knows how many blurred placeholder rows to render.
-- 3. get_public_money_stats(p_user_id) — replaces PublicProfile.jsx's
--    per-player money_weekly_cents read. During blackout, any OTHER
--    account's live weekly total comes back hidden (viewing your OWN
--    public profile still shows your real number) — closes the "just
--    keep refreshing a known rival's profile page" sniping path, which
--    the leaderboard hide alone wouldn't.
-- 4. get_my_weekly_cents() — the one legitimate "read my own live
--    total" path once the column-level REVOKE below lands (Money Mode
--    gameplay already gets fresh values straight from
--    resolve_money_push/resolve_money_cashout's own return rows, so this
--    is really just for AuthContext.jsx's refreshMoneyStats). Scoped to
--    auth.uid() internally, not a parameter, so there's no argument to
--    pass a different id and read someone else's — the function itself
--    IS the access control, always unmasked regardless of blackout.
--
-- The REVOKE at the bottom is what actually makes this real security
-- rather than a client-side UI toggle a technical sniper could bypass by
-- hitting the Supabase REST endpoint directly with the app's public anon
-- key: profiles' existing `grant select on profiles to anon, authenticated`
-- (schema.sql) is a whole-table grant with no column restriction, so
-- money_weekly_cents was — until this migration — fully bulk-readable/
-- sortable by anyone, for every row, on any day, regardless of what the
-- UI chose to show. After this, the three functions above are the ONLY
-- way to read it at all for the anon/authenticated roles; they run
-- SECURITY DEFINER (same pattern as every other sensitive RPC in this
-- schema), so they still work despite the revoke.

create or replace function public.pacific_money_blackout()
returns boolean as $$
begin
  return extract(dow from (now() at time zone 'America/Los_Angeles')) = 0;
end;
$$ language plpgsql stable set search_path = public;

grant execute on function public.pacific_money_blackout to anon, authenticated;

-- Ranks everyone with money_weekly_cents > 0 (same filter
-- finalize_money_week uses — a 0-cents week was never in the running).
-- Non-blackout days return every ranked row, unchanged from the old
-- direct-query behavior. On blackout, rows ranked 1-10 are dropped from
-- the result set entirely — not nulled, not flagged, just absent — so
-- there's nothing in the response for a client to work with even by
-- accident.
create or replace function public.get_money_weekly_leaderboard()
returns jsonb as $$
declare
  v_blackout boolean := public.pacific_money_blackout();
  v_hidden_count int;
  v_rows jsonb;
begin
  with ranked as (
    select id, username, selected_emoji, active_aura, active_row_style, money_currently_top3, money_weekly_cents,
           row_number() over (order by money_weekly_cents desc, id asc) as rnk
    from profiles
    where money_weekly_cents > 0
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'userId', id, 'username', username, 'emoji', selected_emoji, 'aura', active_aura,
      'rowStyle', active_row_style, 'topThreeLastWeek', money_currently_top3,
      'scoreCents', money_weekly_cents, 'rank', rnk
    ) order by rnk) filter (where not v_blackout or rnk > 10), '[]'::jsonb),
    count(*) filter (where v_blackout and rnk <= 10)
  into v_rows, v_hidden_count
  from ranked;

  return jsonb_build_object('hiddenCount', coalesce(v_hidden_count, 0), 'rows', v_rows);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.get_money_weekly_leaderboard to anon, authenticated;

-- Replaces PublicProfile.jsx's direct read of money_weekly_cents for
-- someone ELSE's profile — the leaderboard hide alone doesn't stop a
-- sniper from just bookmarking a known rival's /player/:id and refreshing
-- it all day Sunday for their live total. During blackout, any account
-- OTHER than the caller's own gets weeklyCents = null/hidden = true;
-- viewing your own public profile still shows your real number.
-- `IS DISTINCT FROM` handles the anonymous-caller case correctly —
-- auth.uid() is null for a guest, and `p_user_id IS DISTINCT FROM null`
-- is true for every real id, so a guest never gets an "own profile"
-- exemption, which is the correct default.
create or replace function public.get_public_money_stats(p_user_id uuid)
returns jsonb as $$
declare
  v_hidden boolean;
  v_cents int;
begin
  v_hidden := public.pacific_money_blackout() and p_user_id is distinct from auth.uid();
  if v_hidden then
    v_cents := null;
  else
    select money_weekly_cents into v_cents from profiles where id = p_user_id;
  end if;
  return jsonb_build_object('weeklyCents', v_cents, 'hidden', v_hidden);
end;
$$ language plpgsql security definer set search_path = public;

grant execute on function public.get_public_money_stats to anon, authenticated;

create or replace function public.get_my_weekly_cents()
returns int as $$
declare
  v_cents int;
begin
  select money_weekly_cents into v_cents from profiles where id = auth.uid();
  return coalesce(v_cents, 0);
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.get_my_weekly_cents from public, anon;
grant execute on function public.get_my_weekly_cents to authenticated;

-- The actual enforcement — see this migration's header comment for why a
-- client-side-only hide wasn't real security. Column-level (not a
-- table-level revoke, which would break username/emoji/every other
-- publicly-readable profiles field) so every OTHER column's existing
-- behavior is completely unaffected. service_role is untouched by this —
-- `grant all on profiles to service_role` (schema.sql) is a separate,
-- broader grant that column-level revokes on anon/authenticated don't
-- narrow, so resolve_money_push/resolve_money_cashout/
-- api/weekly-money-reset.js all keep working exactly as before.
revoke select (money_weekly_cents) on profiles from anon, authenticated;
