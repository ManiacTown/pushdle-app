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
                       ('⭐','🌀','🍀','🎲','🎲💯🎲','💀','🔥','⚡','🚀','🟢','🔴','💥'))
);

alter table profiles enable row level security;

-- Profiles are public read (usernames show on the leaderboard next to scores).
create policy "profiles are publicly readable"
  on profiles for select
  using (true);

-- A user may only touch their own row, and (per the column-restricted
-- grant below) only username/selected_emoji directly — the actual stat
-- columns are written exclusively by resolve_push/merge_local_stats
-- (security definer, service_role-only), never by a direct client update.
create policy "users can update their own profile"
  on profiles for update
  using (auth.uid() = id);

-- RLS policies only govern *which rows* — the anon/authenticated roles also
-- need the base grant to touch the table at all. The Supabase Table Editor
-- does this for you automatically; raw SQL doesn't, so it has to be explicit.
grant select on profiles to anon, authenticated;
-- Column-restricted on purpose: the RLS policy above allows updating the
-- row, but this grant only allows touching `username`/`selected_emoji` —
-- role/stat columns are unreachable from the client even though the row
-- itself is "theirs", because column-level and row-level privileges are
-- checked independently.
grant update (username, selected_emoji) on profiles to authenticated;
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

-- One-time-per-login (safe to call anytime, really) merge of a player's
-- locally-tracked stats into their server profile row. Only ever RAISES
-- values (greatest()/or) — never lowers them — so calling this repeatedly,
-- from multiple devices, in any order, can only help: it's how an existing
-- player's pre-existing localStorage progress survives the move to
-- server-authoritative stats instead of silently resetting to zero the
-- first time they log in after this migration. See AuthContext.jsx.
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
begin
  return query
  update profiles set
    best_streak = greatest(profiles.best_streak, p_best_streak),
    total_pushes = greatest(profiles.total_pushes, p_total_pushes),
    -- day_streak and last_played_date are taken together from whichever
    -- side has the more recent last_played_date, rather than maxed
    -- independently — greatest()-ing day_streak alone could pair a big
    -- streak from one device with a newer, unrelated date from another and
    -- fabricate continuity that never actually happened.
    day_streak = case
      when p_last_played_date is not null and (profiles.last_played_date is null or p_last_played_date > profiles.last_played_date)
      then p_day_streak else profiles.day_streak end,
    last_played_date = case
      when p_last_played_date is not null and (profiles.last_played_date is null or p_last_played_date > profiles.last_played_date)
      then p_last_played_date else profiles.last_played_date end,
    busted_at_zero = profiles.busted_at_zero or p_busted_zero,
    busted_at_one = profiles.busted_at_one or p_busted_one
  where id = p_user_id
  returning best_streak, total_pushes, day_streak, last_played_date, busted_at_zero, busted_at_one;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function public.merge_local_stats from public, anon, authenticated;
grant execute on function public.merge_local_stats to service_role;
