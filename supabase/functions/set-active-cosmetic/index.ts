// Equips/unequips an owned shop cosmetic (see MoneyShop.jsx). Ownership and
// which cosmetic ids are valid are both re-checked server-side inside
// set_active_cosmetic itself, not here — this is just the thin HTTP
// wrapper, same shape as buy-diamond-button.
//
// Open to every logged-in account now — see money-push/index.ts's header
// comment for the money variant's overall access model. Equipping only
// ever succeeds for an already-OWNED cosmetic (checked inside
// set_active_cosmetic itself), and owning one requires having bought it
// via purchase-cosmetic, which requires diamonds, which only ever come
// from money-push's combo bar — so hasPlayedClassic is covered
// transitively here too, just one hop further out than the shop itself.
//
// Deploy with: supabase functions deploy set-active-cosmetic

import { createServiceClient, handlePreflight, json, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();

  // slot picks which of the three independent equip slots this touches
  // (see active_push_skin/active_aura/active_row_style in schema.sql) —
  // required, there's no sensible default across three unrelated slots.
  // cosmeticId null unequips that slot; a body with no cosmeticId means
  // the same thing (so an "Unequip" button doesn't need to send an
  // explicit null over the wire).
  let slot: string | null = null;
  let cosmeticId: string | null = null;
  try {
    const body = await req.json();
    slot = body?.slot ?? null;
    cosmeticId = body?.cosmeticId ?? null;
  } catch {
    // No/empty body — slot stays null, which set_active_cosmetic below
    // just reports as out_success=false (no slot it recognizes).
  }

  const { data, error } = await db
    .rpc('set_active_cosmetic', { p_user_id: user.id, p_slot: slot, p_cosmetic_id: cosmeticId })
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({
    success: data.out_success,
    activeCosmetic: data.out_active_cosmetic,
  });
});
