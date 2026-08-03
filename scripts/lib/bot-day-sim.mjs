// The actual "simulate every bot's real run for today" logic — shared by
// the manual CLI script (scripts/simulate-bot-day.mjs, for running it by
// hand) and the GitHub Actions-triggered endpoint (api/simulate-bot-day.js,
// for running it automatically every day — see that file's header for why
// this is polled by GitHub Actions rather than Vercel Cron directly). Kept
// in exactly one place so both callers can never drift out of sync with
// each other.
//
// Runs BOTH classic mode (simulateBot, real resolve_push rolls) and money
// mode (simulateMoneyBot, real resolve_money_push/resolve_money_cashout
// rolls) for every bot that's "unlocked" for the day so far — see
// unlockedCountNow below for what that means and why.

import { pacificDateString, msUntilNextPacificMidnight } from '../../src/lib/pacificDate.js';

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

// Instead of releasing all bots the instant Pacific midnight hits, the
// roster unlocks in waves: the first INITIAL_BOT_COUNT go the moment this
// is first called after midnight, then BOTS_PER_WAVE more every
// WAVE_INTERVAL_MINUTES after that, until the whole roster's unlocked.
// Self-paced off the real elapsed-since-Pacific-midnight clock (see
// unlockedCountNow) rather than a batch index passed in by the caller —
// that means however often (or irregularly) something polls this, the
// release schedule comes out the same either way, and it's naturally
// DST-safe for free (no dual-schedule trick needed, unlike the old
// fixed-UTC-hour cron entries this replaced — see api/simulate-bot-day.js).
const INITIAL_BOT_COUNT = 10;
const BOTS_PER_WAVE = 2;
const WAVE_INTERVAL_MINUTES = 15;

// How many bots (by fixed roster order — see src/lib/bots.js's own
// never-reorder rule, which is exactly what makes "first N" a stable,
// meaningful slice here) are eligible to have run today AS OF RIGHT NOW.
// Bots already simulated are skipped downstream regardless (see
// simulateBot/simulateMoneyBot's own "already done" checks) — this just
// caps how far into the roster a given call is allowed to reach.
function unlockedCountNow(totalBots, now = new Date()) {
  const elapsedMs = 86400000 - msUntilNextPacificMidnight(now);
  const elapsedMinutes = elapsedMs / 60000;
  if (elapsedMinutes < 0) return 0; // clock skew guard, shouldn't happen
  const waves = Math.floor(elapsedMinutes / WAVE_INTERVAL_MINUTES);
  return Math.min(totalBots, INITIAL_BOT_COUNT + waves * BOTS_PER_WAVE);
}

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
    const twoDaysAgo = pacificDateString(new Date(Date.now() - 2 * 86400000));
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

// Money-mode counterpart to simulateBot above — same "call the real RPC
// repeatedly, let Postgres's own random() drive every roll" approach, just
// against resolve_money_push/resolve_money_cashout instead of resolve_push
// (see money-push/money-cashout Edge Functions and MoneyMode.jsx for the
// player-facing version of the same two calls). Every bot picks one of two
// strategies for the day — "greedy" (push toward a bust, banks nothing) or
// "banker" (push toward a modest cash-out target) — split roughly 50/50 by
// a hash of (user, date), landing on the "roughly half $0 busts, roughly
// half $5-35 banked runs" spread this was asked for.
//
// Deliberately NOT forced to guarantee that exact split though: a banker
// aiming high in its $5-35 range still has real bust risk along the way
// (95%-per-push survival compounds fast — reaching $35 typically takes
// 20+ pushes, whose combined survival odds are well under 50%), and a
// bust there is left as a genuine bust, not retried away. The alternative
// (delete-and-retry until the roll cooperates, mirroring simulateBot's own
// zero-bust retry above) would mean fabricating a guaranteed outcome
// instead of ever accepting a real one — exactly the "client/script decides
// the result instead of the dice" shape this codebase has otherwise been
// careful to avoid (see DECISIONS.md's stat-tampering incident writeup).
// "Roughly half" tolerates the resulting slop; a guaranteed-exact split
// would not have been an honest roll.
// Hard ceiling on what any single bot can walk away with in one day, either
// strategy — the shared source of truth both MONEY_BANKER_TARGET_RANGE_CENTS
// below and the greedy loop's own earnings check derive from, so the two
// strategies can't quietly drift apart from each other. The loop below
// breaks the moment earnings CROSS this (not before), so an individual
// push's bonus can carry a run slightly past it — same "roughly," not
// pedantically exact, tolerance this file already applies to the banker
// target split above, not a new inconsistency.
const MONEY_BOT_MAX_DAILY_CENTS = 1500; // $15
const MONEY_BANKER_TARGET_MIN_CENTS = 300; // $3
const MONEY_BANKER_TARGET_RANGE_CENTS = MONEY_BOT_MAX_DAILY_CENTS - MONEY_BANKER_TARGET_MIN_CENTS; // up to $15 total
// Greedy bots are capped well short of MONEY_BOT_MAX_DAILY_CENTS unbanked —
// the earnings check inside the loop below stops pushing (and cashes out)
// the instant earnings reach the cap, same shape as a banker hitting its
// own target — so a bust here can never trigger the legendary "Too Greedy"
// badge either (unlike most legendary badges, which they ARE allowed to
// earn naturally, e.g. via money-lifetime/money-run thresholds reached over
// many real days). The push-count cap below is now just a secondary safety
// bound on run length, not the thing actually limiting earnings.
const MONEY_GREEDY_PUSH_CAP = 40;
// Generous safety net for banker bots, not a real exposure path — the
// target-reached check inside the loop below stops pushing (and cashes
// out) the instant earnings cross the $5-35 target, so a banker's
// unbanked total while still at bust risk never realistically approaches
// this cap. It exists purely to bound worst-case run length/cost.
const MONEY_BANKER_PUSH_CAP = 80;

