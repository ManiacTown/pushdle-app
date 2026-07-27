// Vercel Cron endpoint — see vercel.json's two `crons` entries hitting
// this endpoint (Monday 7am AND 8am UTC), same DST-safe dual-schedule
// reasoning as api/simulate-bot-day.js: Pacific midnight moves between
// those two UTC hours across the DST transition, so two static entries
// cover both rather than trying to keep one schedule hand-synced with DST
// twice a year. Idempotency lives in the handler (an insert into
// money_weekly_resets either succeeds once or hits a unique violation),
// not a wall-clock "is it exactly Monday midnight" check — same pattern
// the daily bot-seeding cron already established.
//
// Does three things once per Pacific week: snapshots whoever is in the top
// 3 by money_weekly_cents into a permanent money_reached_top3_weekly flag
// (see game.js's "Golden Goose" badge — live rank isn't a stable thing to
// derive a badge from, so this is the one moment that rank gets turned
// into something permanent); writes that same top 3 (username/emoji/score
// AS OF right now) into this week's money_weekly_resets row, which is what
// Leaderboard.jsx's "last week's champions" podium reads back; then resets
// money_weekly_cents to 0 for the new week.
//
// SB_URL/SB_SERVICE_KEY/CRON_SECRET — same env vars, same reasoning, as
// api/simulate-bot-day.js.

import { pacificWeekStartString } from '../src/lib/pacificDate.js';

function serviceHeaders(serviceKey, extra = {}) {
  return { 'Content-Type': 'application/json', apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, ...extra };
}

async function api(url, serviceKey, path, opts = {}) {
  const res = await fetch(`${url}${path}`, { ...opts, headers: serviceHeaders(serviceKey, opts.headers) });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`);
  return data;
}

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

  const weekStart = pacificWeekStartString();

  try {
    // Whichever of the two scheduled calls lands first claims this week's
    // reset by successfully inserting; the other gets a 409 (unique
    // violation on week_start) and no-ops here instead of double-granting
    // Golden Goose or double-resetting everyone's weekly total.
    const insertRes = await fetch(`${url}/rest/v1/money_weekly_resets`, {
      method: 'POST',
      headers: serviceHeaders(serviceKey, { Prefer: 'return=minimal' }),
      body: JSON.stringify({ week_start: weekStart }),
    });
    if (insertRes.status === 409) {
      return res.status(200).json({ status: 'already ran this week', weekStart });
    }
    if (!insertRes.ok) {
      const text = await insertRes.text();
      throw new Error(`money_weekly_resets insert -> ${insertRes.status}: ${text}`);
    }

    const top3 = await api(
      url,
      serviceKey,
      '/rest/v1/profiles?money_weekly_cents=gt.0&order=money_weekly_cents.desc&limit=3&select=id,username,selected_emoji,money_weekly_cents'
    );
    for (const { id } of top3) {
      await api(url, serviceKey, `/rest/v1/profiles?id=eq.${id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ money_reached_top3_weekly: true }),
      });
    }

    // Snapshotted now (username/emoji as of THIS moment), not looked up
    // live later — see top3's own column comment in schema.sql for why.
    const top3Snapshot = top3.map((r) => ({
      userId: r.id,
      username: r.username,
      emoji: r.selected_emoji,
      scoreCents: r.money_weekly_cents,
    }));
    await api(url, serviceKey, `/rest/v1/money_weekly_resets?week_start=eq.${weekStart}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ top3: top3Snapshot }),
    });

    // Only touches rows that actually have something to reset.
    await api(url, serviceKey, '/rest/v1/profiles?money_weekly_cents=gt.0', {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ money_weekly_cents: 0 }),
    });

    return res.status(200).json({ status: 'reset complete', weekStart, top3: top3Snapshot });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
