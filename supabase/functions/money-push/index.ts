// Server-authoritative push roll for the money-variant game mode — same
// reasoning as push/index.ts (the client never knows the outcome in
// advance), just calling resolve_money_push instead of resolve_push.
//
// Open to every logged-in account now (the admin-only rollout gate that
// used to live here, and around the mode-switch button in Home.jsx, is
// gone as of the production launch). The one remaining requirement is
// hasPlayedClassic — an account must play classic at least once before
// money mode — which is permanent, not a rollout scaffold. This is the
// one place it's enforced server-side: money-push is the only real entry
// point into money mode (a run can't exist without at least one push into
// it), so gating it here transitively covers money-cashout and every shop
// purchase too, without needing the same check repeated in each of those.
//
// Deploy with: supabase functions deploy money-push

import { createServiceClient, handlePreflight, hasPlayedClassic, json, pacificDateString, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();
  if (!(await hasPlayedClassic(db, user.id))) return json({ error: 'play_classic_first' }, 403);

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
    // bust shake/flash. walletCents/lifetimeCents/weeklyCents are only
    // non-null on this same path (a plain push/bust never moves them) —
    // mirrors the fields resolve_money_cashout already returns, so the
    // client can reuse the exact same coin-to-wallet animation off either
    // source. weeklyCents is what the wallet/bank panel itself actually
    // displays (see MoneyMode.jsx) — wallet/lifetime still ride along for
    // the lifetime leaderboard/badges, just no longer shown there.
    insuranceUsed: data.out_insurance_used,
    walletCents: data.out_wallet_cents,
    lifetimeCents: data.out_lifetime_cents,
    weeklyCents: data.out_weekly_cents,
  });
});
