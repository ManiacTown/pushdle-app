// The site's daily reset boundary is midnight in the Los Angeles timezone —
// not the visitor's own local midnight, and not UTC. Most play happens
// Pacific-anchored, so this is what actually reads as "a new day" rather
// than an arbitrary UTC rollover that used to land mid-afternoon/evening
// for Pacific visitors (and left the leaderboard looking empty/broken for
// hours during prime playing time). Uses the real IANA zone (not a fixed
// UTC-8 offset) so it stays correct across the DST transition instead of
// drifting an hour twice a year.
//
// Mirrored in supabase/functions/_shared/utils.ts for the Deno Edge
// Functions (different runtime, can't share this file directly) — keep
// both in sync if this ever changes. scripts/lib/bot-day-sim.mjs imports
// this file directly instead of duplicating it, since that's plain Node
// ESM with no bundler boundary to cross.
const TIME_ZONE = 'America/Los_Angeles';

// en-CA's date format is YYYY-MM-DD, which is also what Postgres expects
// for a `date` column — no separate reformatting step needed.
export function pacificDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Live "next run in HH:MM:SS" countdown target — Pacific midnight, not the
// visitor's own local midnight. Approximates the day as exactly 24h, which
// is off by an hour on the two DST-transition days a year; harmless here
// since it only affects the displayed countdown text, not the actual reset
// — Home.jsx re-derives the real boundary every second via
// pacificDateString itself, independent of this countdown.
export function msUntilNextPacificMidnight(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hour = get('hour') % 24; // midnight itself sometimes formats as "24"
  const elapsedMs = ((hour * 60 + get('minute')) * 60 + get('second')) * 1000;
  return 86400000 - elapsedMs;
}

// Monday of the current Pacific week, as a YYYY-MM-DD string — powers the
// weekly money leaderboard (Leaderboard.jsx's weekly sub-tab) and its cron
// reset (api/weekly-money-reset.js). Once pacificDateString() above has
// already done the real timezone correction, this is pure calendar-date
// arithmetic on that string — no further TZ math needed, same reasoning
// the rest of this file already relies on. Anchored at UTC noon (not
// midnight) purely so subtracting days can never itself cross a DST
// transition mid-calculation — noon sits nowhere near either transition.
export function pacificWeekStartString(date = new Date()) {
  const todayStr = pacificDateString(date);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' }).format(date);
  const DAYS_SINCE_MONDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const offset = DAYS_SINCE_MONDAY[weekday] ?? 0;
  const [y, m, d] = todayStr.split('-').map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d, 12));
  anchor.setUTCDate(anchor.getUTCDate() - offset);
  return anchor.toISOString().slice(0, 10);
}

// Live "resets in HH:MM:SS" countdown to the NEXT Pacific Monday midnight
// — Leaderboard.jsx's weekly money sub-tab. Same approximate-24h-day
// caveat as msUntilNextPacificMidnight above (off by an hour on the two
// DST-transition days a year, display-only, harmless). Built from that
// same function (today's own remaining time) plus however many full
// extra days stand between today and next Monday — e.g. on a Monday
// itself, that's 6 full days plus however many hours are left today,
// landing a week out; on a Sunday, it's 0 full days plus the hours left
// tonight.
export function msUntilNextPacificWeekStart(date = new Date()) {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TIME_ZONE, weekday: 'short' }).format(date);
  const FULL_DAYS_AFTER_TODAY = { Mon: 6, Tue: 5, Wed: 4, Thu: 3, Fri: 2, Sat: 1, Sun: 0 };
  const extraDays = FULL_DAYS_AFTER_TODAY[weekday] ?? 0;
  return msUntilNextPacificMidnight(date) + extraDays * 86400000;
}

// Shared HH:MM:SS formatter for the countdown values above — used by
// Home.jsx, MoneyMode.jsx, and Leaderboard.jsx.
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}
