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
  best_streak       int not null default 0,
  total_pushes      int not null default 0,
  day_streak        int not null default 0,
  last_played_date  date,
  busted_at_zero    boolean not null default false,
  busted_at_one     boolean not null default false,

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
                       ('⭐','🌀','🍀','🎲','🎲💯🎲','💀','🔥','⚡','🚀','🟢','🔴','💥')),

  -- Whether this player has dismissed the first-visit "how to play" modal
  -- (see OnboardingModal.jsx) on ANY device — only ever set true, never
  -- back to false, so it stays dismissed everywhere once seen anywhere.
  -- Guests track this in localStorage only (no row here yet); on login,
  -- AuthContext carries a true local flag into this column so a guest who
  -- signs up — or an existing player logging in on a device that already
  -- dismissed it pre-login — never sees it again either.
  onboarding_seen   boolean not null default false,

  -- Money-variant currency (see money_runs below, admin-gated for now —
  -- MoneyMode.jsx). Two separate numbers on purpose: money_lifetime_cents
  -- only ever increases, on every cash-out (it's what the money-variant
  -- leaderboard ranks on) — money_wallet_cents also increases on cash-out
  -- but decreases when a future shop purchase is made. That split is the
  -- entire reason spending in the shop can never move someone's
  -- leaderboard rank. Both are NOT client-updatable (see the grant below)
  -- — only resolve_money_push/resolve_money_cashout write them.
  money_wallet_cents    int not null default 0,
  money_lifetime_cents  int not null default 0
);

alter table profiles enable row level security;

-- Profiles are public read (usernames show on the leaderboard next to scores).
create policy "profiles are publicly readable"
  on profiles for select
  using (true);

-- A user may only touch their own row, and (per the column-restricted
-- grant below) only username/selected_emoji/onboarding_seen directly — the
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
-- row, but this grant only allows touching these three columns — role/
-- stat columns are unreachable from the client even though the row itself
-- is "theirs", because column-level and row-level privileges are checked
-- independently. onboarding_seen is safe to leave directly client-writable
-- (unlike the stat columns) since it's a one-way true flag with no scoring
-- implications either way.
grant update (username, selected_emoji, onboarding_seen) on profiles to authenticated;
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
create or replace function public.resolve_push(p_user_id uuid, p_date date)
returns table(
  out_streak int, out_status text, out_success boolean,
  out_best_streak int, out_total_pushes int, out_day_streak int,
  out_busted_at_zero boolean, out_busted_at_one boolean
) as $$
declare
  v_id bigint;
  v_streak int;
  v_status text;
  v_chance numeric;
  v_success boolean;
  v_is_new boolean := false;
  v_best_streak int;
  v_total_pushes int;
  v_day_streak int;
  v_last_played date;
  v_busted_zero boolean;
  v_busted_one boolean;
begin
  select id, streak, status into v_id, v_streak, v_status
    from daily_runs
    where user_id = p_user_id and date = p_date
    for update;

  if not found then
    insert into daily_runs (user_id, date, streak, status)
    values (p_user_id, p_date, 0, 'playing')
    returning id, streak, status into v_id, v_streak, v_status;
    v_is_new := true;
  end if;

  -- Lock the profile row too, so the stat writes below are part of this
  -- same atomic transaction (and serialize against a concurrent push the
  -- same way the daily_runs lock above does).
  select best_streak, total_pushes, day_streak, last_played_date, busted_at_zero, busted_at_one
    into v_best_streak, v_total_pushes, v_day_streak, v_last_played, v_busted_zero, v_busted_one
    from profiles where id = p_user_id for update;

  if v_status = 'dead' then
    return query select v_streak, v_status, false, v_best_streak, v_total_pushes, v_day_streak, v_busted_zero, v_busted_one;
    return;
  end if;

  -- Day streak only moves on the day's first push — which is exactly when
  -- a fresh daily_runs row had to be created above, so the two conditions
  -- are equivalent (mirrors the client's old storage.recordDailyPlay logic).
  if v_is_new then
    v_day_streak := case when v_last_played = p_date - 1 then v_day_streak + 1 else 1 end;
    v_last_played := p_date;
  end if;

  v_total_pushes := v_total_pushes + 1;

  v_chance := case when v_streak = 0 then 0.999 else 0.9 end;
  v_success := random() < v_chance;

  if v_success then
    update daily_runs set streak = v_streak + 1 where id = v_id
      returning streak, status into v_streak, v_status;
    v_best_streak := greatest(v_best_streak, v_streak);
  else
    update daily_runs set status = 'dead' where id = v_id
      returning streak, status into v_streak, v_status;
    if v_streak = 0 then v_busted_zero := true; end if;
    if v_streak = 1 then v_busted_one := true; end if;
  end if;

  update profiles set
    best_streak = v_best_streak,
    total_pushes = v_total_pushes,
    day_streak = v_day_streak,
    last_played_date = v_last_played,
    busted_at_zero = v_busted_zero,
    busted_at_one = v_busted_one
  where id = p_user_id;

  return query select v_streak, v_status, v_success, v_best_streak, v_total_pushes, v_day_streak, v_busted_zero, v_busted_one;
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
create or replace function public.merge_local_stats(
  p_user_id uuid,
  p_best_streak int,
  p_total_pushes int,
  p_day_streak int,
  p_last_played_date date,
  p_busted_zero boolean,
  p_busted_one boolean
)
returns table(
  out_best_streak int, out_total_pushes int, out_day_streak int,
  out_last_played_date date, out_busted_at_zero boolean, out_busted_at_one boolean
) as $$
declare
  v_already_migrated boolean;
  v_total int;
  v_best int;
  v_day int;
begin
  select stats_migrated into v_already_migrated from profiles where id = p_user_id for update;

  if v_already_migrated then
    return query select best_streak, total_pushes, day_streak, last_played_date, busted_at_zero, busted_at_one
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
  returning best_streak, total_pushes, day_streak, last_played_date, busted_at_zero, busted_at_one;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.merge_local_stats from public, anon, authenticated;
grant execute on function public.merge_local_stats to service_role;

-- ---- money_runs (the money-variant game mode — admin-gated for now,
--      see money-push/money-cashout Edge Functions and MoneyMode.jsx) ----
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
  status          text not null default 'playing' check (status in ('playing', 'dead', 'cashed_out')),
  created_at      timestamptz not null default now(),

  unique (user_id, date)
);

