// Shared stat-generation logic for bot profiles — used by both
// seed-bots.mjs (new bots) and update-bot-stats.mjs (regenerating stats
// for bots that already exist). Kept in one place so both scripts always
// agree on what a "plausible" bot looks like.
import { earnedBadges } from '../src/lib/game.js';

// Same tiny seeded PRNG as bots.js, so this is deterministic per username —
// re-running either script regenerates the same numbers for a given name
// rather than different ones each time.
function hashSeed(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const randInt = (rand, min, max) => min + Math.floor(rand() * (max - min + 1));

// Rare max, occasional legendary (via a high streak only) — never special.
// streak-100 (special) needs >=100, so best_streak is hard-capped well
// under that; bust-0 (special) needs bustedAtZero, so that's just always
// false. day_streak is capped at 30 (well under the legendary 100-day
// threshold); total_pushes — day_streak days at an average ~10 pushes/day
// (6-14, for variance) — tops out at 30*14=420, comfortably under the
// legendary 1000-push threshold too.
export function generateStats(username) {
  const rand = mulberry32(hashSeed(`${username}|stats`));

  const dayStreak = randInt(rand, 1, 30);
  const totalPushes = dayStreak * randInt(rand, 6, 14);

  // best_streak has to scale with dayStreak or the numbers don't read as
  // real — an early version rolled it fully independently, which could
  // (and did) land on things like "played 29 days, best streak ever is
  // 1", which is the kind of combination that gives away generated data
  // instead of a real account. Modeled as "the best of dayStreak
  // independent daily runs", each run following the same 90%-survival
  // odds real pushes do (mean run length 10) — grows with how many days
  // they've played, with diminishing returns (log growth, matching how
  // the max of N samples behaves) rather than growing linearly forever.
  const baselineMean = 8 + 7 * Math.log(dayStreak + 1);
  const luckRoll = rand();
  let multiplier;
  if (luckRoll < 0.7) multiplier = 0.6 + rand() * 0.6; // typical day: 0.6x-1.2x the baseline
  else if (luckRoll < 0.92) multiplier = 1.2 + rand() * 1.0; // a good day: 1.2x-2.2x
  else multiplier = 2.2 + rand() * 2.0; // occasional legendary-caliber outlier: 2.2x-4.2x
  let bestStreak = Math.max(1, Math.round(baselineMean * multiplier));
  // Can't have a single best run longer than your entire lifetime push
  // count, and never >=100 (the special streak-100 badge) regardless of
  // how big the outlier multiplier rolled.
  bestStreak = Math.min(bestStreak, 90, totalPushes);

  const bustedAtZero = false; // never — that's the special bust-0 badge
  const bustedAtOne = rand() < 0.25; // common-tier flavor only

  // No flair, ever — bots never set a leaderboard emoji next to their name.
  const selectedEmoji = null;

  const earned = earnedBadges({ bestStreak, totalPushes, dayStreak, bustedAtZero, bustedAtOne });
  return { bestStreak, totalPushes, dayStreak, bustedAtZero, bustedAtOne, selectedEmoji, earnedCount: earned.length };
}
