// Shared color/price/category catalog for shop cosmetics — the single
// place Leaderboard.jsx, Profile.jsx, PublicProfile.jsx, MoneyShop.jsx, and
// Profile.jsx's Cosmetics tabs all read from, so an item looks and is
// labeled identically wherever it shows up. Item ids and their
// check-constraint membership (which slot each belongs to, via the
// 'aura_'/'row_' prefix) live in schema.sql — this file is purely
// presentation, not the source of truth for what's ownable.
//
// COSMETIC_PRICES is a display-only mirror of purchase_cosmetic's price
// CASE in schema.sql — the RPC is the real enforcement point regardless of
// what's shown here. Keep both in sync if a price or item ever changes.
export const AURA_COLORS = {
  aura_gold: '#ffd45e',
  aura_violet: '#8b5cf6',
  aura_green: '#39ff8f',
  aura_diamond: '#2bc8f7',
};

export const ROW_STYLE_COLORS = {
  row_gold: '#ffd45e',
  row_violet: '#8b5cf6',
  row_green: '#39ff8f',
  row_diamond: '#2bc8f7',
};

// Plain color names, not "X Glow"/"X Row" — the tab a player is already
// looking at (Name Color / Row Background, see COSMETIC_CATEGORIES below)
// supplies that context now, so repeating it in every item label was just
// noise. The item ids/slot/column names underneath (aura_gold,
// active_aura, ...) kept their original names regardless, since those are
// just internal identifiers already deployed, not user-facing.
export const COSMETIC_LABELS = {
  diamond_button: 'Diamond Button',
  aura_gold: 'Gold',
  aura_violet: 'Violet',
  aura_green: 'Emerald',
  aura_diamond: 'Diamond',
  row_gold: 'Gold',
  row_violet: 'Violet',
  row_green: 'Emerald',
  row_diamond: 'Diamond',
};

export const COSMETIC_PRICES = {
  aura_gold: 8,
  aura_violet: 8,
  aura_green: 8,
  aura_diamond: 8,
  row_gold: 12,
  row_violet: 12,
  row_green: 12,
  row_diamond: 12,
};

// Display-only mirror of purchase_weekly_insurance's hardcoded 30 in
// schema.sql — same "RPC is the real check" caveat as COSMETIC_PRICES above.
// Priced well above any single cosmetic — real economic value (recovers
// half an otherwise-lost run once a week), not purely visual.
export const INSURANCE_PRICE_DIAMONDS = 30;

// The three EQUIPPABLE categories — one tab each in both MoneyShop.jsx
// (buy) and Profile.jsx's Cosmetics section (equip). Single source of
// truth for tab labels/membership so the two UIs can never drift apart on
// what belongs where. Insurance/future gameplay boosters live in their own
// "Upgrades" shop tab instead (see MoneyShop.jsx) — deliberately NOT listed
// here, since they're owned-or-not with nothing to equip, so they have no
// place in Profile's equip-picker UI at all.
//
// push_skin is the one category still backed by its own dedicated
// owns_diamond_button/purchase_diamond_button/active_push_skin plumbing
// (it predates the generic owned_cosmetics/purchase_cosmetic system the
// other two use) — callers need their own adapter for it rather than
// assuming every item here goes through purchase_cosmetic. See
// MoneyShop.jsx/Profile.jsx for how each handles that split.
export const COSMETIC_CATEGORIES = [
  { id: 'push_skin', label: 'Push Button Skin', itemIds: ['diamond_button'] },
  { id: 'aura', label: 'Name Color', itemIds: ['aura_gold', 'aura_violet', 'aura_green', 'aura_diamond'] },
  { id: 'row_style', label: 'Row Background', itemIds: ['row_gold', 'row_violet', 'row_green', 'row_diamond'] },
];

// A player's chosen username color — same wherever a username renders
// (Leaderboard.jsx rows, Profile.jsx, PublicProfile.jsx). A plain solid
// color now, not a glow (an earlier version used text-shadow for a light-
// behind-the-text effect; this replaced it with a flatter "just recolor
// the name" look). Profile.jsx/PublicProfile.jsx's username sits in an
// element with the .gradient-title class (a violet-to-cyan gradient fill
// via background-clip:text + color:transparent) — a plain `color`
// override on its own would be invisible there, since the transparent
// fill still wins over `color` wherever the clip actually applies. This
// explicitly cancels the gradient/clip first (background:none,
// backgroundClip:initial) so the chosen solid color actually shows.
// Leaderboard.jsx's row username has no such gradient to begin with, so
// these overrides are harmless no-ops there.
export function auraStyle(auraId) {
  const color = AURA_COLORS[auraId];
  if (!color) return {};
  return {
    background: 'none',
    WebkitBackgroundClip: 'initial',
    backgroundClip: 'initial',
    color,
  };
}