alter table money_runs enable row level security;

-- Unlike daily_runs, NOT publicly readable — there's no live "today's
-- money leaderboard" requirement (the money leaderboard is a lifetime
-- total sourced from profiles, see Leaderboard.jsx), so there's no reason
-- to expose anyone's in-progress run to anyone but its own owner.
create policy "users can read their own money run"
  on money_runs for select
  using (auth.uid() = user_id);

grant select on money_runs to authenticated;
grant all on money_runs to service_role;

-- Same atomic get-or-create-row + roll + write pattern as resolve_push,
-- for the exact same reason (closing the same read-then-write race). Never
-- touches profiles — see the earnings_cents comment above for why that
-- matters. The money variant's first push is a GUARANTEED success (v_chance
-- 1.0, not classic's 0.999) — a deliberately softer ante for this mode.
create or replace function public.resolve_money_push(p_user_id uuid, p_date date)
returns table(
  out_pushes int, out_earnings_cents int, out_status text, out_success boolean
) as $$
declare
  v_id bigint;
  v_pushes int;
  v_earnings int;
  v_status text;
  v_chance numeric;
  v_success boolean;
  v_bonus int;
begin
  select id, pushes, earnings_cents, status into v_id, v_pushes, v_earnings, v_status
    from money_runs
    where user_id = p_user_id and date = p_date
    for update;

  if not found then
    insert into money_runs (user_id, date) values (p_user_id, p_date)
      returning id, pushes, earnings_cents, status into v_id, v_pushes, v_earnings, v_status;
  end if;

  -- Idempotent safety net, same as resolve_push's dead-guard — just two
  -- terminal states here instead of one.
  if v_status <> 'playing' then
    return query select v_pushes, v_earnings, v_status, false;
    return;
  end if;

  v_chance := case when v_pushes = 0 then 1.0 else 0.95 end;
  v_success := random() < v_chance;

  if v_success then
    v_pushes := v_pushes + 1;
    -- $1 base, +$3 bonus on every 5th successful push (in cents).
    v_bonus := case when v_pushes % 5 = 0 then 300 else 0 end;
    v_earnings := v_earnings + 100 + v_bonus;
    update money_runs set pushes = v_pushes, earnings_cents = v_earnings where id = v_id;
  else
    update money_runs set status = 'dead' where id = v_id returning status into v_status;
  end if;

  return query select v_pushes, v_earnings, v_status, v_success;
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
create or replace function public.resolve_money_cashout(p_user_id uuid, p_date date)
returns table(
  out_earnings_cents int, out_status text, out_wallet_cents int, out_lifetime_cents int, out_success boolean
) as $$
declare
  v_id bigint;
  v_earnings int;
  v_status text;
  v_wallet int;
  v_lifetime int;
begin
  select id, earnings_cents, status into v_id, v_earnings, v_status
    from money_runs
    where user_id = p_user_id and date = p_date
    for update;

  if not found or v_status <> 'playing' then
    select money_wallet_cents, money_lifetime_cents into v_wallet, v_lifetime
      from profiles where id = p_user_id;
    return query select coalesce(v_earnings, 0), coalesce(v_status, 'dead'), v_wallet, v_lifetime, false;
    return;
  end if;

  update profiles set
    money_wallet_cents = money_wallet_cents + v_earnings,
    money_lifetime_cents = money_lifetime_cents + v_earnings
  where id = p_user_id
  returning money_wallet_cents, money_lifetime_cents into v_wallet, v_lifetime;

  update money_runs set status = 'cashed_out' where id = v_id;

  return query select v_earnings, 'cashed_out', v_wallet, v_lifetime, true;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.resolve_money_cashout from public, anon, authenticated;
grant execute on function public.resolve_money_cashout to service_role;
