// The shop's first real purchase — spends 10 diamonds to unlock the
// diamond-skinned push button in CLASSIC mode (see Home.jsx/MoneyShop.jsx).
// Balance and already-owned checks both happen server-side inside
// purchase_diamond_button, not here — this is just the thin HTTP wrapper,
// same shape as money-push/money-cashout.
//
// TEMP: admin-gated for now, same reasoning as money-push/money-cashout —
// the money variant (and its shop) isn't reachable by real players yet.
// Remove the isAdmin block below once it's ready for everyone; nothing
// else here or in schema.sql needs to change.
//
// Deploy with: supabase functions deploy buy-diamond-button

import { createServiceClient, handlePreflight, isAdmin, json, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();
  if (!(await isAdmin(db, user.id))) return json({ error: 'forbidden' }, 403);

  const { data, error } = await db.rpc('purchase_diamond_button', { p_user_id: user.id }).single();
  if (error) return json({ error: error.message }, 500);

  return json({
    // False means either already owned or not enough diamonds — the RPC
    // doesn't distinguish (see its own comment), and the client already
    // knows which one from `stats` before it can even show a clickable
    // Buy button, so there's nothing useful to add here.
    success: data.out_success,
    diamonds: data.out_diamonds,
    ownsDiamondButton: data.out_owns_diamond_button,
  });
});