// A small FNV-1a-style string hash, mapped to [0, 1) — used only to decide
// which STRATEGY a bot pursues today (and its target, for bankers), not
// any actual game outcome (those stay fully server-random via
// resolve_money_push/resolve_money_cashout). Deterministic on purpose: if
// an earlier call for today crashed mid-run (money_runs row left at
// status='playing' with pushes>0), the next call resumes with the SAME
// strategy/target instead of switching horses mid-run.
function hashUnit(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000000) / 1000000;
}

async function simulateMoneyBot(api, today, username, userId) {
  const [existing] = await api(`/rest/v1/money_runs?user_id=eq.${userId}&date=eq.${today}&select=status,pushes`);
  if (existing && existing.status !== 'playing') {
    return { username, status: 'skipped', reason: 'already simulated today' };
  }

  const greedy = hashUnit(`${userId}:${today}:strategy`) < 0.5;
  // Squaring a uniform draw biases it toward 0 — most banker attempts land
  // on an easily-reachable low target (few pushes, high survival odds),
  // with a long tail up to the full $35 (rarer, real bust risk).
  const biasedUnit = Math.pow(hashUnit(`${userId}:${today}:target`), 2);
  const targetCents = MONEY_BANKER_TARGET_MIN_CENTS + Math.round(biasedUnit * MONEY_BANKER_TARGET_RANGE_CENTS);
  const cap = greedy ? MONEY_GREEDY_PUSH_CAP : MONEY_BANKER_PUSH_CAP;

  async function pushOnce() {
    const [result] = await api('/rest/v1/rpc/resolve_money_push', {
      method: 'POST',
      body: JSON.stringify({ p_user_id: userId, p_date: today }),
    });
    return result;
  }

  // Seeds the cap check for a resumed run (existing.pushes > 0); the loop
  // body always overwrites `last` with a real response before ever reading
  // out_success/out_status off it, so the placeholder's status ('playing',
  // matching what we just confirmed above) is only actually read if the
  // loop body never runs at all — i.e. a resume that had already reached
  // its cap last time.
  let last = { out_pushes: existing?.pushes ?? 0, out_status: 'playing' };
  while (last.out_pushes < cap) {
    last = await pushOnce();
    if (!last.out_success) break; // a real bust — never forced/retried
    if (greedy && last.out_earnings_cents >= MONEY_BOT_MAX_DAILY_CENTS) break; // hit the daily ceiling, go bank it
    if (!greedy && last.out_earnings_cents >= targetCents) break; // hit target, go bank it
  }

  if (last.out_status !== 'playing') {
    return { username, status: 'ok', outcome: 'busted', pushes: last.out_pushes, earningsCents: 0 };
  }

  // Survived to its target (banker) or rode out the safety cap without
  // busting (a lucky greedy bot) — either way, a real cash-out.
  const [cashout] = await api('/rest/v1/rpc/resolve_money_cashout', {
    method: 'POST',
    body: JSON.stringify({ p_user_id: userId, p_date: today }),
  });
  return { username, status: 'ok', outcome: 'banked', pushes: last.out_pushes, earningsCents: cashout.out_earnings_cents };
}

export async function simulateAllBots({ url, serviceKey, botUserIds }) {
  const api = makeApi(url, serviceKey);
  const today = pacificDateString();
  const entries = Object.entries(botUserIds);
  const unlocked = entries.slice(0, unlockedCountNow(entries.length));
  const results = [];
  for (const [username, userId] of unlocked) {
    try {
      results.push({ mode: 'classic', ...(await simulateBot(api, today, username, userId)) });
    } catch (err) {
      results.push({ mode: 'classic', username, status: 'error', error: err.message });
    }
    try {
      results.push({ mode: 'money', ...(await simulateMoneyBot(api, today, username, userId)) });
    } catch (err) {
      results.push({ mode: 'money', username, status: 'error', error: err.message });
    }
  }
  return results;
}
