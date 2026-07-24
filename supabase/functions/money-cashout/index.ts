// Banks today's money-variant run into the player's permanent wallet/
// lifetime totals — see schema.sql's resolve_money_cashout for the actual
// locking/write logic. Same isAdmin gating and removal plan as
// money-push/index.ts — see that file's header comment.
//
// Deploy with: supabase functions deploy money-cashout

import { createServiceClient, handlePreflight, isAdmin, json, pacificDateString, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  const db = createServiceClient();
  if (!(await isAdmin(db, user.id))) return json({ error: 'forbidden' }, 403);

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
  });
});
