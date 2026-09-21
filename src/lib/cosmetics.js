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

// "Fusion" two-tone items — a premium tier alongside the flat colors above,
// each a [startColor, endColor] pair consumed by auraStyle/rowStyleBackground
// below rather than used directly. Deliberately a SEPARATE map from
// AURA_COLORS/ROW_STYLE_COLORS (not more entries in those) since a gradient
// isn't a valid CSS `color`/plain background value — every call site that
// needs "the CSS value for this item, gradient or not" goes through the
// helper functions below, and every call site that just needs "a single
// representative color" (borders, badges, buttons — anywhere a gradient
// can't apply) uses auraSwatchColor/rowStyleSwatchColor's first-stop
// fallback instead of reading these maps directly.
export const AURA_GRADIENTS = {
  aura_ashy: ['#e8203f', '#2b2b2f'],
  aura_phoenix: ['#ffd45e', '#ff5a1f'],
  aura_nebula: ['#8b5cf6', '#22e5ff'],
};

export const ROW_STYLE_GRADIENTS = {
  row_ashy: ['#e8203f', '#2b2b2f'],
  row_phoenix: ['#ffd45e', '#ff5a1f'],
  row_nebula: ['#8b5cf6', '#22e5ff'],
};

// Plain color names, not "X Glow"/"X Row" — the tab a player is already
// looking at (Name Color / Row Background, see COSMETIC_CATEGORIES below)
// supplies that context now, so repeating it in every item label was just
// noise. The item ids/slot/column names underneath (aura_gold,
// active_aura, ...) kept their original names regardless, since those are
// just internal identifiers already deployed, not user-facing.
export const COSMETIC_LABELS = {
  diamond_button: 'Diamond Button',
  skin_dice: 'Lucky Dice',
  skin_clover: 'Lucky Clover',
  skin_chip: 'High Roller Chip',
  skin_golden_egg: 'Golden Egg',
  aura_gold: 'Gold',
  aura_violet: 'Violet',
  aura_green: 'Emerald',
  aura_diamond: 'Diamond',
  aura_ashy: 'Ashy',
  aura_phoenix: 'Phoenix',
  aura_nebula: 'Nebula',
  row_gold: 'Gold',
  row_violet: 'Violet',
  row_green: 'Emerald',
  row_diamond: 'Diamond',
  row_ashy: 'Ashy',
  row_phoenix: 'Phoenix',
  row_nebula: 'Nebula',
};

// diamond_button isn't here — it keeps its own fixed DIAMOND_BUTTON_COST
// (MoneyShop.jsx), the one relic of the dedicated owns_diamond_button/
// purchase_diamond_button path predating this generic system (see
// COSMETIC_CATEGORIES' own comment below). Every push_skin item added
// since goes through purchase_cosmetic like auras/row styles do, so its
// price belongs here.
export const COSMETIC_PRICES = {
  skin_dice: 10,
  skin_clover: 10,
  skin_chip: 15,
  skin_golden_egg: 25,
  aura_gold: 8,
  aura_violet: 8,
  aura_green: 8,
  aura_diamond: 8,
  row_gold: 12,
  row_violet: 12,
  row_green: 12,
  row_diamond: 12,
  // Fusion tier costs more than a flat color — same "premium, exclusive"
  // pricing reasoning as Golden Egg among the push skins.
  aura_ashy: 15,
  aura_phoenix: 15,
  aura_nebula: 15,
  row_ashy: 20,
  row_phoenix: 20,
  row_nebula: 20,
};

// Push-button skin art (see Home.jsx's classic-mode button and
// MoneyShop.jsx/Profile.jsx's push_skin tabs) — one SVG per item, each
// following the same recipe as the original diamond_button PNG: a
// circular gradient badge, a flat-shaded object in the middle, a soft
// drop shadow. diamond_button's own PNG predates this map and isn't
// listed here — every call site that needs its path still hardcodes
// '/diamond-button.png' directly, same as it always has.
export const PUSH_SKIN_ICONS = {
  skin_dice: '/skin-dice.svg',
  skin_clover: '/skin-clover.svg',
  skin_chip: '/skin-chip.svg',
  skin_golden_egg: '/skin-golden-egg.svg',
};

// Plain hex, not rgba — MoneyShop.jsx's CosmeticCard appends its own
// 2-digit alpha suffix (same convention AURA_COLORS/ROW_STYLE_COLORS
// already use) for the card border, and .push-btn-skin's --skin-glow
// custom property (global.css) builds its own rgba() out of this at each
// use site, same reasoning .push-btn-diamond's own comment gives for
// diamond blue being hardcoded there rather than shared. Each color
// matches that skin's own badge tone rather than recoloring to the
// classic violet accent. diamond_button keeps its own hardcoded blue in
// global.css rather than reading from here, for the same "predates this"
// reason as PUSH_SKIN_ICONS above.
export const PUSH_SKIN_GLOW_COLORS = {
  skin_dice: '#e8203f',
  skin_clover: '#22c46f',
  skin_chip: '#e8b13a',
  skin_golden_egg: '#ffb238',
};

