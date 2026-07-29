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
    // 0 on every non-bonus push — resolve_money_push now rolls a random
    // $1-$5 bonus (was a flat $3), so the client can no longer just
    // hardcode the payout text; it has to show whatever this actually was.
    bonusCents: data.out_bonus_cents,
    // True on a full combo bar that paid out a diamond INSTEAD of the
    // money bonus — mutually exclusive with bonusCents > 0, a full bar
    // always pays out exactly one of the two. The diamond itself is
    // already credited to profiles.money_diamonds server-side by the time
    // this responds, regardless of how the run later ends — this is just
    // the client's cue to play the reward sound/animation.
    diamondEarned: data.out_diamond_earned,
    // Whether the CURRENT (still-filling) combo bar's cycle will pay out
    // a diamond once it fills — pre-rolled server-side per cycle (see
    // money_runs.next_bonus_is_diamond) specifically so the client can
    // show the correct corner icon the whole time the bar is filling,
    // not just reveal it the moment it does.
    nextDiamond: data.out_next_diamond,
    // True on a bust that weekly insurance caught instead of letting
    // through as a normal loss (see resolve_money_push's bust branch) —
    // MoneyMode.jsx uses this to run its "Insured!" flow instead of the
    // bust shake/flash. walletCents/lifetimeCents are only non-null on
    // this same path (a plain push/bust never moves them) — mirrors the
    // fields resolve_money_cashout already returns, so the client can
    // reuse the exact same coin-to-wallet animation off either source.
    insuranceUsed: data.out_insurance_used,
    walletCents: data.out_wallet_cents,
    lifetimeCents: data.out_lifetime_cents,
  });
});
