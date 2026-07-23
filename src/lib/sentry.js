import * as Sentry from '@sentry/react';

// Mirrors isSupabaseConfigured's pattern (src/lib/supabaseClient.js) — a
// missing DSN (e.g. local dev, or a fork without one set) just means
// Sentry never initializes rather than the app crashing on startup.
// import.meta.env.PROD is required too (not just a missing local DSN) so
// that a developer's own local errors during `npm run dev` never get
// reported — this is meant to watch the real deployed site, not local
// work-in-progress.
const dsn = import.meta.env.VITE_SENTRY_DSN;
export const isSentryConfigured = Boolean(dsn) && import.meta.env.PROD;

if (isSentryConfigured) {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    // No performance tracing/session replay — this is deliberately just
    // error capture for now, not a bigger observability rollout.
    tracesSampleRate: 0,
  });
}

export { Sentry };
