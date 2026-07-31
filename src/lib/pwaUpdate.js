// Registers the service worker (see vite.config.js's injectRegister:false
// — this replaces the plugin's own auto-injected registration script) and
// polls for a new deploy on an interval, not just on a fresh page load.
//
// The service worker itself already updates silently with no prompt
// (registerType: 'autoUpdate' — when registerSW finds a new worker, it
// skips waiting and activates on its own). What it DOESN'T do out of the
// box is ever check for a new worker in the first place unless the browser
// does a real navigation — a tab a player just leaves open on the home
// screen could sit on a stale deploy indefinitely otherwise.
// registration.update() is what triggers that check; this just calls it
// periodically so an idle tab eventually notices too.
//
// No user-visible prompt/banner by design, matching the "no update
// available, click to refresh" choice already made for the service
// worker itself — a reload can land mid-push/mid-reveal, but nothing is
// lost when it does: every push/cash-out is already recorded
// server-side before any of that plays out, so the worst case is a
// visual interruption, not lost progress.
import { registerSW } from 'virtual:pwa-register';

// 2 minutes — tight enough that a deploy reaches every already-open tab
// within a couple minutes of shipping, not just eventually. The request
// itself is a cheap conditional GET (a byte-for-byte check against the
// already-cached worker script, not a real asset download most of the
// time), so this cadence isn't a meaningful cost even for a tab left
// open for hours.
const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 1000;

// registerSW's own default reload (once the new worker activates) is a
// plain window.location.reload() — that only asks the browser to
// re-navigate, it doesn't guarantee a byte-for-byte fresh fetch of
// everything the page needs. This service worker still controls the page
// at that point and serves matching requests from its own Cache Storage
// first (that's the whole point of precaching), so a plain reload can
// still land on stale cached content in a way a real user-triggered hard
// refresh wouldn't — a hard refresh bypasses the service worker entirely
// for that one navigation, which isn't something a script can ask the
// browser to do. Clearing Cache Storage first is the closest equivalent
// reachable from code: it empties everything the SW could otherwise serve
// from cache, so the reload's own requests (and the SW's precache refill
// right behind them) have to hit the network instead. Safe to clear —
// the SW's install-time precache manifest lives in the worker script
// itself, not in Cache Storage, so this doesn't lose anything, it just
// forces a rebuild from network.
async function hardReload() {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  }
  window.location.reload();
}

export function initPWAUpdates() {
  registerSW({
    immediate: true,
    onNeedReload: hardReload,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL_MS);
    },
  });
}
