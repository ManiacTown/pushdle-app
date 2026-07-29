// Polled by a GitHub Actions scheduled workflow (see
// .github/workflows/simulate-bot-day.yml) every 15 minutes, all day — NOT
// a Vercel Cron job. Vercel Cron's Hobby-plan tier only supports once-a-day
// schedules, which can't drive the staggered bot rollout this needs (10
// bots the moment Pacific midnight hits, then 2 more every 15 minutes —
// see bot-day-sim.mjs's unlockedCountNow). Being polled far more often than
// bots actually unlock is intentional and harmless: this and
// simulateAllBots are both idempotent (an already-simulated bot, in either
// mode, is just skipped), and unlockedCountNow derives how many bots
// SHOULD have run purely from the real elapsed-since-Pacific-midnight
// clock — so however often (or irregularly) this fires, the release
// schedule comes out the same, and DST is handled for free (no dual-
// schedule-entry trick needed anymore, unlike the two-fixed-UTC-hour
// approach this replaced).
//
// Runs the exact same logic as scripts/simulate-bot-day.mjs
// (shared via lib/bot-day-sim.mjs), just triggered automatically instead
// of a person running the script by hand.
//
// SB_URL and SB_SERVICE_KEY need to be set as plain (non-VITE_-prefixed)
// environment variables in the Vercel project — VITE_ vars get bundled
// into the client-side JS at build time, which would leak the service
// role key to every visitor's browser. These are server-only, read here
// at request time, never shipped to the client.
//
// CRON_SECRET: set the same value as a Vercel env var AND a GitHub Actions
// repo secret (see the workflow file) — the workflow sends it as
// `Authorization: Bearer <CRON_SECRET>` on every poll, which lets this
// reject any other caller who finds/hits the URL directly. No longer the
// automatic Vercel-injects-it convention this used to lean on (that only
// applies to actual Vercel Cron jobs, and this isn't one anymore — see the
// header above) — it's manually wired on both ends now, same shared-secret
// idea either way. Optional but recommended — the simulation itself is
// idempotent per bot per day/mode regardless, so a stray unauthorized call
// couldn't do more than a wasted duplicate no-op, but there's no reason to
// leave it open to the public.

import { BOT_USER_IDS } from '../src/lib/bots.js';
import { simulateAllBots } from '../scripts/lib/bot-day-sim.mjs';

export default async function handler(req, res) {
  if (process.env.CRON_SECRET) {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const url = process.env.SB_URL;
  const serviceKey = process.env.SB_SERVICE_KEY;
  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'SB_URL/SB_SERVICE_KEY not configured on the Vercel project' });
  }

  try {
    const results = await simulateAllBots({ url, serviceKey, botUserIds: BOT_USER_IDS });
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
