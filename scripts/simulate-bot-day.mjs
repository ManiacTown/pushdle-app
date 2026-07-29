// Generates each bot's "today" run for real, instead of the old
// client-side-only simulation (see the git history of lib/bots.js —
// getBotLeaderboard/getBotTodayStreak used to derive "today's streak" from
// hash(username+date) fed into a PRNG, entirely in the browser, never
// touching the database). That had two problems: it was fake in a way
// that didn't need to be (the lifetime profiles stats are already real),
// and the deterministic hash-seed let the *same* bot end up correlating
// with "wins the leaderboard" more than chance alone would explain.
//
// This calls the exact same server-side resolve_push/resolve_money_push/
// resolve_money_cashout Postgres functions the real push/money-push/
// money-cashout Edge Functions use, repeatedly, until each bot busts (or,
// for money mode, cashes out) — so Postgres's own random() drives every
// roll (no seed, no correlation), and the resulting daily_runs/money_runs
// rows and updated profiles stats are completely real, indistinguishable
// from an actual player's run. Idempotent — safe to re-run, already-
// simulated bots (in either mode) are skipped. Only a subset of the
// roster is eligible to run on any given call — see bot-day-sim.mjs's
// unlockedCountNow for the staggered-release schedule this follows.
//
// This is the manual/local entry point — the actual simulation logic
// lives in lib/bot-day-sim.mjs, shared with api/simulate-bot-day.js (the
// endpoint a GitHub Actions workflow polls every 15 minutes to run this
// automatically). Run this one by hand whenever you want to trigger a
// wave outside that schedule.
//
// Run with:
//   SB_URL=<supabase url> SB_SERVICE_KEY=<service_role key> node scripts/simulate-bot-day.mjs

import { BOT_USER_IDS } from '../src/lib/bots.js';
import { simulateAllBots } from './lib/bot-day-sim.mjs';

const url = process.env.SB_URL;
const serviceKey = process.env.SB_SERVICE_KEY;
if (!url || !serviceKey) {
  console.error('Set SB_URL and SB_SERVICE_KEY env vars first.');
  process.exit(1);
}

const results = await simulateAllBots({ url, serviceKey, botUserIds: BOT_USER_IDS });
for (const r of results) {
  const tag = `[${r.mode}]`;
  if (r.mode === 'classic' && r.status === 'ok') console.log(`${tag} ${r.username}: streak ${r.streak} today (${r.pushes} pushes)`);
  else if (r.mode === 'money' && r.status === 'ok') console.log(`${tag} ${r.username}: ${r.outcome} — $${(r.earningsCents / 100).toFixed(0)} (${r.pushes} pushes)`);
  else if (r.status === 'skipped') console.log(`${tag} skip (${r.reason}): ${r.username}`);
  else if (r.status === 'error') console.error(`${tag} FAILED: ${r.username}:`, r.error);
  else console.warn(`${tag} ${r.username}: hit the zero-bust retry limit (should be near-impossible) — left as-is`);
}
