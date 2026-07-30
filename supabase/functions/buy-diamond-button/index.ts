// The shop's first real purchase — spends 10 diamonds to unlock the
// diamond-skinned push button in CLASSIC mode (see Home.jsx/MoneyShop.jsx).
// Balance and already-owned checks both happen server-side inside
// purchase_diamond_button, not here — this is just the thin HTTP wrapper,
// same shape as money-push/money-cashout.
//
// Open to every logged-in account now — see money-push/index.ts's header
// comment for the money variant's overall access model. Reaching the
// shop at all already implies money-push's own hasPlayedClassic gate was
// satisfied, so nothing further needs checking here.
//
// Deploy with: supabase functions deploy buy-diamond-button

import { createServiceClient, handlePreflight, json, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();

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
