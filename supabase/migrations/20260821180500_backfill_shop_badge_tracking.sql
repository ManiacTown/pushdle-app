-- Retroactive credit for the Shop badges (game.js's money-shop-* BADGES,
-- migration 20260821164621) — owns_any_row_style/owns_any_aura/
-- money_diamonds_spent_lifetime only started being written the moment
-- purchase_cosmetic/purchase_diamond_button/purchase_weekly_insurance were
-- updated to set them (this same session), so anyone who bought a row
-- style, aura, diamond button, or insurance BEFORE that point has the
-- purchase itself (owned_cosmetics/owns_diamond_button/owns_insurance) but
-- none of the new tracking columns reflecting it — their Shop badges look
-- unearned despite genuinely qualifying. This is a one-time data fix, not
-- a schema change, so it isn't mirrored in schema.sql.
--
-- money_diamonds_spent_lifetime is recomputed exactly, not estimated —
-- diamonds have no other sink and owned items/upgrades can never be
-- un-owned, so summing today's known per-item prices against what's
-- currently owned equals the true lifetime total. greatest(...) against
-- the existing value keeps this safe to ever re-run.
update profiles set
  owns_any_row_style = owns_any_row_style or exists (
    select 1 from unnest(owned_cosmetics) c where c like 'row_%'
  ),
  owns_any_aura = owns_any_aura or exists (
    select 1 from unnest(owned_cosmetics) c where c like 'aura_%'
  ),
  money_diamonds_spent_lifetime = greatest(
    money_diamonds_spent_lifetime,
    (case when owns_diamond_button then 10 else 0 end)
    + (case when owns_insurance then 30 else 0 end)
    + (case when owns_streak_bonus then 30 else 0 end)
    + (case when owns_daredevil then 30 else 0 end)
    + coalesce((
        select sum(case when c like 'row_%' then 12 when c like 'aura_%' then 8 else 0 end)
        from unnest(owned_cosmetics) c
      ), 0)
  );
