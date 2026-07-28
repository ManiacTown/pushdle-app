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
    // completed_at (not merely "does a row for this week_start exist") is
    // the real idempotency signal — see that column's own comment in
    // schema.sql. A row with completed_at still null means an EARLIER
    // attempt claimed this week but didn't finish (some step failed
    // partway through); this run should RESUME it, not treat the row's
    // mere existence as "already done" and skip the rest forever.
    const existing = await api(url, serviceKey, `/rest/v1/money_weekly_resets?week_start=eq.${weekStart}&select=top3,completed_at`);
    let top3Snapshot = null;
    if (existing.length > 0) {
      if (existing[0].completed_at) {
        return res.status(200).json({ status: 'already ran this week', weekStart });
      }
      // Row exists, unfinished. If top3 is ALSO already set, a previous
      // attempt got at least that far before failing — reuse it rather
      // than re-deriving from profiles.money_weekly_cents below, which
      // may already have been zeroed by that same earlier attempt (if IT
      // got as far as the reset step before whatever failed) and would
      // otherwise silently snapshot an empty/wrong top3 on this retry.
      top3Snapshot = existing[0].top3 ?? null;
    } else {
      // Claim it. A 409 here means the OTHER DST cron slot (or a manual
      // retry) is claiming the exact same week concurrently — treat that
      // the same as "found an unfinished row" above and fall through to
      // resume/redo, rather than erroring out. Every step below is safe
      // to run more than once (badge grants are a plain boolean OR, the
      // snapshot/reset PATCHes just overwrite with the same-shape data),
      // so two processes momentarily racing here can't corrupt anything —
      // only the final completed_at write actually has to win exactly once,
      // and a plain overwrite handles that fine either way.
      const insertRes = await fetch(`${url}/rest/v1/money_weekly_resets`, {
        method: 'POST',
        headers: serviceHeaders(serviceKey, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ week_start: weekStart }),
      });
      if (!insertRes.ok && insertRes.status !== 409) {
        const text = await insertRes.text();
        throw new Error(`money_weekly_resets insert -> ${insertRes.status}: ${text}`);
      }
    }

    if (!top3Snapshot) {
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
      top3Snapshot = top3.map((r) => ({
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
    }

    // Only touches rows that actually have something to reset — a no-op,
    // not an error, if a previous attempt already got this far.
    await api(url, serviceKey, '/rest/v1/profiles?money_weekly_cents=gt.0', {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ money_weekly_cents: 0 }),
    });

    // The real "this week is done" signal (see completed_at's own comment
    // in schema.sql) — written last, only once everything above has
    // actually succeeded. Anything that throws before this point leaves
    // completed_at null, so the next run (the other DST cron slot, or a
    // manual retry) resumes instead of skipping the rest forever.
    await api(url, serviceKey, `/rest/v1/money_weekly_resets?week_start=eq.${weekStart}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ completed_at: new Date().toISOString() }),
    });

    return res.status(200).json({ status: 'reset complete', weekStart, top3: top3Snapshot });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
