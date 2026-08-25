// Triggered by the notify-deploy GitHub Action
// (.github/workflows/notify-deploy.yml) right after a Vercel production
// deployment succeeds — broadcasts the same 'app-updates'/'reload'
// Realtime message the admin panel's manual "Force reload all tabs"
// button sends (see admin/index.ts's force_reload action and
// src/lib/pwaUpdate.js's subscribeToForceReload for the other end of
// this), so every already-open tab picks up a new deploy immediately
// instead of relying on the passive poll/foreground checks alone.
//
// Deliberately its own function, not folded into admin/index.ts's
// force_reload: this is called by CI, which has no logged-in user
// session at all — a shared secret (DEPLOY_NOTIFY_SECRET, checked via a
// custom header, NOT Authorization — that header is reserved for the
// platform's own JWT gateway check) is the only auth this needs,
// completely different from admin/index.ts's requireUser+isAdmin model.
//
// MUST be deployed with --no-verify-jwt or the platform gateway rejects
// every call before this code ever runs, since CI has no real Supabase
// user JWT to send:
//   supabase functions deploy notify-deploy --no-verify-jwt
// And needs its own secret set (same value goes in the GitHub repo
// secret DEPLOY_NOTIFY_SECRET):
//   supabase secrets set DEPLOY_NOTIFY_SECRET=<random value>

import { getServiceRoleKey, handlePreflight, json } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  try {
    const secret = Deno.env.get('DEPLOY_NOTIFY_SECRET');
    if (!secret || req.headers.get('X-Deploy-Secret') !== secret) {
      return json({ error: 'unauthorized' }, 401);
    }

    const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        apikey: getServiceRoleKey(),
        Authorization: `Bearer ${getServiceRoleKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messages: [{ topic: 'app-updates', event: 'reload', payload: {} }] }),
    });
    if (!res.ok) return json({ error: `broadcast failed: ${res.status}` }, 500);
    return json({ success: true });
  } catch (err) {
    // Same reasoning as admin/index.ts's own wrapper — an uncaught
    // exception here would otherwise skip json()'s corsHeaders and show
    // up as a misleading CORS failure instead of the real error.
    return json({ error: `unhandled: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
});
