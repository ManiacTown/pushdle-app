// Merges a BRAND-NEW signup's locally-tracked stats (best streak, total
// pushes, day streak, the two bust flags — all historically localStorage
// only, even for logged-in accounts) into their server profile row, so
// pre-account progress isn't silently lost the moment stats become
// server-authoritative. schema.sql's merge_local_stats now makes this a
// one-time thing per account (see stats_migrated there) — past that first
// real merge there's nothing legitimate left to fold in.
//
// Until 2026-07-24 this trusted the request body outright and could be
// called any number of times, which is exactly how one account forged a
// best_streak in the hundreds of millions: nothing stopped a logged-in
// user from calling this Edge Function directly (skipping the game
// entirely) with a hand-crafted body. The bounds check below and the
// RPC's own one-time/clamping logic are deliberately redundant (defense
// in depth) — either layer alone now closes the hole, but both catch it.
//
// Deploy with: supabase functions deploy sync-stats

import { createServiceClient, handlePreflight, json, requireUser } from '../_shared/utils.ts';

// Generous but bounded — no genuine local-play scenario before an account
// even exists should be anywhere near this many pushes or that long a streak.
const MAX_TOTAL_PUSHES = 100_000;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));

  const rawBestStreak = Number(body.bestStreak);
  const rawTotalPushes = Number(body.totalPushes);
  const rawDayStreak = Number(body.dayStreak);
  const bestStreak = Number.isFinite(rawBestStreak) ? rawBestStreak : 0;
  const totalPushes = Number.isFinite(rawTotalPushes) ? rawTotalPushes : 0;
  const dayStreak = Number.isFinite(rawDayStreak) ? rawDayStreak : 0;

  // A streak can never exceed the total pushes it took to build it — any
  // payload violating that, or claiming an implausible magnitude, is
  // rejected outright rather than silently clamped, so a forged attempt
  // shows up as a clear error instead of quietly no-op'ing.
  if (
    bestStreak < 0 || totalPushes < 0 || dayStreak < 0 ||
    totalPushes > MAX_TOTAL_PUSHES || bestStreak > totalPushes
  ) {
    return json({ error: 'implausible stats payload' }, 400);
  }

  // Optional — only present when the caller (AuthContext.jsx) still has a
  // guest run for TODAY specifically, either still in progress OR already
  // busted (see storage.js's getTodayState). Carries it into a real
  // daily_runs row so logging in mid-run doesn't reset it to 0, and so a
  // guest who busts and THEN signs up still shows up on today's
  // leaderboard for that run instead of it just vanishing (see
  // schema.sql's merge_local_stats, which is what actually applies this —
  // only ever when no row already exists for that user+date, so this
  // can't inflate/overwrite an existing real run). Same "reject outright
  // rather than silently clamp" posture as the stats above, plus the same
  // "can't exceed total pushes" logic — every push in today's streak is
  // also counted in totalPushes.
  let todayStreak = null;
  let todayDate = null;
  let todayStatus = null;
  if (body.todayStreak != null || body.todayDate != null || body.todayStatus != null) {
    const rawTodayStreak = Number(body.todayStreak);
    if (
      typeof body.todayDate !== 'string' ||
      (body.todayStatus !== 'playing' && body.todayStatus !== 'dead') ||
      !Number.isFinite(rawTodayStreak) ||
      rawTodayStreak < 0 ||
      rawTodayStreak > totalPushes
    ) {
      return json({ error: 'implausible today-run payload' }, 400);
    }
    todayStreak = rawTodayStreak;
    todayDate = body.todayDate;
    todayStatus = body.todayStatus;
  }

  const db = createServiceClient();

  const { data, error } = await db
    .rpc('merge_local_stats', {
      p_user_id: user.id,
      p_best_streak: bestStreak,
      p_total_pushes: totalPushes,
      p_day_streak: dayStreak,
      p_last_played_date: body.lastPlayedDate ?? null,
      p_busted_zero: !!body.bustedAtZero,
      p_busted_one: !!body.bustedAtOne,
      p_today_date: todayDate,
      p_today_streak: todayStreak,
      p_today_status: todayStatus,
    })
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({
    bestStreak: data.out_best_streak,
    totalPushes: data.out_total_pushes,
    dayStreak: data.out_day_streak,
    lastPlayedDate: data.out_last_played_date,
    bustedAtZero: data.out_busted_at_zero,
    bustedAtOne: data.out_busted_at_one,
  });
});
