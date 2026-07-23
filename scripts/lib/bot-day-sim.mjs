// The actual "simulate every bot's real run for today" logic — shared by
// the manual CLI script (scripts/simulate-bot-day.mjs, for running it by
// hand) and the Vercel Cron endpoint (api/simulate-bot-day.js, for running
// it automatically every day) — see the CLI script's own header comment
// for the full explanation of *why* this exists (real daily_runs rows via
// the actual resolve_push function, instead of the old client-side-only
// simulation). Kept in exactly one place so both callers can never drift
// out of sync with each other.

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

function makeApi(url, serviceKey) {
  return async function api(path, opts = {}) {
    const res = await fetch(`${url}${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...(opts.headers || {}) },
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`);
    return data;
  };
}

async function simulateBot(api, today, username, userId) {
  const existingRun = await api(`/rest/v1/daily_runs?user_id=eq.${userId}&date=eq.${today}&select=id`);
  if (existingRun?.length) {
    return { username, status: 'skipped', reason: 'already simulated today' };
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

  async function pushOnce() {
    const [result] = await api('/rest/v1/rpc/resolve_push', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: userId, p_date: today }),
    });
    return result;
  }

  for (let attempt = 0; attempt < MAX_ZERO_BUST_RETRIES; attempt++) {
    let last = null;
    let pushes = 0;
    while (pushes < BEST_STREAK_SAFETY_CAP) {
      last = await pushOnce();
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

    return { username, status: 'ok', streak: last.out_streak, pushes };
  }
  return { username, status: 'zero-bust-retry-limit' };
}

export async function simulateAllBots({ url, serviceKey, botUserIds }) {
  const api = makeApi(url, serviceKey);
  const today = new Date().toISOString().slice(0, 10);
  const results = [];
  for (const [username, userId] of Object.entries(botUserIds)) {
    try {
      results.push(await simulateBot(api, today, username, userId));
    } catch (err) {
      results.push({ username, status: 'error', error: err.message });
    }
  }
  return results;
}
