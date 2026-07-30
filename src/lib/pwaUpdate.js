// Registers the service worker (see vite.config.js's injectRegister:false
// — this replaces the plugin's own auto-injected registration script) and
// polls for a new deploy on an interval, not just on a fresh page load.
//
// The service worker itself already updates silently with no prompt
// (registerType: 'autoUpdate' — when registerSW finds a new worker, it
// skips waiting and reloads the page on its own, no callback wiring
// needed here for that part). What it DOESN'T do out of the box is ever
// check for a new worker in the first place unless the browser does a
// real navigation — a tab a player just leaves open on the home screen
// could sit on a stale deploy indefinitely otherwise. registration.update()
// is what triggers that check; this just calls it periodically so an
// idle tab eventually notices too.
//
// No user-visible prompt/banner by design, matching the "no update
// available, click to refresh" choice already made for the service
// worker itself — a reload can land mid-push/mid-reveal, but nothing is
// lost when it does: every push/cash-out is already recorded
// server-side before any of that plays out, so the worst case is a
// visual interruption, not lost progress.
import { registerSW } from 'virtual:pwa-register';

// 20 minutes — frequent enough that a tab left open through a deploy
// picks it up within a reasonable window, infrequent enough not to be a
// meaningful battery/network cost for a page most people don't leave
// open for hours at a stretch anyway.
const UPDATE_CHECK_INTERVAL_MS = 20 * 60 * 1000;

export function initPWAUpdates() {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL_MS);
    },
  });
}
