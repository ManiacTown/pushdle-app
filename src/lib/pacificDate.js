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
