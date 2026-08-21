// Buys the Daredevil money-mode upgrade (see MoneyShop.jsx and
// purchase_daredevil in schema.sql for the real price/ownership check —
// this is just the thin HTTP wrapper, same shape as
// purchase-weekly-insurance). What owning it does lives entirely in
// resolve_money_push, gated on active_money_upgrade = 'daredevil', not
// here — buying it alone doesn't activate it (see set-active-money-upgrade).
//
// Open to every logged-in account now — see money-push/index.ts's header
// comment for the money variant's overall access model. Costs diamonds,
// which only ever come from money-push's combo bar, so its own
// hasPlayedClassic gate already covers this transitively.
//
// Deploy with: supabase functions deploy purchase-daredevil

import { createServiceClient, handlePreflight, json, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();

  const { data, error } = await db.rpc('purchase_daredevil', { p_user_id: user.id }).single();
  if (error) return json({ error: error.message }, 500);

  return json({
    success: data.out_success,
    diamonds: data.out_diamonds,
    ownsDaredevil: data.out_owns_daredevil,
  });
});
