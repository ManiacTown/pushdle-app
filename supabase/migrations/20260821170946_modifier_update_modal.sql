-- Adds profiles.modifier_update_seen — gates ModifierUpdateModal.jsx's
-- one-time "what's new" recap, shown once to any logged-in account on
-- login. See schema.sql's own comment on the column for the full
-- reasoning; this migration is the same content, applied incrementally.

alter table profiles
  add column modifier_update_seen boolean not null default false;

grant update (username, selected_emoji, onboarding_seen, money_unlock_seen, pity_intro_seen, money_weekly_results_seen, clicked_contact, modifier_update_seen) on profiles to authenticated;
