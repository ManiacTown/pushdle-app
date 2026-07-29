// Buys an aura or leaderboard-row cosmetic (see MoneyShop.jsx and
// purchase_cosmetic in schema.sql, which is the real price/ownership
// enforcement point — this is just the thin HTTP wrapper, same shape as
// buy-diamond-button. Does NOT cover the diamond push-button skin, which
// keeps its own dedicated buy-diamond-button function.
//
// TEMP: admin-gated for now, same reasoning as the rest of the money
// variant/shop — not reachable by real players yet. Remove the isAdmin
// block below once it's ready for everyone; nothing else here or in
// schema.sql needs to change.
//
// Deploy with: supabase functions deploy purchase-cosmetic

import { createServiceClient, handlePreflight, isAdmin, json, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();
  if (!(await isAdmin(db, user.id))) return json({ error: 'forbidden' }, 403);

  let cosmeticId: string | null = null;
  try {
    const body = await req.json();
    cosmeticId = body?.cosmeticId ?? null;
  } catch {
    // No/empty body — purchase_cosmetic below just reports out_success=false
    // for a null id, same as any other unrecognized one.
  }

  const { data, error } = await db.rpc('purchase_cosmetic', { p_user_id: user.id, p_cosmetic_id: cosmeticId }).single();
  if (error) return json({ error: error.message }, 500);

  return json({
    success: data.out_success,
    diamonds: data.out_diamonds,
    ownedCosmetics: data.out_owned_cosmetics,
  });
});
