// Equips/unequips one of the three mutually-exclusive money-mode upgrades
// (Insurance, Streak Bonus, Daredevil — see active_money_upgrade's own
// comment in schema.sql). Ownership and which values are valid are both
// re-checked server-side inside set_active_money_upgrade itself, not here —
// this is just the thin HTTP wrapper, same shape as set-active-cosmetic.
//
// Open to every logged-in account now — see money-push/index.ts's header
// comment for the money variant's overall access model. Activating only
// ever succeeds for an already-OWNED upgrade (checked inside
// set_active_money_upgrade itself), and owning one requires having bought
// it, which requires diamonds, which only ever come from money-push's
// combo bar — so hasPlayedClassic is covered transitively here too.
//
// Deploy with: supabase functions deploy set-active-money-upgrade

import { createServiceClient, handlePreflight, json, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();

  // upgrade null deactivates whichever one is currently active (so a
  // "Deactivate" button doesn't need to send anything special) — a body
  // with no upgrade field means the same thing.
  let upgrade: string | null = null;
  try {
    const body = await req.json();
    upgrade = body?.upgrade ?? null;
  } catch {
    // No/empty body — upgrade stays null, i.e. deactivate.
  }

  const { data, error } = await db
    .rpc('set_active_money_upgrade', { p_user_id: user.id, p_upgrade: upgrade })
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({
    success: data.out_success,
    activeMoneyUpgrade: data.out_active_money_upgrade,
  });
});
