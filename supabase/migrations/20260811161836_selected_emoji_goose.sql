-- The Golden Goose badge's flair emoji changed from 🐔 to 🪿 (game.js's
-- BADGE_EMOJI) but this table's CHECK constraint was left listing the old
-- one, which schema.sql's own comment says must stay in sync. No existing
-- row has 🐔 selected (verified before writing this), so this is a
-- straight swap, not a data migration.

alter table profiles drop constraint profiles_selected_emoji_check;

alter table profiles add constraint profiles_selected_emoji_check
  check (selected_emoji is null or selected_emoji in
    ('⭐','🌀','🍀','🎲','🎲💯🎲','💀','🔥','⚡','🚀','🟢','🔴','💥',
     '🧓','🏦','💰','💵','🙌','🤑','🪿','😵'));
