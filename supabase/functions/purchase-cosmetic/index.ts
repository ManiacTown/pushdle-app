// Buys an aura or leaderboard-row cosmetic (see MoneyShop.jsx and
// purchase_cosmetic in schema.sql, which is the real price/ownership
// enforcement point — this is just the thin HTTP wrapper, same shape as
// buy-diamond-button. Does NOT cover the diamond push-button skin, which
// keeps its own dedicated buy-diamond-button function.
//
// Open to every logged-in account now — see money-push/index.ts's header
// comment for the money variant's overall access model. Every purchasable
// cosmetic costs diamonds, which only ever come from money-push's combo
// bar, so its own hasPlayedClassic gate already covers this transitively.
//
// Deploy with: supabase functions deploy purchase-cosmetic

import { createServiceClient, handlePreflight, json, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();

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
