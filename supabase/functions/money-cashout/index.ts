// Banks today's money-variant run into the player's permanent wallet/
// lifetime totals — see schema.sql's resolve_money_cashout for the actual
// locking/write logic. Open to every logged-in account now — see
// money-push/index.ts's header comment (that file is the one place the
// hasPlayedClassic gate is enforced; a cash-out can't happen without a run
// that money-push itself already gated the creation of).
//
// Deploy with: supabase functions deploy money-cashout

import { createServiceClient, handlePreflight, json, pacificDateString, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();

  const { data, error } = await db
    .rpc('resolve_money_cashout', { p_user_id: user.id, p_date: pacificDateString() })
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({
    success: data.out_success,
    earningsCents: data.out_earnings_cents,
    status: data.out_status,
    walletCents: data.out_wallet_cents,
    lifetimeCents: data.out_lifetime_cents,
    // What the wallet/bank panel itself displays — see money-push's own
    // response comment for why wallet/lifetime still ride along too.
    weeklyCents: data.out_weekly_cents,
  });
});
