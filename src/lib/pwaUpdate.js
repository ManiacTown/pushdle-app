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
// The interval alone is NOT enough on its own, though — confirmed as the
// real cause of a report that a deploy sat unpicked-up for someone until
// they were told to hard-refresh. Mobile browsers (this is a phone-first
// game) aggressively suspend timers on a backgrounded/locked tab, so the
// interval simply doesn't fire while it's backgrounded; reopening it later
// often restores the page from a frozen bfcache snapshot rather than a
// real reload, so nothing re-checks for an update at that point either —
// a tab can sit backgrounded through several deploys and never once
// actually run registration.update() until it happens to still be in the
// foreground when a 2-minute tick lands. The visibilitychange/pageshow
// listeners below close that gap by forcing an immediate check the moment
// a tab comes back to the foreground (backgrounding a tab and returning
// to it later is the normal way anyone actually uses a phone game, far
// more than staring at one continuously-foregrounded tab for 2+ minutes
// straight), on top of the interval still covering a tab that's genuinely
// foregrounded and idle the whole time.
//
// No user-visible prompt/banner by design, matching the "no update
// available, click to refresh" choice already made for the service
// worker itself — a reload can land mid-push/mid-reveal, but nothing is
// lost when it does: every push/cash-out is already recorded
// server-side before any of that plays out, so the worst case is a
// visual interruption, not lost progress.
import { registerSW } from 'virtual:pwa-register';
import { supabase } from './supabaseClient.js';

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

// Lets an admin force every already-open tab to hard-reload right now
// (see supabase/functions/admin/index.ts's force_reload action) instead of
// waiting on the poll/foreground checks above — those are already tight
// (worst case ~2 minutes), but there's no way to trigger them on demand for
// tabs other than your own. Realtime broadcast is a plain pub/sub channel,
// not tied to auth — subscribes unconditionally (same as the SW update
// checks above, guest or logged in, everyone's tab should reload) as long
// as Supabase is configured at all. 'app-updates'/'reload' must match the
// Edge Function's topic/event exactly.
function subscribeToForceReload() {
  if (!supabase) return;
  supabase
    .channel('app-updates')
    .on('broadcast', { event: 'reload' }, () => hardReload())
    .subscribe();
}

export function initPWAUpdates() {
  subscribeToForceReload();
  registerSW({
    immediate: true,
    onNeedReload: hardReload,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      // Immediately on registration, not just once the first interval
      // tick lands — closes the gap where a tab that opens, sits idle for
      // under 2 minutes, then gets backgrounded, never gets a single
      // check in before the visibility-driven checks below take over.
      registration.update();
      setInterval(() => registration.update(), UPDATE_CHECK_INTERVAL_MS);
      // The real fix for the "backgrounded tab misses every deploy"
      // failure mode (see this file's header comment) — check the moment
      // a tab actually becomes visible again, instead of only on a fixed
      // timer that a backgrounded tab can't reliably run.
      // visibilitychange covers switching back to this tab/foregrounding
      // the app; pageshow with event.persisted covers a bfcache restore
      // specifically, which visibilitychange doesn't always accompany.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration.update();
      });
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) registration.update();
      });
    },
  });
}
