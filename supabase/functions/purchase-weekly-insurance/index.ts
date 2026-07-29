// Buys the once-per-week money-mode bust insurance (see MoneyShop.jsx and
// purchase_weekly_insurance in schema.sql for the real price/ownership
// check — this is just the thin HTTP wrapper, same shape as
// buy-diamond-button/purchase-cosmetic). What owning it actually DOES
// lives entirely in resolve_money_push's bust branch, not here or in the
// purchase RPC — this only ever flips owns_insurance on.
//
// TEMP: admin-gated for now, same reasoning as the rest of the money
// variant/shop — not reachable by real players yet. Remove the isAdmin
// block below once it's ready for everyone; nothing else here or in
// schema.sql needs to change.
//
// Deploy with: supabase functions deploy purchase-weekly-insurance

import { createServiceClient, handlePreflight, isAdmin, json, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();
  if (!(await isAdmin(db, user.id))) return json({ error: 'forbidden' }, 403);

  const { data, error } = await db.rpc('purchase_weekly_insurance', { p_user_id: user.id }).single();
  if (error) return json({ error: error.message }, 500);

  return json({
    success: data.out_success,
    diamonds: data.out_diamonds,
    ownsInsurance: data.out_owns_insurance,
  });
});
