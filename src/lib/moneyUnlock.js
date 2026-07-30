// Device-level "has this browser seen MoneyModeUnlockModal.jsx" flag for
// GUESTS — mirrors lib/onboarding.js's hasSeenOnboardingLocally exactly
// (same reasoning: a guest has no profiles row to hold
// profiles.money_unlock_seen in, and AuthContext.jsx carries a true local
// value into that column on signup, same "OR, never lowers" carry-over
// onboarding_seen already does).
//
// Deliberately a plain, direct localStorage read/write, not routed
// through lib/storage.js's async getItem/setItem — same reasoning as
// onboarding.js: this is a device-level UI flag, not game data.
const SEEN_KEY = 'pushdle:moneyUnlockSeen';

export function hasSeenMoneyUnlockLocally() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // private browsing etc. — fail toward not nagging every load
  }
}

export function markMoneyUnlockSeenLocally() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // ignore — worst case it just shows again next visit
  }
}
