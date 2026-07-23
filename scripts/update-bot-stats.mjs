// One-time (re-runnable) update: regenerates every existing bot's lifetime
// stats using the current generateStats formula (see bot-stats.mjs) and
// PATCHes their already-created profiles rows — no account
// creation/deletion involved, just refreshing the numbers in place.
//
// Run with:
//   SB_URL=<supabase url> SB_SERVICE_KEY=<service_role key> node scripts/update-bot-stats.mjs

import { BOT_USER_IDS } from '../src/lib/bots.js';
import { generateStats } from './bot-stats.mjs';

const url = process.env.SB_URL;
const serviceKey = process.env.SB_SERVICE_KEY;
if (!url || !serviceKey) {
  console.error('Set SB_URL and SB_SERVICE_KEY env vars first.');
  process.exit(1);
}

for (const [username, id] of Object.entries(BOT_USER_IDS)) {
  const stats = generateStats(username);
  const res = await fetch(`${url}/rest/v1/profiles?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      best_streak: stats.bestStreak,
      total_pushes: stats.totalPushes,
      day_streak: stats.dayStreak,
      busted_at_zero: stats.bustedAtZero,
      busted_at_one: stats.bustedAtOne,
      selected_emoji: stats.selectedEmoji,
    }),
  });
  if (!res.ok) {
    console.error(`FAILED: ${username}:`, res.status, await res.text());
    continue;
  }
  console.log(
    `updated: ${username} (best ${stats.bestStreak}, pushes ${stats.totalPushes}, days ${stats.dayStreak}, badges ${stats.earnedCount})`
  );
}
