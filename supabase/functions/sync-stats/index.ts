// Merges a logged-in player's locally-tracked stats (best streak, total
// pushes, day streak, the two bust flags — all historically localStorage
// only, even for logged-in accounts) into their server profile row. Safe
// to call anytime: schema.sql's merge_local_stats only ever raises values,
// never lowers them, so this is what lets an existing player's pre-existing
// local progress survive the move to server-authoritative stats instead of
// silently resetting to zero the first time they log in post-migration.
//
// Deploy with: supabase functions deploy sync-stats

import { createServiceClient, handlePreflight, json, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const body = await req.json().catch(() => ({}));
  const db = createServiceClient();

  const { data, error } = await db
    .rpc('merge_local_stats', {
      p_user_id: user.id,
      p_best_streak: body.bestStreak ?? 0,
      p_total_pushes: body.totalPushes ?? 0,
      p_day_streak: body.dayStreak ?? 0,
      p_last_played_date: body.lastPlayedDate ?? null,
      p_busted_zero: !!body.bustedAtZero,
      p_busted_one: !!body.bustedAtOne,
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
