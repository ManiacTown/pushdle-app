// Server-authoritative push roll for the money-variant game mode — same
// reasoning as push/index.ts (the client never knows the outcome in
// advance), just calling resolve_money_push instead of resolve_push.
//
// TEMP: admin-gated for now, same as admin/index.ts's role check — the
// money variant is still being built out and must not be reachable by
// real players yet. Remove the isAdmin block below (and the isAdmin &&
// check around the mode-switch button in Home.jsx) once it's ready for
// everyone; nothing else here or in schema.sql needs to change.
//
// Deploy with: supabase functions deploy money-push

import { createServiceClient, handlePreflight, isAdmin, json, pacificDateString, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();
  if (!(await isAdmin(db, user.id))) return json({ error: 'forbidden' }, 403);

  const { data, error } = await db
    .rpc('resolve_money_push', { p_user_id: user.id, p_date: pacificDateString() })
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({
    success: data.out_success,
    pushes: data.out_pushes,
    earningsCents: data.out_earnings_cents,
    status: data.out_status,
  });
});
