-- Admin dev-tool: a per-account switch that forces
-- pacific_money_blackout() to true for whoever has it flipped on,
-- regardless of the real day — lets an admin verify the Sunday
-- anti-sniping hardening (get_money_weekly_leaderboard/
-- get_public_money_stats, see 20260825163115_money_weekly_blackout.sql)
-- actually works without waiting for a real Sunday, or faking the client
-- clock (which wouldn't prove anything — the whole point of that
-- migration was that the real check lives server-side).
--
-- Deliberately scoped to "whoever's calling," not a global site-wide
-- flag: pacific_money_blackout() reads `auth.uid()` — the actual caller
-- of THIS request — so flipping this on only changes what the flipping
-- account itself sees when it calls the two masking functions. Every
-- other visitor's own calls still resolve auth.uid() to THEIR OWN id,
-- whose money_blackout_preview is false, and still get the real,
-- unmasked board. No separate scoping logic needed anywhere else — this
-- falls out for free from auth.uid() already being per-invocation.
alter table profiles add column if not exists money_blackout_preview boolean not null default false;

-- Plain client-updatable, like onboarding_seen/money_unlock_seen/etc. —
-- worst case a non-admin flips this on themselves and hides the
-- leaderboard from their OWN view of it, which is harmless (the admin
-- dev-tools panel that actually exposes a button for this is already
-- isAdmin-gated in Home.jsx; this grant is just what lets that button's
-- own update call succeed, same as every other one-way flag on this list).
grant update (username, selected_emoji, onboarding_seen, money_unlock_seen, pity_intro_seen, money_weekly_results_seen, clicked_contact, modifier_update_seen, money_blackout_preview) on profiles to authenticated;

create or replace function public.pacific_money_blackout()
returns boolean as $$
begin
  return extract(dow from (now() at time zone 'America/Los_Angeles')) = 0
    or exists (select 1 from profiles where id = auth.uid() and money_blackout_preview);
end;
$$ language plpgsql stable set search_path = public;
