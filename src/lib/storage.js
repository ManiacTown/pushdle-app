// Every function here is async on purpose, even though localStorage is
// synchronous. That way, when this gets swapped for real API calls
// (Supabase/Firebase/custom backend), nothing calling these functions
// has to change — only the internals of this file do.

import { pacificDateString } from './pacificDate.js';

const NS = 'pushdle:';

export async function getItem(key) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export async function setItem(key, value) {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function removeItem(key) {
  try {
    localStorage.removeItem(NS + key);
    return true;
  } catch {
    return false;
  }
}

// ---- Game data ----

export async function getBestStreak() {
  const v = await getItem('bestStreak');
  return v || 0;
}

export async function setBestStreak(n) {
  await setItem('bestStreak', n);
}

export async function getTodayState() {
  const today = pacificDateString();
  const saved = await getItem('runState');
  if (saved && saved.date === today) return saved;
  return { date: today, streak: 0, status: 'playing', newBestToday: false };
}

export async function saveTodayState(state) {
  const today = pacificDateString();
  await setItem('runState', { ...state, date: today });
}

// Dev-only: wipes today's saved run so getTodayState() treats it as a new
// day, without waiting for real midnight.
export async function resetTodayState() {
  await removeItem('runState');
}

// IDs of badges newly earned on today's bust — kept separate from runState
// (rather than ephemeral component state) so the toast is still there if
// the player navigates away and back before the day resets.
export async function getTodayNewBadges() {
  const today = pacificDateString();
  const saved = await getItem('todayBadges');
  if (saved && saved.date === today) return saved.ids;
  return [];
}

export async function saveTodayNewBadges(ids) {
  const today = pacificDateString();
  await setItem('todayBadges', { date: today, ids });
}

// ---- Lifetime stats (badge tracking) ----
// Separate from bestStreak/runState because these accumulate across days
// rather than resetting daily. Badges themselves are never stored — they're
// always derived from these stats (see BADGES in lib/game.js), so wiping
// this blob (and bestStreak) is the entire "reset all badge progress" op.

const DEFAULT_STATS = { totalPushes: 0, dayStreak: 0, lastPlayedDate: null, bustedAtZero: false, bustedAtOne: false };

export async function getStats() {
  const v = await getItem('stats');
  return v ? { ...DEFAULT_STATS, ...v } : { ...DEFAULT_STATS };
}

export async function saveStats(stats) {
  await setItem('stats', stats);
}

export async function incrementTotalPushes() {
  const stats = await getStats();
  const updated = { ...stats, totalPushes: stats.totalPushes + 1 };
  await saveStats(updated);
  return updated;
}

// Call once per day, on the day's first push. Extends dayStreak only if
// the player also played the calendar day immediately before this one —
// otherwise (first time ever, or a day was missed) it restarts at 1.
export async function recordDailyPlay() {
  const stats = await getStats();
  const today = pacificDateString();
  if (stats.lastPlayedDate === today) return stats;
  const yesterday = pacificDateString(new Date(Date.now() - 86400000));
  const dayStreak = stats.lastPlayedDate === yesterday ? stats.dayStreak + 1 : 1;
  const updated = { ...stats, dayStreak, lastPlayedDate: today };
  await saveStats(updated);
  return updated;
}

// Dev-only: wipes every stat that any badge is derived from.
export async function resetBadgeProgress() {
  await setBestStreak(0);
  await removeItem('stats');
}

// ---- Flair (guest-only) ----
// Logged-in players' flair lives in Supabase (profiles.selected_emoji) —
// see AuthContext — since it needs to be visible to other players on the
// leaderboard. Guests have no server row, so this is just a local echo for
// their own Profile page; it can never appear on the real leaderboard,
// same as the rest of a guest's stats.

export async function getSelectedEmoji() {
  return await getItem('selectedEmoji');
}

export async function setSelectedEmoji(emoji) {
  await setItem('selectedEmoji', emoji);
}