// Display-only mirror of purchase_weekly_insurance's hardcoded 30 in
// schema.sql — same "RPC is the real check" caveat as COSMETIC_PRICES above.
// Priced well above any single cosmetic — real economic value (recovers
// half an otherwise-lost run once a week), not purely visual.
export const INSURANCE_PRICE_DIAMONDS = 30;
// Same price/display-only-mirror reasoning as INSURANCE_PRICE_DIAMONDS
// above — purchase_streak_bonus/purchase_daredevil in schema.sql are the
// real enforcement.
export const STREAK_BONUS_PRICE_DIAMONDS = 30;
export const DAREDEVIL_PRICE_DIAMONDS = 30;

// The three EQUIPPABLE categories — one tab each in both MoneyShop.jsx
// (buy) and Profile.jsx's Cosmetics section (equip). Single source of
// truth for tab labels/membership so the two UIs can never drift apart on
// what belongs where. Insurance/Streak Bonus/Daredevil live in their own
// "Upgrades" shop tab instead (see MoneyShop.jsx) — deliberately NOT listed
// here. They DO now have an equip step (active_money_upgrade — only one of
// the three can be doing anything at a time), but that control lives
// directly on their own Upgrades-tab cards in MoneyShop.jsx rather than
// here, since Profile's equip-picker below is built around this specific
// three-slot (push_skin/aura/row_style) shape and the upgrades aren't a
// natural fourth slot in it.
//
// push_skin is the one category still backed by its own dedicated
// owns_diamond_button/purchase_diamond_button/active_push_skin plumbing
// (it predates the generic owned_cosmetics/purchase_cosmetic system the
// other two use) — callers need their own adapter for it rather than
// assuming every item here goes through purchase_cosmetic. See
// MoneyShop.jsx/Profile.jsx for how each handles that split.
export const COSMETIC_CATEGORIES = [
  { id: 'push_skin', label: 'Push Button Skin', itemIds: ['diamond_button', 'skin_dice', 'skin_clover', 'skin_chip', 'skin_golden_egg'] },
  { id: 'aura', label: 'Name Color', itemIds: ['aura_gold', 'aura_violet', 'aura_green', 'aura_diamond', 'aura_ashy', 'aura_phoenix', 'aura_nebula'] },
  { id: 'row_style', label: 'Row Background', itemIds: ['row_gold', 'row_violet', 'row_green', 'row_diamond', 'row_ashy', 'row_phoenix', 'row_nebula'] },
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
  // Fusion items ARE a gradient-text treatment — the opposite cancel-out
  // from the solid-color branch below: background-clip:text +
  // color:transparent is what makes a background gradient actually paint
  // the glyphs themselves. .gradient-title's own site-wide title fill
  // uses the exact same technique, just with fixed violet/cyan stops
  // instead of a per-item pair.
  const gradient = AURA_GRADIENTS[auraId];
  if (gradient) {
    return {
      backgroundImage: `linear-gradient(135deg, ${gradient[0]}, ${gradient[1]})`,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
    };
  }
  const color = AURA_COLORS[auraId];
  if (!color) return {};
  return {
    background: 'none',
    WebkitBackgroundClip: 'initial',
    backgroundClip: 'initial',
    color,
  };
}

// A single representative color for anywhere a full gradient can't apply
// (border-color, box-shadow, a plain BuyButton/BoughtBadge accent) — the
// fusion pair's first stop, or the plain color for a solid item. Every
// shop/reference-page card that shows a color swatch OR a colored
// border/button needs one of these two (see MoneyShop.jsx's CosmeticCard,
// About.jsx's ColorSwatch) rather than reading AURA_COLORS/
// ROW_STYLE_COLORS directly, since a fusion id has no entry there at all.
export function auraSwatchColor(auraId) {
  return AURA_GRADIENTS[auraId]?.[0] ?? AURA_COLORS[auraId];
}
export function rowStyleSwatchColor(rowStyleId) {
  return ROW_STYLE_GRADIENTS[rowStyleId]?.[0] ?? ROW_STYLE_COLORS[rowStyleId];
}

// The CSS `background` value for a row style, gradient or not — every
// place a row's background tint renders (Leaderboard.jsx rows,
// PublicProfile.jsx's row-style swatch, MoneyShop.jsx/Profile.jsx's shop
// swatches) goes through this instead of reading ROW_STYLE_COLORS
// directly, same "one helper, not scattered gradient-or-not branches"
// reasoning as auraStyle above. `alphaHex`, when given, is appended to
// each hex stop (or the plain color) — Leaderboard.jsx's own rows use a
// translucent tint (e.g. '1a' for ~10%), the small circular swatches
// elsewhere want full opacity and pass nothing.
export function rowStyleBackground(rowStyleId, alphaHex = '') {
  const gradient = ROW_STYLE_GRADIENTS[rowStyleId];
  if (gradient) {
    return `linear-gradient(135deg, ${gradient[0]}${alphaHex}, ${gradient[1]}${alphaHex})`;
  }
  const color = ROW_STYLE_COLORS[rowStyleId];
  return color ? `${color}${alphaHex}` : undefined;
}

// Same as rowStyleBackground above, for an aura's own plain-background
// (non-text-clip) uses — currently just About.jsx's reference-page swatch
// dot, which shows what the item actually looks like rather than
// auraSwatchColor's flattened single-color stand-in.
export function auraBackground(auraId, alphaHex = '') {
  const gradient = AURA_GRADIENTS[auraId];
  if (gradient) {
    return `linear-gradient(135deg, ${gradient[0]}${alphaHex}, ${gradient[1]}${alphaHex})`;
  }
  const color = AURA_COLORS[auraId];
  return color ? `${color}${alphaHex}` : undefined;
}
