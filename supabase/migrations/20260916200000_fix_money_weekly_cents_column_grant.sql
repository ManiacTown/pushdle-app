-- Fixes a real, live security gap: 20260825163115_money_weekly_blackout.sql
-- added `revoke select (money_weekly_cents) on profiles from anon,
-- authenticated` specifically so the Sunday anti-sniping blackout (top 10
-- hidden from the weekly money leaderboard, see that migration's header)
-- was real server-side enforcement, not just a client-side UI choice.
-- That revoke has never actually worked: in Postgres, a column-level
-- REVOKE cannot narrow a table-level GRANT that already covers the whole
-- table (schema.sql's `grant select on profiles to anon, authenticated`)
-- — access is permitted if ANY applicable grant allows it, and the
-- blanket table-level one alone was always sufficient. Confirmed live via
-- `select * from information_schema.column_privileges where
-- table_name='profiles' and column_name='money_weekly_cents'` — anon and
-- authenticated both still had SELECT after that migration (and after
-- re-running it just now) had already applied.
--
-- The only way Postgres actually supports restricting a single column is
-- to revoke the table-level grant entirely and re-grant SELECT naming
-- every OTHER column explicitly — see schema.sql's own comment on this
-- same grant for the "future columns aren't readable by default anymore"
-- consequence of that.

revoke select on profiles from anon, authenticated;

grant select (
  id, username, created_at, best_streak, total_pushes, day_streak, last_played_date,
  busted_at_zero, busted_at_one, role, selected_emoji, onboarding_seen, money_wallet_cents,
  money_lifetime_cents, stats_migrated, money_best_run_cents, money_bank_streak,
  money_best_bank_streak, money_last_banked_date, money_reached_top3_weekly,
  money_banked_after_one_push, money_busted_over100, money_best_weekly_cents, money_diamonds,
  owns_diamond_button, owned_cosmetics, active_push_skin, active_aura, active_row_style,
  owns_insurance, insurance_used_this_week, money_unlock_seen, pity_count, pity_intro_seen,
  money_last_week_rank, money_last_week_score_cents, money_last_week_diamonds_awarded,
  money_weekly_results_seen, money_weekly_wins, money_top3_finishes, money_currently_top3,
  owns_streak_bonus, owns_daredevil, active_money_upgrade, money_upgrade_choice_seen,
  money_diamonds_spent_lifetime, owns_any_row_style, owns_any_aura, money_daredevil_run_200,
  clicked_contact, won_weekly_with_insurance, won_weekly_with_streak_bonus,
  won_weekly_with_daredevil, artemis_earned, modifier_update_seen, money_blackout_preview
) on profiles to anon, authenticated;
