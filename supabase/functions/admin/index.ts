// Admin-only dev tools that need to actually mutate a real daily_runs row —
// force_bust and reset_day. The role check is the whole point of this
// function: it looks up the CALLER's own profiles.role server-side, never
// trusting anything the client claims about itself.
//
// Deploy with: supabase functions deploy admin

import { createServiceClient, handlePreflight, isAdmin, json, pacificDateString, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();
  if (!(await isAdmin(db, user.id))) {
    return json({ error: 'forbidden' }, 403);
  }

  const { action } = await req.json().catch(() => ({}));
  const today = pacificDateString();

  if (action === 'force_bust') {
    let { data: run } = await db
      .from('daily_runs')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle();

    if (!run) {
      const { data } = await db
        .from('daily_runs')
        .insert({ user_id: user.id, date: today, streak: 0, status: 'playing' })
        .select()
        .single();
      run = data;
    }
    if (run.status === 'dead') {
      return json({ error: 'already busted today', streak: run.streak }, 409);
    }

    await db.from('daily_runs').update({ status: 'dead' }).eq('id', run.id);

    // Counts toward real stats/badges on purpose — admin mode here is only
    // ever the developer testing (see Home.jsx's bust()), not a way for a
    // real player to cheese badges. The client's bust() needs the full
    // stats shape back (same as a real push response) so it can update its
    // badge-diffing state from the server instead of falling back to
    // localStorage, which is no longer authoritative for logged-in users.
    const { data: profile } = await db
      .from('profiles')
      .select('best_streak, total_pushes, day_streak, busted_at_zero, busted_at_one')
      .eq('id', user.id)
      .single();
    const bustedAtZero = profile.busted_at_zero || run.streak === 0;
    const bustedAtOne = profile.busted_at_one || run.streak === 1;
    if (bustedAtZero !== profile.busted_at_zero || bustedAtOne !== profile.busted_at_one) {
      await db.from('profiles').update({ busted_at_zero: bustedAtZero, busted_at_one: bustedAtOne }).eq('id', user.id);
    }

    return json({
      success: true,
      streak: run.streak,
      bestStreak: profile.best_streak,
      totalPushes: profile.total_pushes,
      dayStreak: profile.day_streak,
      bustedAtZero,
      bustedAtOne,
    });
  }

  if (action === 'reset_day') {
    await db.from('daily_runs').delete().eq('user_id', user.id).eq('date', today);
    return json({ success: true });
  }

  // Dev tools below mirror what the client already does to its own
  // localStorage for guests (see Home.jsx) — these exist so the same
  // buttons work for a logged-in admin now that those stats live server-side.

  if (action === 'reset_best_streak') {
    await db.from('profiles').update({ best_streak: 0 }).eq('id', user.id);
    return json({ success: true, bestStreak: 0 });
  }

  if (action === 'reset_badges') {
    await db
      .from('profiles')
      .update({
        best_streak: 0,
        total_pushes: 0,
        day_streak: 0,
        last_played_date: null,
        busted_at_zero: false,
        busted_at_one: false,
      })
      .eq('id', user.id);
    return json({
      success: true,
      bestStreak: 0,
      totalPushes: 0,
      dayStreak: 0,
      lastPlayedDate: null,
      bustedAtZero: false,
      bustedAtOne: false,
    });
  }

  if (action === 'claim_all_badges') {
    await db
      .from('profiles')
      .update({
        best_streak: 100,
        total_pushes: 1000,
        day_streak: 100,
        last_played_date: today,
        busted_at_zero: true,
        busted_at_one: true,
      })
      .eq('id', user.id);
    return json({
      success: true,
      bestStreak: 100,
      totalPushes: 1000,
      dayStreak: 100,
      lastPlayedDate: today,
      bustedAtZero: true,
      bustedAtOne: true,
    });
  }

  return json({ error: 'unknown action' }, 400);
});
