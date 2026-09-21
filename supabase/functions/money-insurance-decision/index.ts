// Commits a player's choice on a 'bust_pending_insurance' run (see
// resolve_money_insurance_decision in schema.sql) — bank half via weekly
// bust insurance, or let the bust stand. Same access model as money-push/
// money-cashout: open to every logged-in account, no separate gate here,
// since a pending decision can't exist without a run that money-push
// itself already gated the creation of.
//
// Deploy with: supabase functions deploy money-insurance-decision

import { createServiceClient, handlePreflight, json, pacificDateString, requireUser } from '../_shared/utils.ts';

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  const user = await requireUser(req);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let useInsurance = false;
  try {
    const body = await req.json();
    useInsurance = body?.useInsurance === true;
  } catch {
    // No/empty body — useInsurance stays false, i.e. decline.
  }

  const db = createServiceClient();

  const { data, error } = await db
    .rpc('resolve_money_insurance_decision', { p_user_id: user.id, p_date: pacificDateString(), p_use_insurance: useInsurance })
    .single();
  if (error) return json({ error: error.message }, 500);

  return json({
    status: data.out_status,
    earningsCents: data.out_earnings_cents,
    insuranceUsed: data.out_insurance_used,
    walletCents: data.out_wallet_cents,
    lifetimeCents: data.out_lifetime_cents,
    weeklyCents: data.out_weekly_cents,
  });
});
