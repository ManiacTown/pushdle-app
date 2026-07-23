// Vercel Cron endpoint — see vercel.json's `crons` entry, which hits this
// once a day. Runs the exact same logic as scripts/simulate-bot-day.mjs
// (shared via lib/bot-day-sim.mjs), just triggered by Vercel's own
// scheduler instead of a person running the script by hand. This replaced
// an earlier plan to use Windows Task Scheduler on a local machine —
// running server-side means it fires regardless of whether any particular
// computer happens to be on at the time.
//
// SB_URL and SB_SERVICE_KEY need to be set as plain (non-VITE_-prefixed)
// environment variables in the Vercel project — VITE_ vars get bundled
// into the client-side JS at build time, which would leak the service
// role key to every visitor's browser. These are server-only, read here
// at request time, never shipped to the client.
//
// CRON_SECRET is a Vercel-specific convention: set it as an env var and
// Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when
// invoking this endpoint on schedule, which lets it reject any other
// caller who finds/hits this URL directly. Optional but recommended —
// the simulation itself is idempotent per bot per day either way, so a
// stray unauthorized call couldn't do more than a wasted duplicate
// no-op, but there's no reason to leave it open to the public.

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
