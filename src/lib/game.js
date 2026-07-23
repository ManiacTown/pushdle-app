export const SUCCESS_CHANCE = 0.9;
export const FIRST_PRESS_SUCCESS_CHANCE = 0.999;

export function rollPush(currentStreak) {
  const chance = currentStreak === 0 ? FIRST_PRESS_SUCCESS_CHANCE : SUCCESS_CHANCE;
  return Math.random() < chance;
}

export function formatRarity(pct) {
  if (pct < 1) return pct.toFixed(2) + '%';
  if (pct < 10) return pct.toFixed(1) + '%';
  return Math.round(pct) + '%';
}

export function rarityForStreak(streak) {
  return Math.pow(0.9, streak) * 100;
}

// Badges are always derived from stats (bestStreak + lib/storage's
// lifetime `stats` blob) — never stored as their own "earned" list — so
// resetting badge progress is just wiping the stats they're computed from.
// `stats` shape: { bestStreak, totalPushes, dayStreak, bustedAtZero, bustedAtOne }
export const BADGE_CATEGORIES = [
  { id: 'streak', label: 'Streak' },
  { id: 'pushes', label: 'Total Pushes' },
  { id: 'days', label: 'Days Played' },
  { id: 'bust', label: 'Bust' },
];

// Rarity is flavor on top of the check thresholds above — common/rare/
// legendary roughly track difficulty, special is reserved for the two
// genuine statistical flukes (busting on press 1, or on press 2) rather
// than the top of the difficulty curve.
export const RARITY_META = {
  common: { label: 'Common', color: '#9ca3af' },
  rare: { label: 'Rare', color: 'var(--neon-cyan)' },
  legendary: { label: 'Legendary', color: '#ffd45e' },
  special: { label: 'Special', color: 'var(--neon-red)' },
};

export const BADGES = [
  { id: 'streak-1', label: 'Baby Steps', category: 'streak', hint: 'Reach a streak of 1', rarity: 'common', check: (s) => s.bestStreak >= 1 },
  { id: 'streak-10', label: 'Average', category: 'streak', hint: 'Reach a streak of 10', rarity: 'common', check: (s) => s.bestStreak >= 10 },
  { id: 'streak-20', label: 'Lucky', category: 'streak', hint: 'Reach a streak of 20', rarity: 'rare', check: (s) => s.bestStreak >= 20 },
  { id: 'streak-30', label: 'Extremely Lucky', category: 'streak', hint: 'Reach a streak of 30', rarity: 'rare', check: (s) => s.bestStreak >= 30 },
  { id: 'streak-40', label: 'Four Leaf Clover', category: 'streak', hint: 'Reach a streak of 40', rarity: 'legendary', check: (s) => s.bestStreak >= 40 },
  { id: 'streak-50', label: 'RNG Emperor', category: 'streak', hint: 'Reach a streak of 50', rarity: 'legendary', check: (s) => s.bestStreak >= 50 },
  { id: 'streak-100', label: 'Luck 100', category: 'streak', hint: 'Reach a streak of 100', rarity: 'special', check: (s) => s.bestStreak >= 100 },

  { id: 'bust-1', label: 'Crash Bomber', category: 'bust', hint: 'Bust on a streak of 1', rarity: 'common', check: (s) => !!s.bustedAtOne },
  { id: 'bust-0', label: 'How Is This Even Possible?!', category: 'bust', hint: 'Bust on your very first push', rarity: 'special', check: (s) => !!s.bustedAtZero },

  { id: 'days-7', label: 'I Like This Game', category: 'days', hint: 'Play 7 days in a row', rarity: 'common', check: (s) => (s.dayStreak || 0) >= 7 },
  { id: 'days-15', label: 'Clocked In', category: 'days', hint: 'Play 15 days in a row', rarity: 'common', check: (s) => (s.dayStreak || 0) >= 15 },
  { id: 'days-30', label: 'Dedicated', category: 'days', hint: 'Play 30 days in a row', rarity: 'rare', check: (s) => (s.dayStreak || 0) >= 30 },
  { id: 'days-50', label: 'The Long Haul', category: 'days', hint: 'Play 50 days in a row', rarity: 'rare', check: (s) => (s.dayStreak || 0) >= 50 },
  { id: 'days-100', label: 'Probably An Addiction', category: 'days', hint: 'Play 100 days in a row', rarity: 'legendary', check: (s) => (s.dayStreak || 0) >= 100 },

  { id: 'pushes-25', label: 'Button Enjoyer', category: 'pushes', hint: '25 total pushes', rarity: 'common', check: (s) => (s.totalPushes || 0) >= 25 },
  { id: 'pushes-100', label: 'Button Enthusiast', category: 'pushes', hint: '100 total pushes', rarity: 'common', check: (s) => (s.totalPushes || 0) >= 100 },
  { id: 'pushes-200', label: 'Button Superfan', category: 'pushes', hint: '200 total pushes', rarity: 'rare', check: (s) => (s.totalPushes || 0) >= 200 },
  { id: 'pushes-500', label: 'Button Masher', category: 'pushes', hint: '500 total pushes', rarity: 'rare', check: (s) => (s.totalPushes || 0) >= 500 },
  { id: 'pushes-1000', label: 'Boop.', category: 'pushes', hint: '1000 total pushes', rarity: 'legendary', check: (s) => (s.totalPushes || 0) >= 1000 },
];

export function earnedBadges(stats) {
  return BADGES.filter((b) => b.check(stats));
}

// Wordle-style shareable summary of a finished (busted) run. Uncapped on
// purpose — a real megastreak run is rare enough that showing the full,
// ridiculous row of circles is the whole point of bragging about it.
export function buildShareText({ streak, url }) {
  const pct = rarityForStreak(streak);
  const circles = '🟢'.repeat(streak) + '🔴';
  const line =
    streak === 0
      ? "Pushdle — busted on my very first push! 💀"
      : `Pushdle — survived ${streak} push${streak === 1 ? '' : 'es'} (top ${formatRarity(pct)}) before busting.`;
  return `${line}\n${circles}\n${url}`;
}

// Only rare-and-up badges get a flair emoji — common ones are too easy to
// use as a meaningful leaderboard flex. Keys must stay in sync with the
// allowed list in supabase/schema.sql's `selected_emoji` check constraint;
// update both together if this ever changes.
export const BADGE_EMOJI = {
  'streak-20': '⭐',
  'streak-30': '🌀',
  'streak-40': '🍀',
  'streak-50': '🎲',
  'streak-100': '🎲💯🎲',
  'bust-0': '💀',
  'days-30': '🔥',
  'days-50': '⚡',
  'days-100': '🚀',
  'pushes-200': '🟢',
  'pushes-500': '🔴',
  'pushes-1000': '💥',
};
