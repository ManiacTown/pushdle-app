// One-time (re-runnable for newly-added bots) setup script: gives every
// name in BOT_USERNAMES a real auth.users + profiles row with plausible
// *lifetime* stats, so clicking a bot on the leaderboard opens a real
// profile instead of doing nothing. "Today's" streak is deliberately NOT
// stored here — bots.js computes that live, the same deterministic way the
// leaderboard itself does, so it can never drift out of sync with what the
// leaderboard shows (see BOT_USER_IDS/getBotTodayStreak in bots.js).
//
// Run with:
//   SB_URL=<supabase url> SB_SERVICE_KEY=<service_role key> node scripts/seed-bots.mjs
//
// Safe to re-run: skips any username that already has a profiles row
// (e.g. after adding new names to BOT_USERNAMES later).

import { BOT_USERNAMES } from '../src/lib/bots.js';
import { generateStats } from './bot-stats.mjs';

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

const idMap = {};
for (const username of BOT_USERNAMES) {
  try {
    // Skip if this username already has a real profile (idempotent re-runs).
    const existing = await api(`/rest/v1/profiles?username=eq.${encodeURIComponent(username)}&select=id`);
    if (existing?.length) {
      idMap[username] = existing[0].id;
      console.log(`skip (exists): ${username} -> ${existing[0].id}`);
      continue;
    }

    const stats = generateStats(username);
    const email = `bot-${username.toLowerCase()}@bots.pushdle.internal`;
    const created = await api('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password: crypto.randomUUID(),
        email_confirm: true,
        user_metadata: { username },
      }),
    });

    await api(`/rest/v1/profiles?id=eq.${created.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        best_streak: stats.bestStreak,
        total_pushes: stats.totalPushes,
        day_streak: stats.dayStreak,
        busted_at_zero: stats.bustedAtZero,
        busted_at_one: stats.bustedAtOne,
        selected_emoji: stats.selectedEmoji,
      }),
    });

    idMap[username] = created.id;
    console.log(
      `created: ${username} -> ${created.id} (best ${stats.bestStreak}, pushes ${stats.totalPushes}, days ${stats.dayStreak}, badges ${stats.earnedCount}, flair ${stats.selectedEmoji ?? 'none'})`
    );
  } catch (err) {
    console.error(`FAILED: ${username}:`, err.message);
  }
}

console.log('\n--- paste into bots.js as BOT_USER_IDS ---\n');
console.log(JSON.stringify(idMap, null, 2));
