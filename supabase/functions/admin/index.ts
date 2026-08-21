// Admin-only dev tools that need to actually mutate a real daily_runs row —
// force_bust and reset_day. The role check is the whole point of this
// function: it looks up the CALLER's own profiles.role server-side, never
// trusting anything the client claims about itself.
//
// Deploy with: supabase functions deploy admin

import { ALLOWED_BADGE_FIELDS, createServiceClient, handlePreflight, isAdmin, json, pacificDateString, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();
  if (!(await isAdmin(db, user.id))) {
    return json({ error: 'forbidden' }, 403);
  }

  const body = await req.json().catch(() => ({}));
  const { action } = body;
  const today = pacificDateString();

  if (action === 'force_bust') {
    // Counts toward real stats/badges on purpose — admin mode here is only
    // ever the developer testing (see Home.jsx's bust()), not a way for a
    // real player to cheese badges. The client's bust() needs the full
    // stats shape back (same as a real push response) so it can update its
    // badge-diffing state from the server instead of falling back to
    // localStorage, which is no longer authoritative for logged-in users.
    //
    // Fetched up front (not after the bust, like the rest of this stats
    // read used to be) because the new-run insert below needs pity_count
    // in hand to set boosted correctly, same as resolve_push's own real-
    // push path — otherwise an admin who'd just armed the boost via
    // pity_add_charge and then Force Busts before any real push that day
    // would get a fresh run silently defaulting to boosted: false.
    const { data: profile } = await db
      .from('profiles')
      .select('best_streak, total_pushes, day_streak, busted_at_zero, busted_at_one, pity_count')
      .eq('id', user.id)
      .single();

    let { data: run } = await db
      .from('daily_runs')
      .select('*')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle();

    if (!run) {
      const { data } = await db
        .from('daily_runs')
        .insert({ user_id: user.id, date: today, streak: 0, status: 'playing', boosted: profile.pity_count >= 3 })
        .select()
        .single();
      run = data;
    }
    if (run.status === 'dead') {
      return json({ error: 'already busted today', streak: run.streak }, 409);
    }

    await db.from('daily_runs').update({ status: 'dead' }).eq('id', run.id);

    const bustedAtZero = profile.busted_at_zero || run.streak === 0;
    const bustedAtOne = profile.busted_at_one || run.streak === 1;

    // Comeback Boost pity update (see resolve_push in schema.sql, the
    // real player-facing path this otherwise entirely bypasses) — without
    // this, testing the meter via Force Bust would never move it.
    let pityCount = profile.pity_count;
    if (run.boosted) {
      pityCount = 0;
    } else if (run.streak <= 5) {
      pityCount = Math.min(pityCount + 1, 3);
    }

    await db
      .from('profiles')
      .update({ busted_at_zero: bustedAtZero, busted_at_one: bustedAtOne, pity_count: pityCount })
      .eq('id', user.id);

    return json({
      success: true,
      streak: run.streak,
      bestStreak: profile.best_streak,
      totalPushes: profile.total_pushes,
      dayStreak: profile.day_streak,
      bustedAtZero,
      bustedAtOne,
      pityCount,
      boosted: run.boosted,
    });
  }

  if (action === 'reset_day') {
    await db.from('daily_runs').delete().eq('user_id', user.id).eq('date', today);
    return json({ success: true });
  }

  // Money-variant dev tool — same pattern as reset_day, just against
  // money_runs. Deleting (not just resetting status) matters here since
  // resolve_money_push's own "not found" branch is what recreates a fresh
  // playing row on the next push — same as daily_runs' equivalent.
  if (action === 'reset_money_day') {
    await db.from('money_runs').delete().eq('user_id', user.id).eq('date', today);
    return json({ success: true });
  }

  // Money-variant Force Bust — simpler than classic's force_bust since
  // busting a money run never touches profiles at all (see
  // resolve_money_push's own comment on why); just flips status, no stats/
  // badges to recompute. A no-op 409 (not a silent success) if there's no
  // active run, same as classic's own "already busted" guard, so the
  // client can tell the difference between "busted it" and "nothing to bust".
  if (action === 'force_bust_money') {
    const { data: run } = await db
      .from('money_runs')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle();
    if (!run || run.status !== 'playing') {
      return json({ error: 'no active money run' }, 409);
    }
    await db.from('money_runs').update({ status: 'dead' }).eq('id', run.id);
    return json({ success: true });
  }

  // Money-variant dev tool — forces the CURRENT (still-filling) combo
  // bar's cycle to pay out a diamond once it fills, bypassing
  // next_bonus_is_diamond's normal 10% roll (see resolve_money_push and
  // money_runs' own comment on that column). Upserts rather than
  // requiring an existing 'playing' row like force_bust_money does — an
  // admin should be able to set this up BEFORE their first push of the
  // day, not just mid-run.
  if (action === 'force_money_diamond_next') {
    const { data: run } = await db
      .from('money_runs')
      .select('id, status')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle();
    if (run) {
      await db.from('money_runs').update({ next_bonus_is_diamond: true }).eq('id', run.id);
    } else {
      await db.from('money_runs').insert({ user_id: user.id, date: today, next_bonus_is_diamond: true });
    }
    return json({ success: true });
  }

  // Dev tools for testing the shop without grinding real combo-bar rolls
  // for diamonds (see MoneyShop.jsx) — add_diamonds is a plain +1000 on
  // top of whatever's there (so it can be clicked repeatedly to stack up
  // for testing several purchases), drain_diamonds is a hard reset to 0
  // (so "what does an empty wallet look like" is one click away too).
  // Select-then-update rather than an atomic increment — fine for an
  // admin-only dev tool with no concurrent-request concern, unlike the
  // real economy RPCs in schema.sql which all lock the row first.
  if (action === 'add_diamonds') {
    const { data: profile } = await db.from('profiles').select('money_diamonds').eq('id', user.id).single();
    const next = (profile?.money_diamonds ?? 0) + 1000;
    await db.from('profiles').update({ money_diamonds: next }).eq('id', user.id);
    return json({ success: true, diamonds: next });
  }

  if (action === 'drain_diamonds') {
    await db.from('profiles').update({ money_diamonds: 0 }).eq('id', user.id);
    return json({ success: true, diamonds: 0 });
  }

  // Dev tool — re-arms weekly bust insurance on demand instead of waiting
  // for api/weekly-money-reset.js's real Monday reset (see
  // insurance_used_this_week's own comment in schema.sql). Only meaningful
  // once a bust has actually consumed it; harmless to click otherwise.
  if (action === 'reset_insurance') {
    await db.from('profiles').update({ insurance_used_this_week: false }).eq('id', user.id);
    return json({ success: true });
  }

  // Dev tool — adds one Comeback Boost pity charge (see profiles.pity_count/
  // resolve_push in schema.sql), capped at 3 (armed). Real testing
  // otherwise means 3 genuine early busts, one per day — this lets an
  // admin arm it in 3 clicks instead of 3 real days.
  if (action === 'pity_add_charge') {
    const { data: profile } = await db.from('profiles').select('pity_count').eq('id', user.id).single();
    const next = Math.min((profile?.pity_count ?? 0) + 1, 3);
    await db.from('profiles').update({ pity_count: next }).eq('id', user.id);
    return json({ success: true, pityCount: next });
  }

  // Dev tools below mirror what the client already does to its own
  // localStorage for guests (see Home.jsx) — these exist so the same
  // buttons work for a logged-in admin now that those stats live server-side.

  if (action === 'reset_best_streak') {
    await db.from('profiles').update({ best_streak: 0 }).eq('id', user.id);
    return json({ success: true, bestStreak: 0 });
  }

  // Generic on purpose — the client (Home.jsx's adminResetBadges/
  // adminClaimAllBadges) derives exactly which columns to zero/max out
  // straight from src/lib/game.js's BADGES array and sends them as
  // `fields`, rather than this Edge Function hardcoding a threshold list
  // that would silently go stale every time a badge is added.
  //
  // ALLOWED_BADGE_FIELDS (see _shared/utils.ts) is the real gate — an
  // allowlist of exactly the columns a badge threshold actually reads, so
  // these tools can never touch anything else (role, username, wallet
  // balance, etc.) no matter what `fields` contains. This used to be a
  // denylist instead, which failed open (anything NOT explicitly named was
  // permitted) — that's how it ended up missing several money_* columns
  // and best_streak/total_pushes, letting either tool forge arbitrary
  // leaderboard stats. The allowlist fails safe instead: a badge added with
  // a genuinely new field just can't be claimed/reset until that field is
  // added to ALLOWED_BADGE_FIELDS too.
  if (action === 'reset_badges' || action === 'claim_all_badges') {
    const rawFields = body.fields;
    if (!rawFields || typeof rawFields !== 'object') return json({ error: 'missing fields' }, 400);
    const fields = Object.fromEntries(Object.entries(rawFields).filter(([k]) => ALLOWED_BADGE_FIELDS.has(k)));
    if (Object.keys(fields).length === 0) return json({ error: 'no valid fields' }, 400);

    const { error } = await db.from('profiles').update(fields).eq('id', user.id);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  }

  // Broadcasts a Realtime message every open tab is already subscribed to
  // (see src/lib/pwaUpdate.js) — lets an admin force every already-open tab
  // to hard-reload right now instead of waiting on the normal poll/
  // foreground-triggered check. Uses the Realtime broadcast REST endpoint
  // rather than opening a websocket from an Edge Function just to send one
  // message — see https://supabase.com/docs/guides/realtime/broadcast#broadcast-using-the-rest-api.
  // 'app-updates'/'reload' must match the client's channel/event exactly.
  if (action === 'force_reload') {
    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: getServiceRoleKey(),
        Authorization: `Bearer ${getServiceRoleKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages: [{ topic: 'app-updates', event: 'reload', payload: {} }] }),
    });
    if (!res.ok) return json({ error: `broadcast failed: ${res.status}` }, 500);
    return json({ success: true });
  }

  return json({ error: 'unknown action' }, 400);
});
