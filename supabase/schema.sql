-- Pushdle schema — run this in the Supabase SQL editor (or via `supabase db push`
-- once the CLI is linked to a project) after creating a new project.
--
-- Security model: daily_runs has NO insert/update policy for the client roles
-- (anon/authenticated) on purpose. The only way a row gets written is through
-- the push Edge Function using the service_role key, which bypasses RLS.
-- That's what makes the leaderboard trustworthy — see DECISIONS.md / the
-- chat history on why client-submitted scores can't be trusted.

-- ---- profiles ----

create table if not exists profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  -- Mirrors the client-side filter in Login.jsx (sanitizeUsername) —
  -- letters/numbers/underscores only, 1-20 chars. Enforced here too since
  -- the client-side filter alone is just a UI nicety; anyone hitting the
  -- Supabase API directly bypasses it entirely, and this is the only place
  -- that's actually load-bearing for keeping the leaderboard/nav bar/badge
  -- toasts safe from usernames that break their layouts.
  username          text unique not null check (username ~ '^[A-Za-z0-9_]{1,20}$'),
  created_at        timestamptz not null default now(),

  -- 'player' or 'admin'. Deliberately NOT client-updatable (see the
  -- column-restricted grant below) — promoting someone to admin only
  -- happens via the SQL editor, which runs as postgres and bypasses RLS
  -- and grants entirely. Never expose a path for a user to set their own role.
  role              text not null default 'player' check (role in ('player', 'admin')),

  -- Lifetime stats — server-authoritative for logged-in players as of the
  -- resolve_push/merge_local_stats functions below (updated atomically
  -- inside resolve_push on every push; merge_local_stats folds in whatever
  -- was previously tracked client-side in localStorage, on login, so
  -- existing players' progress isn't lost by this becoming authoritative).
  -- Guests have no row here at all — they stay purely local, same as ever.
  -- The >= 0 checks on this and every other stat/currency column below are
  -- defense in depth, not the primary guard (that's the admin Edge
  -- Function's ALLOWED_BADGE_FIELDS allowlist and the RPCs' own
  -- greatest()/increment-only logic) — belt-and-suspenders against a
  -- negative value ever landing here by any path.
  best_streak       int not null default 0 check (best_streak >= 0),
  total_pushes      int not null default 0 check (total_pushes >= 0),
  day_streak        int not null default 0 check (day_streak >= 0),
  last_played_date  date,
  busted_at_zero    boolean not null default false,
  busted_at_one     boolean not null default false,

  -- Comeback Boost pity counter (classic mode, registered accounts only —
  -- see resolve_push below). Climbs by 1 on a bust at streak <= 3, capped
  -- at 3; a bust at streak 4-6 is neutral; reaching 3 arms the NEXT run's
  -- daily_runs.boosted flag, guaranteeing that run's first 10 presses.
  -- Cleared to 0 either when a non-armed run clears streak >= 7 on its own
  -- (the drought already broke), or when an armed run actually resolves
  -- (spent either way, win or lose — never stacks).
  pity_count        int not null default 0 check (pity_count >= 0),

  -- Set true the first time merge_local_stats successfully runs for this
  -- account, then never again — see merge_local_stats below. Closes off
  -- what was, until 2026-07-24, a real exploit: merge_local_stats trusted
  -- whatever numbers the client claimed and only ever raised values, so
  -- any logged-in user could call the sync-stats Edge Function directly
  -- (bypassing the game entirely) with a forged body and permanently
  -- inflate their own best_streak/total_pushes to anything at all — which
  -- is exactly how one account ended up with a best_streak in the
  -- hundreds of millions. The legitimate use case (folding in a brand-new
  -- signup's pre-account localStorage progress) only ever applies once;
  -- after that, the server's own resolve_push-tracked columns are the
  -- sole source of truth and there's nothing left to merge.
  stats_migrated    boolean not null default false,

  -- The emoji a player has chosen to show next to their name on the
  -- leaderboard, from a rare-or-better badge they've earned. Badge
  -- *eligibility* is still checked client-side only (badges are a derived
  -- concept — computed from the stats above, never stored as their own
  -- "earned" list — and there's no separate authoritative check here), so
  -- this constraint is deliberately narrow: it only guarantees the
  -- value is one of the real flair emoji, not that this specific player
  -- actually earned that badge. Keep this list in sync with
  -- src/lib/game.js's BADGE_EMOJI.
  selected_emoji    text check (selected_emoji is null or selected_emoji in
                       ('⭐','🌀','🍀','🎲','🎲💯🎲','💀','🔥','⚡','🚀','🟢','🔴','💥',
                        '🧓','🏦','💰','💵','🙌','🤑','🐔','😵')),

  -- Whether this player has dismissed the first-visit "how to play" modal
  -- (see OnboardingModal.jsx) on ANY device — only ever set true, never
  -- back to false, so it stays dismissed everywhere once seen anywhere.
  -- Guests track this in localStorage only (no row here yet); on login,
  -- AuthContext carries a true local flag into this column so a guest who
  -- signs up — or an existing player logging in on a device that already
  -- dismissed it pre-login — never sees it again either.
  onboarding_seen   boolean not null default false,

  -- Whether this account has seen MoneyModeUnlockModal.jsx's "you unlocked
  -- Money Mode" announcement — same one-way, never-back-to-false semantics
  -- as onboarding_seen above, and the same reason it's client-writable in
  -- the grant below. Unlike onboarding_seen, there's no localStorage/guest
  -- side to this one: the modal only ever targets logged-in accounts (see
  -- Home.jsx's trigger effect), since money mode itself requires an
  -- account regardless.
  money_unlock_seen boolean not null default false,

  -- Whether this account has seen PityIntroModal.jsx's explainer for the
  -- Comeback Boost pity mechanic — same one-way semantics and no-
  -- localStorage-side reasoning as money_unlock_seen above (Comeback Boost
  -- is registered-accounts-only, see profiles.pity_count). Triggered the
  -- first time the pity meter's fill-up animation actually plays for this
  -- account (see Home.jsx's schedulePityFillReveal), not just on login.
  pity_intro_seen boolean not null default false,

  -- Money-variant currency (see money_runs below). money_lifetime_cents
  -- only ever increases, on every cash-out (it's what the Lifetime
  -- leaderboard tab ranks on). money_wallet_cents moves in exact lockstep
  -- with it (same amount, same moments, in every resolve_money_push/
  -- resolve_money_cashout write) — the original plan was for the shop to
  -- spend down money_wallet_cents while leaving money_lifetime_cents
  -- untouched, so leaderboard rank couldn't be bought down; the shop ended
  -- up spending money_diamonds instead (see below), so nothing ever
  -- decrements this column in practice. Kept (not dropped) since it's
  -- still written correctly and cheap to keep around if a real
  -- wallet-spend feature shows up later — just not read by any client
  -- code today (the money-mode home screen's wallet/bank panel switched
  -- to money_weekly_cents instead — see MoneyMode.jsx). Neither column is
  -- client-updatable (see the grant below) — only resolve_money_push/
  -- resolve_money_cashout write them.
  money_wallet_cents    int not null default 0 check (money_wallet_cents >= 0),
  money_lifetime_cents  int not null default 0 check (money_lifetime_cents >= 0),
  -- The shop's own currency — deliberately NOT cents/dollars (see
  -- MoneyShop.jsx). A 10% chance per combo-bar fill (see
  -- resolve_money_push) replaces that push's usual $1-$5 bonus with one
  -- diamond instead of adding to it, so this is a separate, rarer reward
  -- track from the wallet, not a cents-to-diamonds conversion of any kind.
  -- Only ever shown inside the shop itself — nowhere else in the money UI
  -- surfaces it, same "wallet vs lifetime" separation-of-concerns reasoning
  -- as the two columns above, just for a currency that only means anything
  -- in one specific place.
  money_diamonds        int not null default 0 check (money_diamonds >= 0),
  -- The shop's first real purchase (see MoneyShop.jsx/purchase_diamond_button
  -- below) — 10 diamonds, permanent, applies to CLASSIC mode's push button
  -- (see Home.jsx), not money mode's own bag button. Kept as its own
  -- dedicated boolean/RPC pair (purchase_diamond_button, active_push_skin)
  -- rather than folded into the generic owned_cosmetics/purchase_cosmetic
  -- pair below — it predates them and already works, no reason to touch it.
  owns_diamond_button    boolean not null default false,
  -- Every OTHER purchasable cosmetic (auras, leaderboard row styles — see
  -- MoneyShop.jsx) lives in this one list rather than getting its own
  -- boolean column each, since unlike the push-button skin there's more
  -- than one item per category and more categories than just one. A plain
  -- text[] of item ids, checked with `= any(...)` (see purchase_cosmetic/
  -- set_active_cosmetic below) rather than a normalized items/ownership
  -- table — there are a small, fixed number of these right now, and this
  -- avoids a join for something Leaderboard.jsx/Profile.jsx need to read
  -- on every render. Revisit if the catalog grows enough that hand-listing
  -- ids everywhere (here, purchase_cosmetic's price table, cosmetics.js's
  -- color maps) gets unwieldy.
  owned_cosmetics        text[] not null default '{}',
  -- Which cosmetic is equipped in each independent slot, if any — null
  -- means none equipped in that slot even if something's owned for it.
  -- THREE separate columns, not one shared pointer (that was this
  -- project's first attempt — see git history) — a push-button skin, a
  -- badge-flair aura, and a leaderboard-row style are three different
  -- places on screen that can all be equipped at once, not competing
  -- alternatives for one shared spot the way multiple push-button skins
  -- would be. Client-unwritable (see the grant below) — set_active_cosmetic
  -- is the only path, and it re-checks ownership server-side every time,
  -- same "never trust the client's cached owned/active state" reasoning as
  -- purchase_diamond_button/purchase_cosmetic.
  active_push_skin       text check (active_push_skin is null or active_push_skin in ('diamond_button')),
  -- Rendered as a colored ring around the flair emoji (see
  -- src/lib/cosmetics.js's AURA_COLORS) wherever it shows: Leaderboard.jsx
  -- rows, Profile.jsx, PublicProfile.jsx — same emoji, same aura, every
  -- place it appears, since this is "whose flair is this" styling, not a
  -- per-page setting.
  active_aura            text check (active_aura is null or active_aura in ('aura_gold', 'aura_violet', 'aura_green', 'aura_diamond')),
  -- Recolors the player's own row on Leaderboard.jsx (see
  -- src/lib/cosmetics.js's ROW_STYLE_COLORS) — medal-rank rows (top 3)
  -- still always win over this, same "rank tier beats personalization"
  -- precedence the row's own me-highlight already had before this existed.
  active_row_style       text check (active_row_style is null or active_row_style in ('row_gold', 'row_violet', 'row_green', 'row_diamond')),

  -- Once-per-week safety net for money mode (see MoneyShop.jsx and
  -- resolve_money_push's bust branch below) — a permanent purchase, not a
  -- consumable that's re-bought; owns_insurance never goes back to false.
  owns_insurance          boolean not null default false,
  -- The LIVE per-week flag: true once insurance has saved a bust this
  -- week, false again from the moment it's armed. Reset to false every
  -- Monday by api/weekly-money-reset.js, in the same pass as
  -- money_weekly_cents — same reset boundary, so "once a week" always
  -- means the same week the money leaderboard itself uses.
  insurance_used_this_week boolean not null default false,

  -- Money-badge tracking (see game.js's money-* BADGES) — all written
  -- exclusively by resolve_money_push/resolve_money_cashout below, same
  -- restricted-grant treatment as the money columns above.
  -- Best single run ever banked — greatest() on every cash-out, mirrors
  -- how best_streak tracks classic's longest run.
  money_best_run_cents          int not null default 0 check (money_best_run_cents >= 0),
  -- This WEEK's earnings — resets to 0 by the weekly cron (see
  -- api/weekly-money-reset.js), unlike money_lifetime_cents which never
  -- goes down. Powers Leaderboard.jsx's weekly money sub-tab.
  money_weekly_cents             int not null default 0 check (money_weekly_cents >= 0),
  -- Best money_weekly_cents ever reached, ACROSS all weeks — greatest() on
  -- every cash-out (money_weekly_cents only ever rises within a week, so
  -- its value right before a given week's reset is that week's peak; this
  -- just keeps the highest peak seen over every week so far). Powers
  -- PublicProfile.jsx's money-tab stat tile.
  money_best_weekly_cents        int not null default 0 check (money_best_weekly_cents >= 0),
  -- Consecutive-day cash-out streak. money_bank_streak is the LIVE value
  -- (can drop to 0 on a bust or a skipped day); money_best_bank_streak is
  -- a permanent greatest() of it, same "earn it once, keep it forever"
  -- property best_streak already has — deliberately NOT like classic's
  -- day_streak-based badges, which check the live value and can silently
  -- un-earn (see the money-streak-* badges' own comment in game.js).
  money_bank_streak              int not null default 0 check (money_bank_streak >= 0),
  money_best_bank_streak         int not null default 0 check (money_best_bank_streak >= 0),
  -- Gap-detection for money_bank_streak — mirrors last_played_date's role
  -- for day_streak. Null until the first-ever cash-out.
  money_last_banked_date         date,
  -- One-way flags, same pattern as busted_at_zero/busted_at_one above —
  -- each backs exactly one badge and only ever flips true.
  money_reached_top3_weekly      boolean not null default false,
  money_banked_after_one_push    boolean not null default false,
  -- No underscore before "100" — deliberately matches money_reached_top3_weekly's
  -- own no-underscore-before-a-digit-run naming above, not a typo. Keeping
  -- both flag columns on the same convention is what lets
  -- game.js's camelToSnakeFields() stay a pure mechanical regex with no
  -- per-field exceptions (an earlier version of this column WAS
  -- money_busted_over_100, which broke that; see this file's git history
  -- and game.js's camelToSnakeFields comment).
  money_busted_over100           boolean not null default false,

  -- This account's placement in the most recently COMPLETED money week —
  -- written exclusively by finalize_money_week (see below), which runs
  -- once as part of api/weekly-money-reset.js's Monday pass, right before
  -- money_weekly_cents gets zeroed for the new week. Null forever for an
  -- account that has never once earned money in a week that completed
  -- (never touched by finalize_money_week — a 0-cents week isn't ranked at
  -- all, mirroring the old top3 query's own `money_weekly_cents=gt.0`
  -- filter). Stays at its LAST real value between weeks — nothing clears
  -- it back to null — since money_weekly_results_seen below is what
  -- actually gates whether it's still "new" to show, not this column
  -- itself.
  money_last_week_rank             int check (money_last_week_rank is null or money_last_week_rank >= 1),
  money_last_week_score_cents      int not null default 0 check (money_last_week_score_cents >= 0),
  -- What finalize_money_week actually credited to money_diamonds for that
  -- placement (20/15/10/5/0 — see that function's own comment for the
  -- tier table) — stored per-account rather than re-derived from rank on
  -- read, so MoneyWeeklyResultsModal.jsx shows exactly what was credited
  -- even if the prize tiers themselves change in some future week.
  money_last_week_diamonds_awarded int not null default 0 check (money_last_week_diamonds_awarded >= 0),
  -- Whether MoneyWeeklyResultsModal.jsx has been dismissed for the
  -- CURRENT money_last_week_rank snapshot — same one-way-until-reset
  -- pattern as insurance_used_this_week (not onboarding_seen/
  -- money_unlock_seen, which are one-way FOREVER): finalize_money_week
  -- flips this back to false for every ranked account on every completed
  -- week, and the modal's own onDismiss flips it back to true, so it
  -- shows again next week for anyone who ranks again. Defaults to true
  -- (not false) so this ships without retroactively popping the modal for
  -- every existing account on their next login — only an account
  -- finalize_money_week actually touches ever sees it flip to false.
  money_weekly_results_seen        boolean not null default true
);

alter table profiles enable row level security;

-- Profiles are public read (usernames show on the leaderboard next to scores).
create policy "profiles are publicly readable"
  on profiles for select
  using (true);

-- A user may only touch their own row, and (per the column-restricted
-- grant below) only username/selected_emoji/onboarding_seen/
-- money_unlock_seen/pity_intro_seen directly — the
-- actual stat columns are written exclusively by resolve_push/
-- merge_local_stats (security definer, service_role-only), never by a
-- direct client update.
create policy "users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- RLS policies only govern *which rows* — the anon/authenticated roles also
-- need the base grant to touch the table at all. The Supabase Table Editor
-- does this for you automatically; raw SQL doesn't, so it has to be explicit.
grant select on profiles to anon, authenticated;
-- Column-restricted on purpose: the RLS policy above allows updating the
-- row, but this grant only allows touching these five columns — role/
-- stat columns are unreachable from the client even though the row itself
-- is "theirs", because column-level and row-level privileges are checked
-- independently. onboarding_seen/money_unlock_seen/pity_intro_seen are
-- safe to leave directly client-writable (unlike the stat columns) since
-- they're one-way true flags with no scoring implications either way.
-- money_weekly_results_seen joins this list for the same reason
-- money_unlock_seen/pity_intro_seen already are — it's a one-way-per-week
-- ack flag with no scoring implications, flipped by
-- MoneyWeeklyResultsModal.jsx's own dismiss handler (see AuthContext.jsx's
-- markMoneyWeeklyResultsSeen). The rank/score/diamonds-awarded columns
-- next to it stay OUT of this grant on purpose — those are only ever
-- written by finalize_money_week (service_role), same "never trust the
-- client with a scoring/currency field" posture every other money_* column
-- above already follows.
grant update (username, selected_emoji, onboarding_seen, money_unlock_seen, pity_intro_seen, money_weekly_results_seen) on profiles to authenticated;
-- service_role bypasses RLS policies but NOT base object grants — those are
-- two separate permission layers, and creating a table via raw SQL doesn't
-- grant either automatically the way the Table Editor UI does.
grant all on profiles to service_role;

-- Auto-create a profile row when someone signs up, so the client never
-- needs its own insert policy for profiles either.
-- `set search_path = public` pins name resolution inside the function so it
-- can't be hijacked by a malicious search_path — Supabase's linter flags
-- security definer functions without this.
create function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'player_' || substr(new.id::text, 1, 8)));
  return new;
end;
$$ language plpgsql security definer set search_path = public;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- The trigger invokes this function regardless of grants (triggers run at
-- the engine level, not through the same permission check as an RPC call)
-- — so it's safe, and better practice, to make sure nobody can also call
-- it directly as a client-side RPC.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---- daily_runs (the leaderboard itself) ----

create table if not exists daily_runs (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  date        date not null,
  streak      int not null default 0,
  status      text not null default 'playing' check (status in ('playing', 'dead')),
  created_at  timestamptz not null default now(),
  -- Set once when this run is created (see resolve_push), from whatever
  -- profiles.pity_count was at that moment — not re-derived per push, so
  -- an armed run keeps its guarantee for its whole length even past streak
  -- 7 (see profiles.pity_count's own comment on the early-clear rule).
  boosted     boolean not null default false,

  unique (user_id, date)
);

create index if not exists daily_runs_leaderboard_idx on daily_runs (date, streak desc);

alter table daily_runs enable row level security;

-- Public read only — leaderboard needs to be visible to everyone.
-- Deliberately NO insert/update policy: only the service_role (used by the
-- push Edge Function) can write to this table.
create policy "daily runs are publicly readable"
  on daily_runs for select
  using (true);

-- Deliberately only SELECT is granted — no insert/update grant for
-- anon/authenticated, on top of no such RLS policy either. Belt and
-- suspenders: this is the actual "no submitting" enforcement.
grant select on daily_runs to anon, authenticated;
grant all on daily_runs to service_role;

-- Does the whole "get-or-create the row, check it's not already dead, roll,
-- write the result" sequence as a single atomic operation, instead of the
-- push Edge Function doing separate read-then-write calls. That older
-- approach had a real race: two concurrent requests could both read the
-- row before either write landed, both pass the "not dead yet" check, and
-- both get scored as a free success — skipping the bust risk that's the
-- entire point of the game, and the exact kind of client-exploitable gap
-- this schema has otherwise been careful to close (see the file header).
-- `select ... for update` takes a row lock, so a second concurrent call
-- for the same user+date blocks until the first one's transaction commits,
-- then sees the already-updated row instead of the stale one.
-- Also updates the caller's lifetime profile stats (total_pushes,
-- best_streak, day_streak/last_played_date, the two bust flags) in the same
-- transaction as the daily_runs write — this is what makes those numbers
-- server-authoritative for logged-in players instead of the client-side-only
-- localStorage tracking every player (including logged-in ones) used before.
-- See merge_local_stats below for how an existing player's pre-existing
-- local progress gets folded in rather than silently reset to zero.
-- Return shape includes out_pity_count/out_boosted (Comeback Boost) —
-- CREATE OR REPLACE can't change a function's column set, hence the DROP
-- right before it (see resolve_money_push's own comment on this pattern).
drop function if exists public.resolve_push(uuid, date);

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
begin
  -- Profile locked FIRST now (used to be after daily_runs) — a brand new
  -- run's own `boosted` flag (set once, at insert, below) needs the
  -- caller's CURRENT pity_count in hand before that insert happens, not
  -- after. This is the only function that locks both tables together, so
  -- reordering here doesn't create any cross-function deadlock risk.
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

  -- Day streak only moves on the day's first push — which is exactly when
  -- a fresh daily_runs row had to be created above, so the two conditions
  -- are equivalent (mirrors the client's old storage.recordDailyPlay logic).
  if v_is_new then
    v_day_streak := case when v_last_played = p_date - 1 then v_day_streak + 1 else 1 end;
    v_last_played := p_date;
  end if;

  -- Mirrors the client's own guest-side derivation (see
  -- FIRST_RUN_GUARANTEE_STREAK in src/lib/game.js): on an uninterrupted
  -- first-ever run, lifetime total_pushes and this run's streak-so-far are
  -- always exactly equal (every push so far succeeded, both started at 0
  -- and climbed together) — read BEFORE the increment below, same as the
  -- client reads `stats.totalPushes` before incrementing it. No new column
  -- needed: the moment this stops holding, either it isn't the very first
  -- run, or this run's already past the guarantee window, both of which
  -- correctly fall back to the normal roll.
  v_first_run_guaranteed := v_total_pushes = v_streak and v_streak < 10;

  v_total_pushes := v_total_pushes + 1;

  -- Comeback Boost (see profiles.pity_count/daily_runs.boosted): an armed
  -- run gets the SAME guarantee-through-streak-10 treatment as a genuine
  -- first-ever run, just gated on v_boosted instead — once streak reaches
  -- 10 it transparently falls through to the normal 0.9 branch for the
  -- rest of that same run, no separate boosted-percentage tier. Combined
  -- into ONE branch with v_first_run_guaranteed (not a separate case ahead
  -- of the plain v_streak = 0 branch) — an armed run's very first press is
  -- streak 0 too, and CASE stops at the first match, so checking v_streak
  -- = 0 -> 0.999 first would silently downgrade an armed run's opening
  -- press from the guaranteed 1.0 it's supposed to get.
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
    -- Clear-to-0 early: a still-building (non-armed) run that reaches
    -- streak 7 wipes the meter on its own, proof the drought already
    -- broke — but only while not already armed; an armed run keeps
    -- v_pity_count at 3 until it actually resolves (below), so a
    -- still-guaranteed run at streak 7-9 doesn't have its pity progress
    -- wiped before the run's even over.
    if not v_boosted and v_streak >= 7 then
      v_pity_count := 0;
    end if;
  else
    update daily_runs set status = 'dead' where id = v_id
      returning streak, status into v_streak, v_status;
    if v_streak = 0 then v_busted_zero := true; end if;
    if v_streak = 1 then v_busted_one := true; end if;
    -- Pity update on bust: an armed run that just busted has spent its
    -- boost, win or lose — always resets, regardless of how far it got.
    -- A non-armed run only adds a charge for a genuinely unlucky bust
    -- (streak <= 5); a mid-range bust (6) is neutral, capped at 3.
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
    pity_count = v_pity_count
  where id = p_user_id;

  return query select v_streak, v_status, v_success, v_best_streak, v_total_pushes, v_day_streak, v_busted_zero, v_busted_one, v_pity_count, v_boosted;
end;
$$ language plpgsql security definer set search_path = public;

-- Only the push Edge Function (via the service_role client) should ever
-- call this — it's the one place the roll actually happens.
revoke execute on function public.resolve_push from public, anon, authenticated;
grant execute on function public.resolve_push to service_role;

-- Runs ONCE per account (see stats_migrated above) to merge a brand-new
-- signup's pre-account localStorage progress into their server profile
-- row, so it isn't silently lost the moment stats become server-
-- authoritative. Historically this ran on every login and trusted
-- whatever numbers the client claimed (only ever raising them via
-- greatest()/or, never lowering) — which meant anyone logged in could
-- call the sync-stats Edge Function directly with a forged body and
-- permanently inflate their own stats, since there was no bound on the
-- submitted values and no limit on how many times this could run. Fixed
-- 2026-07-24 two ways: (1) this is now a no-op once stats_migrated is
-- already true — there's nothing left to legitimately merge after the
-- first real login anyway, so repeat calls (forged or not) can't do
-- anything; (2) even on that one legitimate call, submitted values are
-- clamped to a plausible range rather than trusted outright — total_pushes
-- capped at a generous but bounded ceiling, and best_streak can never
-- exceed total_pushes (every streak push is also a total push, so a
-- streak bigger than the total is a logical impossibility regardless of
-- source). See AuthContext.jsx / sync-stats/index.ts, which layers the
-- same bounds check on the way in as defense in depth.
-- Return shape includes out_pity_count (Comeback Boost) — CREATE OR REPLACE
-- can't change a function's column set, hence the DROP right before it.
drop function if exists public.merge_local_stats(uuid, int, int, int, date, boolean, boolean, date, int, text);

create or replace function public.merge_local_stats(
  p_user_id uuid,
  p_best_streak int,
  p_total_pushes int,
  p_day_streak int,
  p_last_played_date date,
  p_busted_zero boolean,
  p_busted_one boolean,
  p_today_date date default null,
  p_today_streak int default null,
  p_today_status text default null
)
returns table(
  out_best_streak int, out_total_pushes int, out_day_streak int,
  out_last_played_date date, out_busted_at_zero boolean, out_busted_at_one boolean,
  out_pity_count int
) as $$
declare
  v_already_migrated boolean;
  v_total int;
  v_best int;
  v_day int;
  v_pity_count int;
begin
  select stats_migrated, pity_count into v_already_migrated, v_pity_count from profiles where id = p_user_id for update;

  -- Carries a guest's LOCAL run for TODAY into a real daily_runs row —
  -- either still in progress ('playing', so logging in mid-run doesn't
  -- reset it to 0 — see Home.jsx's loadRunState, which otherwise finds no
  -- row at all for a brand-new account/day and starts fresh) or already
  -- busted ('dead', so a guest who finishes a run and THEN signs up still
  -- shows up on today's leaderboard for that run instead of it just
  -- vanishing — their best_streak/total_pushes below are preserved
  -- either way, this is specifically about today's own leaderboard entry).
  -- Deliberately NOT gated behind v_already_migrated below like the
  -- lifetime-stats merge is — the unique(user_id, date) constraint plus
  -- "on conflict do nothing" already caps this to "only ever takes effect
  -- the first time today specifically has no row yet," which is the
  -- condition that actually matters, on every login that day, not just
  -- the account's very first login ever. The explicit status allowlist
  -- guards against an invalid value here from ever reaching the insert —
  -- daily_runs.status has its own CHECK constraint, and failing that
  -- would blow up this whole function call (including the legitimate
  -- stats merge below) instead of just skipping this one optional part.
  -- Streak clamped to 10 — a deliberately tight ceiling on how much of an
  -- unverified local claim this carries over at all (every push in a
  -- carried-over run skipped the server's own roll entirely), not a
  -- "highest plausible streak" bound the way v_total/v_best's 100000 is.
  -- A guest who genuinely got further than that before signing up keeps
  -- the real number in best_streak (merged separately below, uncapped by
  -- this), just not reflected in today's own leaderboard entry above 10.
  if p_today_date is not null and p_today_streak is not null and p_today_streak > 0
     and p_today_status in ('playing', 'dead') then
    insert into daily_runs (user_id, date, streak, status, boosted)
    values (p_user_id, p_today_date, least(p_today_streak, 200), p_today_status, v_pity_count >= 3)
    on conflict (user_id, date) do nothing;
  end if;

  if v_already_migrated then
    return query select best_streak, total_pushes, day_streak, last_played_date, busted_at_zero, busted_at_one, pity_count
      from profiles where id = p_user_id;
    return;
  end if;

  v_total := least(greatest(p_total_pushes, 0), 100000);
  v_best := least(greatest(p_best_streak, 0), v_total);
  v_day := least(greatest(p_day_streak, 0), v_total);

  return query
  update profiles set
    best_streak = greatest(profiles.best_streak, v_best),
    total_pushes = greatest(profiles.total_pushes, v_total),
    -- day_streak and last_played_date are taken together from whichever
    -- side has the more recent last_played_date, rather than maxed
    -- independently — greatest()-ing day_streak alone could pair a big
    -- streak from one device with a newer, unrelated date from another and
    -- fabricate continuity that never actually happened.
    day_streak = case
      when p_last_played_date is not null and (profiles.last_played_date is null or p_last_played_date > profiles.last_played_date)
      then v_day else profiles.day_streak end,
    last_played_date = case
      when p_last_played_date is not null and (profiles.last_played_date is null or p_last_played_date > profiles.last_played_date)
      then p_last_played_date else profiles.last_played_date end,
    busted_at_zero = profiles.busted_at_zero or p_busted_zero,
    busted_at_one = profiles.busted_at_one or p_busted_one,
    stats_migrated = true
  where id = p_user_id
  returning best_streak, total_pushes, day_streak, last_played_date, busted_at_zero, busted_at_one, pity_count;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.merge_local_stats from public, anon, authenticated;
grant execute on function public.merge_local_stats to service_role;

-- ---- money_runs (the money-variant game mode — see money-push/
--      money-cashout Edge Functions and MoneyMode.jsx) ----
--
-- A parallel table to daily_runs, not a mode column bolted onto it —
-- daily_runs' shape (two states, one score column, public-read leaderboard
-- policy) is specific to the streak game; money runs have a third terminal
-- state ('cashed_out') and different columns entirely (accumulated cents,
-- a push count for the every-5th-push bonus).

create table if not exists money_runs (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references profiles(id) on delete cascade,
  date            date not null,
  pushes          int not null default 0,
  -- This run's UNBANKED total — busting zeroes this out (via the status
  -- flip below) without ever touching profiles; only a successful cash-out
  -- moves money out of here into the permanent profile columns. That one
  -- fact is what makes "bust only loses this run's earnings, past
  -- cash-outs are always safe" automatic rather than something to enforce.
  earnings_cents  int not null default 0,
  -- Whether the CURRENT (not-yet-full) combo bar will pay out a diamond
  -- once it fills — rolled once per cycle rather than at the moment the
  -- bar actually fills, specifically so the client can show the correct
  -- corner icon (diamond vs money) for the whole cycle instead of only
  -- revealing it at the last push (see MoneyMode.jsx). The DEFAULT here
  -- rolls the very first cycle's outcome at row creation; resolve_money_push
  -- re-rolls it immediately after applying each fill, for the cycle that's
  -- starting next. Admin's "force diamond next" dev tool (see admin/
  -- index.ts) just sets this directly, bypassing the roll.
  next_bonus_is_diamond boolean not null default (random() < 0.10),
  status          text not null default 'playing' check (status in ('playing', 'dead', 'cashed_out')),
  created_at      timestamptz not null default now(),

  unique (user_id, date)
);

alter table money_runs enable row level security;

-- NOT publicly readable, unlike daily_runs — there's no live "today's
-- money leaderboard" requirement (the money leaderboard is a lifetime/
-- weekly total sourced from profiles, see Leaderboard.jsx), so there's no
-- reason to expose anyone's in-progress run to anyone but its own owner.
-- This used to have a second policy letting an ADMIN viewer read anyone's
-- row too (PublicProfile.jsx's "Today's Money" tile, back when the whole
-- money variant was admin-only and that was the only way to preview it
-- against a real account) — dropped now that the rest of the money
-- variant is open to everyone: that policy was only ever a testing
-- convenience, not a real access model, and this privacy stance (own
-- in-progress run only) was the deliberate design the whole time. See
-- PublicProfile.jsx's own comment on how it now only shows that tile on
-- your own profile.
create policy "users can read their own money run"
  on money_runs for select
  using (auth.uid() = user_id);

grant select on money_runs to authenticated;
grant all on money_runs to service_role;

-- Same atomic get-or-create-row + roll + write pattern as resolve_push,
-- for the exact same reason (closing the same read-then-write race).
-- Doesn't touch profiles on a normal push or a plain bust — see the
-- earnings_cents comment above for why that matters — EXCEPT when weekly
-- insurance saves a bust (see the bust branch below), which is the one
-- case a push can bank money outside of resolve_money_cashout. The money
-- variant's first push is a GUARANTEED success (v_chance 1.0, not
-- classic's 0.999) — a deliberately softer ante for this mode.
--
-- Return shape changed (added out_insurance_used/out_wallet_cents/
-- out_lifetime_cents, then later out_weekly_cents) — CREATE OR REPLACE
-- can't change a function's column set, hence the DROP right before it.
drop function if exists public.resolve_money_push(uuid, date);

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
  -- This CYCLE's pre-rolled outcome (see money_runs.next_bonus_is_diamond)
  -- — read once at the top, consumed (not re-rolled) on the fill that
  -- actually uses it, then immediately re-rolled for the cycle that's
  -- starting next, all before this function returns. The client shows
  -- out_next_diamond continuously for the whole cycle (see
  -- MoneyMode.jsx), not just at the moment the bar fills, which is the
  -- whole reason this is decided up front rather than at fill time.
  v_next_diamond boolean;
  v_status text;
  v_chance numeric;
  v_success boolean;
  -- Both default to 0/false (not just "unset") so every return path below
  -- — the already-resolved early-out and the bust branch included —
  -- reports real, non-null values without each of them needing their own
  -- explicit reset. Only the success-with-a-full-bar branch below ever
  -- overwrites either.
  v_bonus int := 0;
  v_diamond boolean := false;
  -- Weekly bust-insurance (see owns_insurance/insurance_used_this_week's
  -- own comments above) — v_wallet/v_lifetime stay null on every path
  -- except the insurance-saves-the-run one below, same "only meaningful
  -- when it actually happened" reasoning v_bonus/v_diamond already used
  -- before this existed. money-push/index.ts passes all three straight
  -- through so MoneyMode.jsx can run its coin-to-wallet animation off a
  -- save exactly the way it already does off a real cash-out.
  v_insurance_used boolean := false;
  v_wallet int;
  v_lifetime int;
  -- The money-mode home screen's wallet/bank panel now tracks THIS WEEK's
  -- earnings (money_weekly_cents), not a lifetime-mirroring total — see
  -- MoneyMode.jsx's displayedWeeklyCents/launchCoinToWallet. Stays null on
  -- every path except the insurance-saves-the-run one below, same
  -- "only meaningful when it actually happened" reasoning v_wallet/
  -- v_lifetime already used.
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

  -- Idempotent safety net, same as resolve_push's dead-guard — just two
  -- terminal states here instead of one.
  if v_status <> 'playing' then
    return query select v_pushes, v_earnings, v_status, false, v_bonus, v_diamond, v_next_diamond, v_insurance_used, v_wallet, v_lifetime, v_weekly;
    return;
  end if;

  v_chance := case when v_pushes = 0 then 1.0 else 0.97 end;
  v_success := random() < v_chance;

  if v_success then
    v_pushes := v_pushes + 1;
    -- $1 base always. Every 5th successful push (a full combo bar) is
    -- EITHER a random $1-$5 bonus (in cents, always a whole dollar — see
    -- money.js's formatCents comment) OR, 10% of the time, one diamond
    -- INSTEAD of that bonus — not on top of it, so a full bar always pays
    -- out exactly one of the two, never both. Which one is decided by
    -- v_next_diamond, NOT a fresh roll here (see its declaration above) —
    -- floor(random()*5) is uniform over {0,1,2,3,4}; +1 shifts that to
    -- {1..5}, ×100 turns it into cents, same roll as before, just only
    -- reached on the 90% branch. A diamond is credited straight to
    -- profiles.money_diamonds right here, unlike earnings_cents — the
    -- player keeps it regardless of how this run ends, bust or bank.
    if v_pushes % 5 = 0 then
      v_diamond := v_next_diamond;
      if v_diamond then
        update profiles set money_diamonds = money_diamonds + 1 where id = p_user_id;
      else
        v_bonus := (1 + floor(random() * 5))::int * 100;
      end if;
      -- Immediately re-roll for the cycle that's starting right now, so
      -- out_next_diamond below already reflects it — the corner icon can
      -- swap the instant this push's response lands rather than waiting
      -- on some later push.
      v_next_diamond := random() < 0.10;
    end if;
    v_earnings := v_earnings + 100 + v_bonus;
    update money_runs set pushes = v_pushes, earnings_cents = v_earnings,
      next_bonus_is_diamond = v_next_diamond where id = v_id;
  else
    -- Bust — check weekly insurance before finalizing anything as a loss.
    -- Locks profiles here (a plain bust otherwise only ever touches it via
    -- the update in the else branch below) so a concurrent purchase can't
    -- race a use of the same charge.
    select owns_insurance, insurance_used_this_week into v_owns_insurance, v_insurance_used_this_week
      from profiles where id = p_user_id for update;

    if v_owns_insurance and not v_insurance_used_this_week then
      -- Saved: bank HALF this run's unbanked earnings, rounded down
      -- (integer division truncates toward zero, which for a non-negative
      -- value IS floor) instead of losing all of it. Mirrors
      -- resolve_money_cashout's own banking math line-for-line rather than
      -- calling that function — this already holds every lock it would
      -- need to reacquire, and the two functions don't otherwise share a
      -- helper either (see resolve_money_cashout's own structure).
      -- Deliberately does NOT run the money_busted_over100 check below —
      -- a save isn't a bust, so it can't retroactively earn "Too Greedy"
      -- no matter how much was unbanked going in.
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
      -- money_busted_over100 (see game.js's "Too Greedy" badge) — v_earnings
      -- here is this run's unbanked total right before the bust, since a
      -- bust never adds to it. Busting also breaks the banking streak,
      -- same as classic's day_streak breaking on a missed day.
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

-- Banks whatever's accumulated in today's run into the player's permanent
-- profile columns. Row-locks money_runs the same way resolve_push locks
-- daily_runs — so a concurrent push and cash-out can't race past each
-- other: whichever commits first is authoritative, and the loser (a push
-- arriving after cash-out already flipped status, or a cash-out arriving
-- after a push already flipped status to 'dead') just hits the
-- not-'playing' guard and is a no-op instead of a lost or duplicated
-- write. Only success=false means nothing changed; a caller can always
-- tell from out_status whether this actually banked anything.
-- Return shape changed (added out_weekly_cents, see resolve_money_push's
-- own comment on why) — same DROP-before-CREATE OR REPLACE requirement.
drop function if exists public.resolve_money_cashout(uuid, date);

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

  -- Locked separately from money_runs above (different table) — cheap
  -- insurance against a concurrent cash-out on the same user corrupting
  -- the streak math below, even though the money_runs lock already rules
  -- out two cash-outs landing for the same user+date.
  select money_last_banked_date, money_bank_streak into v_last_banked, v_prev_streak
    from profiles where id = p_user_id for update;

  -- Streak continues only if the last bank was literally yesterday
  -- (Pacific) — a null v_last_banked (first-ever cash-out) or any bigger
  -- gap both fall through to "start a new streak of 1", same "greatest()
  -- for the permanent badge, live value for the current one" split
  -- money_best_bank_streak/money_bank_streak documents in schema.sql.
  v_new_streak := case when v_last_banked = p_date - 1 then v_prev_streak + 1 else 1 end;

  update profiles set
    money_wallet_cents = money_wallet_cents + v_earnings,
    money_lifetime_cents = money_lifetime_cents + v_earnings,
    money_best_run_cents = greatest(money_best_run_cents, v_earnings),
    money_weekly_cents = money_weekly_cents + v_earnings,
    -- Both sides reference the OLD money_weekly_cents (every SET
    -- expression in one UPDATE sees the pre-update row), so this is the
    -- exact same "new weekly total" as the line above — just also kept as
    -- an all-time peak instead of being allowed to reset with the week.
    money_best_weekly_cents = greatest(money_best_weekly_cents, money_weekly_cents + v_earnings),
    money_banked_after_one_push = money_banked_after_one_push or (v_pushes = 1),
    money_bank_streak = v_new_streak,
    money_best_bank_streak = greatest(money_best_bank_streak, v_new_streak),
    money_last_banked_date = p_date
  where id = p_user_id
  returning money_wallet_cents, money_lifetime_cents, money_weekly_cents into v_wallet, v_lifetime, v_weekly;

  update money_runs set status = 'cashed_out' where id = v_id;

  return query select v_earnings, 'cashed_out', v_wallet, v_lifetime, v_weekly, true;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.resolve_money_cashout from public, anon, authenticated;
grant execute on function public.resolve_money_cashout to service_role;

-- The shop's first real purchase (see MoneyShop.jsx/buy-diamond-button Edge
-- Function) — locks the profile row (same technique resolve_money_cashout's
-- streak read uses) so two rapid clicks can't both pass the balance check
-- before either write lands and double-spend the same 10 diamonds. Already-
-- owned and insufficient-balance are both just a clean out_success=false,
-- not an error — the client already knows the current balance/owned state
-- from `stats` and shouldn't normally even be able to trigger either, but
-- this is the real enforcement point regardless of what the client thinks.
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

  update profiles set money_diamonds = money_diamonds - 10, owns_diamond_button = true
    where id = p_user_id
    returning money_diamonds, owns_diamond_button into v_diamonds, v_owns;

  return query select true, v_diamonds, v_owns;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.purchase_diamond_button from public, anon, authenticated;
grant execute on function public.purchase_diamond_button to service_role;

-- Equips/unequips an owned cosmetic in ONE of the three independent slots
-- (see active_push_skin/active_aura/active_row_style's own comments above)
-- — p_slot picks which column gets written, p_cosmetic_id which value.
-- p_cosmetic_id = null always succeeds (unequipping never needs an
-- ownership check); any other value must both be owned AND match a slot
-- this function actually knows how to grant, checked with the same "never
-- trust the client" posture as purchase_diamond_button/purchase_cosmetic —
-- a client claiming to own something it doesn't (or a made-up id, or the
-- wrong slot for a real id) just gets out_success=false with the unchanged
-- current value, not an error. New cosmetics need a branch here (and a
-- value in the relevant column's check constraint above) before they can
-- ever be equipped, same allowlist-shaped safety property as
-- ALLOWED_BADGE_FIELDS in _shared/utils.ts.
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

-- Generic purchase path for everything in owned_cosmetics (auras, row
-- styles — NOT the diamond push-button skin, which keeps its own dedicated
-- purchase_diamond_button). Prices live here as the single source of
-- truth server-side; src/lib/cosmetics.js's COSMETIC_PRICES is the
-- client-side mirror used only for display (see that file's own comment on
-- keeping the two in sync) — this CASE is the actual enforcement point
-- regardless of what a client shows or sends. Unknown id, already-owned,
-- and insufficient-balance are all just a clean out_success=false, same
-- "the client already knows better, but this is the real check" reasoning
-- as purchase_diamond_button.
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
    owned_cosmetics = array_append(owned_cosmetics, p_cosmetic_id)
    where id = p_user_id
    returning money_diamonds, owned_cosmetics into v_diamonds, v_owned;

  return query select true, v_diamonds, v_owned;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.purchase_cosmetic from public, anon, authenticated;
grant execute on function public.purchase_cosmetic to service_role;

-- One-time purchase of the weekly bust-insurance perk (see
-- resolve_money_push's bust branch below for what it actually does, and
-- insurance_used_this_week's own comment for the weekly reset). Priced
-- well above the cosmetics above — this has real economic value (recovers
-- half an otherwise-lost run once a week) rather than being purely visual.
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

  update profiles set money_diamonds = money_diamonds - 30, owns_insurance = true
    where id = p_user_id
    returning money_diamonds, owns_insurance into v_diamonds, v_owns;

  return query select true, v_diamonds, v_owns;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.purchase_weekly_insurance from public, anon, authenticated;
grant execute on function public.purchase_weekly_insurance to service_role;

-- ---- Weekly money leaderboard reset (see api/weekly-money-reset.js) ----
--
-- Idempotency guard for the weekly cron, same shape/purpose as
-- daily_runs'/money_runs' own unique(user_id, date) — Vercel Cron fires
-- this endpoint twice around the Pacific-midnight DST boundary on
-- purpose (see vercel.json's comment), same as the existing daily
-- bot-seeding cron. Whichever call lands first successfully inserts its
-- week_start and does the real work; the second hits a unique-violation
-- and no-ops, rather than double-resetting money_weekly_cents or
-- double-granting money_reached_top3_weekly.
create table if not exists money_weekly_resets (
  week_start date primary key,
  -- Set the moment this row is first claimed (a cron run starting work on
  -- this week), NOT when the reset actually finishes — see completed_at
  -- below for that. Kept mainly for observability (when did we start).
  ran_at timestamptz not null default now(),
  -- Snapshot of that week's top 3 by money_weekly_cents, written by
  -- api/weekly-money-reset.js right after granting money_reached_top3_weekly
  -- and before zeroing everyone's weekly total — [{userId, username, emoji,
  -- scoreCents}, ...], ranked, up to 3 entries (fewer if fewer than 3
  -- players had a nonzero week). Snapshotted (username/emoji captured at
  -- that moment, not looked up live) so Leaderboard.jsx's "last week's
  -- champions" podium keeps showing who was actually being celebrated even
  -- if they've since renamed or changed flair — same reasoning
  -- buildShareText-style snapshots elsewhere in this app favor a frozen
  -- copy over a live join for anything meant to commemorate a moment.
  top3 jsonb,
  -- Null until every step (badge grants, top3 snapshot, AND the
  -- money_weekly_cents reset) has actually succeeded — see
  -- api/weekly-money-reset.js. This, not merely "does a row exist for this
  -- week_start," is what the handler checks before deciding a week is
  -- genuinely done. Splitting "claimed" (the row existing, ran_at) from
  -- "completed" (this) is what makes a partial failure resumable instead
  -- of permanently skipping the rest of that week's reset: the OLD
  -- behavior treated the row's mere existence as "already ran," so a
  -- failure between claiming and finishing (e.g. one of the several PATCH
  -- calls transiently 5xx'ing) left money_weekly_cents never reset and/or
  -- fewer than 3 Golden Goose grants, forever, with the next scheduled run
  -- (or a manual retry) short-circuiting on the 409/existing row instead
  -- of resuming.
  completed_at timestamptz
);

alter table money_weekly_resets enable row level security;
-- Public read — Leaderboard.jsx's "last week's champions" podium needs
-- this, and there's nothing sensitive in it (the same usernames/scores
-- are already public via profiles/the leaderboard itself). Still only
-- service_role can WRITE (no insert/update policy for any client role).
create policy "money weekly resets are publicly readable"
  on money_weekly_resets for select
  using (true);
grant select on money_weekly_resets to anon, authenticated;
grant all on money_weekly_resets to service_role;

-- The real work of the Monday reset (see api/weekly-money-reset.js), called
-- exactly once per week from inside that handler's own
-- `if (!top3Snapshot)` guard — which is what makes this safe to treat as
-- run-at-most-once despite the diamond credit below NOT being idempotent
-- the way the rest of that handler's steps are (a boolean OR / an
-- overwrite-with-same-value can be repeated harmlessly; `money_diamonds +
-- prize` cannot, it would double-pay). That guard works specifically
-- because this function does EVERYTHING in one transaction, including
-- writing the top3 result into money_weekly_resets itself (the last line
-- below) — so a resumed run's `existing[0].top3` check at the top of the
-- handler can tell a prior successful call already happened and skip
-- calling this again, with no window where the diamond credit could have
-- committed while the top3 write didn't (or vice versa).
--
-- Ranks every profile that earned anything this week (money_weekly_cents >
-- 0 — a 0-cents week was never in the running, same filter the old
-- hand-written top3 query used), pays out 20/15/10 diamonds for 1st/2nd/
-- 3rd and 5 for 4th-10th (0 beyond that), grants the permanent Golden
-- Goose flag for top 3 (money_reached_top3_weekly, an OR so re-earning it
-- a later week is a no-op), and snapshots each ranked account's own
-- placement into money_last_week_rank/score_cents/diamonds_awarded for
-- MoneyWeeklyResultsModal.jsx to read on that account's next login —
-- flipping money_weekly_results_seen back to false is what actually makes
-- the modal fire again (see that column's own comment). `id asc` as the
-- tiebreak (the old query had none) makes an exact-cents tie a total
-- order — matters more here than it used to, now that the tied accounts'
-- ranks feed real diamond payouts, not just a display-only top3 list.
--
-- src/lib/money.js's diamondsForWeeklyRank() mirrors this CASE for
-- display (the modal's prize infographic, the admin preview tool) — this
-- function is still the one real source of truth; keep both in sync if
-- the tiers ever change.
create or replace function public.finalize_money_week(p_week_start date)
returns jsonb as $$
declare
  v_top3 jsonb;
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
  )
  update profiles p set
    money_diamonds = p.money_diamonds + prized.prize,
    money_reached_top3_weekly = p.money_reached_top3_weekly or (prized.rnk <= 3),
    money_last_week_rank = prized.rnk,
    money_last_week_score_cents = prized.money_weekly_cents,
    money_last_week_diamonds_awarded = prized.prize,
    money_weekly_results_seen = false
  from prized
  where p.id = prized.id;

  select coalesce(jsonb_agg(jsonb_build_object(
      'userId', id, 'username', username, 'emoji', selected_emoji, 'scoreCents', money_weekly_cents
    ) order by money_weekly_cents desc, id asc), '[]'::jsonb)
    into v_top3
  from (
    select id, username, selected_emoji, money_weekly_cents
    from profiles
    where money_weekly_cents > 0
    order by money_weekly_cents desc, id asc
    limit 3
  ) t;

  update money_weekly_resets set top3 = v_top3 where week_start = p_week_start;

  return v_top3;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.finalize_money_week from public, anon, authenticated;
grant execute on function public.finalize_money_week to service_role;
