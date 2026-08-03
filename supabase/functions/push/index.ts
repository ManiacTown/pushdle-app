// Server-authoritative push roll. The client never sends (or knows) the
// outcome in advance — it just asks "I pushed", and this function looks up
// its own record of that user's run, rolls, and reports what happened.
// That's what makes daily_runs.streak trustworthy as a leaderboard score;
// see the schema.sql header and DECISIONS.md for why.
//
// Deploy with: supabase functions deploy push

import { createServiceClient, handlePreflight, json, pacificDateString, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();
  const today = pacificDateString();

  // The get-or-create, dead-check, roll, and write all happen atomically
  // inside this one Postgres function (row-locked via `select ... for
  // update`) — see schema.sql's resolve_push for why that matters: doing
  // it as separate read-then-write calls here had a real race where two
  // concurrent requests could both read the row before either write
  // landed and both score as a free success.
  const { data, error } = await db
    .rpc('resolve_push', { p_user_id: user.id, p_date: today })
    .single();
  if (error) return json({ error: error.message }, 500);

  // out_success is also false if the run was already dead before this
  // call (e.g. a stale tab after busting elsewhere) — the client treats
  // that the same as busting just now, which self-heals its local state
  // to match the server instead of silently doing nothing.
  return json({
    success: data.out_success,
    streak: data.out_streak,
    bestStreak: data.out_best_streak,
    totalPushes: data.out_total_pushes,
    dayStreak: data.out_day_streak,
    bustedAtZero: data.out_busted_at_zero,
    bustedAtOne: data.out_busted_at_one,
    pityCount: data.out_pity_count,
    boosted: data.out_boosted,
  });
});
