// Generates each bot's "today" run for real, instead of the old
// client-side-only simulation (see the git history of lib/bots.js —
// getBotLeaderboard/getBotTodayStreak used to derive "today's streak" from
// hash(username+date) fed into a PRNG, entirely in the browser, never
// touching the database). That had two problems: it was fake in a way
// that didn't need to be (the lifetime profiles stats are already real),
// and the deterministic hash-seed let the *same* bot end up correlating
// with "wins the leaderboard" more than chance alone would explain.
//
// This calls the exact same server-side resolve_push Postgres function the
// real push Edge Function uses, repeatedly, until a bot busts — so
// Postgres's own random() drives every roll (no seed, no correlation), and
// the resulting daily_runs row / updated profiles stats are completely
// real, indistinguishable from an actual player's run. Meant to be run
// once a day (idempotent — safe to re-run, already-simulated bots are
// skipped); how you schedule that (cron, Task Scheduler, etc.) is up to
// you, this script doesn't do that part.
//
// Run with:
//   SB_URL=<supabase url> SB_SERVICE_KEY=<service_role key> node scripts/simulate-bot-day.mjs

import { BOT_USER_IDS } from '../src/lib/bots.js';

const url = process.env.SB_URL;
const serviceKey = process.env.SB_SERVICE_KEY;
if (!url || !serviceKey) {
  console.error('Set SB_URL and SB_SERVICE_KEY env vars first.');
  process.exit(1);
}

async function api(path, opts = {}) {
  const res = await fetch(`${url}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...(opts.headers || {}) },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`);
  return data;
}

const today = new Date().toISOString().slice(0, 10);
// Bots forever ineligible for the special streak-100 badge — same idea as
// bot-stats.mjs's `min(bestStreak, 90, totalPushes)` cap, just enforced
// here by simply never rolling past 90 pushes in a single day instead of
// clamping a precomputed number after the fact.
const BEST_STREAK_SAFETY_CAP = 90;
// Real player behavior is "day_streak keeps climbing forever, capped only
// by not missing a day" — bots simulate every single day by design, so
// left alone this would climb forever too, eventually crossing thresholds
// that were explicitly meant to stay out of reach. 30 matches the same
// cap chosen when the lifetime stats were first seeded (bot-stats.mjs).
const DAY_STREAK_CAP = 30;
// Bust-at-zero retries — should resolve almost immediately in practice
// (0.1% chance per attempt), this is just a hard backstop against an
// absurdly unlucky run of bad luck.
const MAX_ZERO_BUST_RETRIES = 5;

async function pushOnce(userId) {
  const [result] = await api('/rest/v1/rpc/resolve_push', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_date: today }),
  });
  return result;
}

async function simulateBot(username, userId) {
  const existingRun = await api(`/rest/v1/daily_runs?user_id=eq.${userId}&date=eq.${today}&select=id`);
  if (existingRun?.length) {
    console.log(`skip (already simulated today): ${username}`);
    return;
  }

  const [snapshot] = await api(
    `/rest/v1/profiles?id=eq.${userId}&select=best_streak,total_pushes,day_streak,last_played_date,busted_at_zero,busted_at_one`
  );

  if (snapshot.day_streak >= DAY_STREAK_CAP) {
    // Force a gap so resolve_push's own "last_played = date - 1 ? +1 : 1"
    // logic naturally resets day_streak to 1 on the first push below — the
    // same way a real player who took a day off would reset, rather than
    // ever writing day_streak directly (that stays exclusively
    // resolve_push's job everywhere else in this codebase).
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    await api(`/rest/v1/profiles?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ last_played_date: twoDaysAgo }),
    });
    snapshot.last_played_date = twoDaysAgo;
  }

  for (let attempt = 0; attempt < MAX_ZERO_BUST_RETRIES; attempt++) {
    let last = null;
    let pushes = 0;
    while (pushes < BEST_STREAK_SAFETY_CAP) {
      last = await pushOnce(userId);
      pushes++;
      if (!last.out_success) break;
    }

    if (last.out_streak === 0 && !last.out_success) {
      // Busted on the very first push — earns the special bust-0 badge,
      // which bots must never be eligible for. Undo the whole attempt
      // (the daily_runs row AND every profile field that first push
      // already touched, not just the bust flag) and try again.
      await api(`/rest/v1/daily_runs?user_id=eq.${userId}&date=eq.${today}`, { method: 'DELETE' });
      await api(`/rest/v1/profiles?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(snapshot),
      });
      continue;
    }

    console.log(`${username}: streak ${last.out_streak} today (${pushes} pushes)`);
    return;
  }
  console.warn(`${username}: hit the zero-bust retry limit (should be near-impossible) — left as-is`);
}

for (const [username, userId] of Object.entries(BOT_USER_IDS)) {
  try {
    await simulateBot(username, userId);
  } catch (err) {
    console.error(`FAILED: ${username}:`, err.message);
  }
}
