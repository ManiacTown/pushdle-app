// Device-level "has this browser dismissed the first-visit modal" flag —
// shared by OnboardingModal.jsx (which reads/writes it directly for
// guests) and AuthContext.jsx (which reads it once on login to carry a
// true value into the account's profiles.onboarding_seen column, so a
// guest who signs up — or an existing player logging in on a device that
// already dismissed it pre-login — never sees it again either).
//
// Deliberately a plain, direct localStorage read/write (not routed through
// lib/storage.js's async getItem/setItem) — same reasoning as sound.js's
// MUTE_KEY: this is a device-level UI flag, not game data.
const SEEN_KEY = 'pushdle:onboardingSeen';

export function hasSeenOnboardingLocally() {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // private browsing etc. — fail toward not nagging every load
  }
}

export function markOnboardingSeenLocally() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // ignore — worst case it just shows again next visit
  }
}
