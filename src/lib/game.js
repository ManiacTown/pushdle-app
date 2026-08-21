export const SUCCESS_CHANCE = 0.9;
export const FIRST_PRESS_SUCCESS_CHANCE = 0.999;
// A player's very first-ever classic run (guest or logged-in, see Home.jsx's
// pushLocal/pushServer) forces every press to succeed while streak is below
// this — guaranteeing at least a 10-streak on the run that's most likely to
// otherwise turn someone off the game for good. Odds display stays at the
// normal 90%/10% throughout (kept silent, unlike Comeback Boost's later
// planned mechanic, which is deliberately visible) — a one-time, industry-
// standard "new player luck" softener, not an ongoing/hidden mechanic.
export const FIRST_RUN_GUARANTEE_STREAK = 10;

// Comeback Boost (classic mode, registered accounts only — see resolve_push
// in schema.sql, the sole place the actual roll happens for logged-in
// players). Bust at streak <= PITY_BUST_THRESHOLD three times in a row
// (PITY_CHARGES_NEEDED) arms the NEXT run for the same guarantee-through-
// streak-10 treatment as FIRST_RUN_GUARANTEE_STREAK above, from press 2
// onward. Any non-armed run that clears streak >= PITY_CLEAR_THRESHOLD
// wipes the meter early. Fires once, then resets on that run's resolution
// regardless of outcome — never stacks. These constants are for DISPLAY
// only (the odds bar / rarity reveal) — the roll itself is entirely
// server-side. PITY_GUARANTEE_STREAK is kept as its own constant, separate
// from FIRST_RUN_GUARANTEE_STREAK, even though both are currently 10 — same
// value, different trigger, independently tunable rather than coupled.
export const PITY_BUST_THRESHOLD = 5;
export const PITY_CLEAR_THRESHOLD = 7;
export const PITY_CHARGES_NEEDED = 3;
export const PITY_GUARANTEE_STREAK = 10;

export function rollPush(currentStreak) {
  const chance = currentStreak === 0 ? FIRST_PRESS_SUCCESS_CHANCE : SUCCESS_CHANCE;
  return Math.random() < chance;
}

export function formatRarity(pct) {
  if (pct < 1) return pct.toFixed(2) + '%';
  if (pct < 10) return pct.toFixed(1) + '%';
  return Math.round(pct) + '%';
}

// `guaranteedThrough` treats the first N presses as free (0.9^0 = 1, i.e.
// certain) — used by Comeback Boost's bust-time reveal to correctly score
// only the streak BEYOND its guarantee window against real 90% odds.
// Every existing caller keeps its exact old behavior via the default.
export function rarityForStreak(streak, guaranteedThrough = 0) {
  return Math.pow(0.9, Math.max(0, streak - guaranteedThrough)) * 100;
}

// Badges are always derived from stats (bestStreak + lib/storage's
// lifetime `stats` blob) — never stored as their own "earned" list — so
// resetting badge progress is just wiping the stats they're computed from.
// `stats` shape: { bestStreak, totalPushes, dayStreak, bustedAtZero, bustedAtOne }
export const BADGE_CATEGORIES = [
  { id: 'streak', label: 'Streak' },
  { id: 'pushes', label: 'Total Pushes' },
  { id: 'days', label: 'Days Played' },
  { id: 'bust', label: 'Bust' },
  // Money-variant categories — kept as separate ids/labels rather than folded into the
  // 4 above, both because "streak badges are classic-mode only" (see
  // AuthContext.jsx/Home.jsx's explicit-field-pick comments from earlier
  // this session) and because a combined grid would be one long scroll —
  // see Profile.jsx's streak/money tab split.
  { id: 'money-run', label: 'Best Run' },
  { id: 'money-lifetime', label: 'Lifetime Earnings' },
  { id: 'money-streak', label: 'Banking Streak' },
  // Merged from what were previously two separate categories (weekly-rank
  // and situational/style badges) into one — both were small enough on
  // their own (1 and 2 badges) that splitting them felt like padding out
  // the grid rather than meaningfully grouping anything.
  { id: 'money-unique', label: 'Unique' },
  // Shop purchases — deliberately its own category rather than folded into
  // money-unique, so "did I buy everything" reads as its own checklist.
  { id: 'money-shop', label: 'Shop' },
];

// Its own top-level achievement tab (see Profile.jsx/PublicProfile.jsx's
// AchievementTabToggle), not folded into money-shop/money-unique — every
// badge in this category has its hint masked to "???" until earned (see
// BadgeGrid.jsx), which only makes sense as a distinct browsing mode, not
// mixed in with badges that show their real hint from the start.
export const SECRET_CATEGORY = { id: 'secret', label: 'Only the best of the best earn these badges' };

// Rarity is flavor on top of the check thresholds above — common/rare/
// legendary roughly track difficulty, special is reserved for the two
// genuine statistical flukes (busting on press 1, or on press 2) rather
// than the top of the difficulty curve.
export const RARITY_META = {
  common: { label: 'Common', color: '#9ca3af' },
  rare: { label: 'Rare', color: 'var(--neon-cyan)' },
  legendary: { label: 'Legendary', color: '#ffd45e' },
  special: { label: 'Special', color: 'var(--neon-red)' },
};

// Declarative on purpose — `field` + `min` instead of a `check` function —
// so "what stats value satisfies every badge" is itself derivable (see
// maxStatsForAllBadges/zeroStatsForAllBadges below), not just checkable.
// That's what lets the admin "claim all badges"/"reset all badges" tools
// (Home.jsx's adminClaimAllBadges/adminResetBadges) stay correct
// automatically as badges are added, instead of needing a hand-maintained
// second copy of every threshold. `min: true` marks a boolean flag badge
// (checked for truthiness, not compared numerically) — everything else is
// a plain `stats[field] >= min` numeric check.
export const BADGES = [
  { id: 'streak-1', label: 'Baby Steps', category: 'streak', hint: 'Reach a streak of 1', rarity: 'common', field: 'bestStreak', min: 1 },
  { id: 'streak-10', label: 'Average', category: 'streak', hint: 'Reach a streak of 10', rarity: 'common', field: 'bestStreak', min: 10 },
  { id: 'streak-20', label: 'Lucky', category: 'streak', hint: 'Reach a streak of 20', rarity: 'rare', field: 'bestStreak', min: 20 },
  { id: 'streak-30', label: 'Extremely Lucky', category: 'streak', hint: 'Reach a streak of 30', rarity: 'rare', field: 'bestStreak', min: 30 },
  { id: 'streak-40', label: 'Four Leaf Clover', category: 'streak', hint: 'Reach a streak of 40', rarity: 'legendary', field: 'bestStreak', min: 40 },
  { id: 'streak-50', label: 'RNG Emperor', category: 'streak', hint: 'Reach a streak of 50', rarity: 'legendary', field: 'bestStreak', min: 50 },
  { id: 'streak-100', label: 'Luck 100', category: 'streak', hint: 'Reach a streak of 100', rarity: 'special', field: 'bestStreak', min: 100 },

  { id: 'bust-1', label: 'Crash Bomber', category: 'bust', hint: 'Bust on a streak of 1', rarity: 'common', field: 'bustedAtOne', min: true },
  { id: 'bust-0', label: 'How Is This Even Possible?!', category: 'bust', hint: 'Bust on your very first push', rarity: 'special', field: 'bustedAtZero', min: true },

  { id: 'days-7', label: 'I Like This Game', category: 'days', hint: 'Play 7 days in a row', rarity: 'common', field: 'dayStreak', min: 7 },
  { id: 'days-15', label: 'Clocked In', category: 'days', hint: 'Play 15 days in a row', rarity: 'common', field: 'dayStreak', min: 15 },
  { id: 'days-30', label: 'Dedicated', category: 'days', hint: 'Play 30 days in a row', rarity: 'rare', field: 'dayStreak', min: 30 },
  { id: 'days-50', label: 'The Long Haul', category: 'days', hint: 'Play 50 days in a row', rarity: 'rare', field: 'dayStreak', min: 50 },
  { id: 'days-100', label: 'Probably An Addiction', category: 'days', hint: 'Play 100 days in a row', rarity: 'legendary', field: 'dayStreak', min: 100 },

  { id: 'pushes-25', label: 'Button Enjoyer', category: 'pushes', hint: '25 total pushes', rarity: 'common', field: 'totalPushes', min: 25 },
  { id: 'pushes-100', label: 'Button Enthusiast', category: 'pushes', hint: '100 total pushes', rarity: 'common', field: 'totalPushes', min: 100 },
  { id: 'pushes-200', label: 'Button Superfan', category: 'pushes', hint: '200 total pushes', rarity: 'rare', field: 'totalPushes', min: 200 },
  { id: 'pushes-500', label: 'Button Masher', category: 'pushes', hint: '500 total pushes', rarity: 'rare', field: 'totalPushes', min: 500 },
  { id: 'pushes-1000', label: 'Boop.', category: 'pushes', hint: '1000 total pushes', rarity: 'legendary', field: 'totalPushes', min: 1000 },

  // ---- Money variant ----
  // Reads moneyBestRunCents/moneyLifetimeCents/moneyBestBankStreak/etc off
  // the same stats object as everything above (see AuthContext.jsx) — just
  // a different set of fields, all sourced from profiles' money_* columns.
  // moneyBestBankStreak/moneyBestRunCents are permanent greatest()-tracked
  // maxima (mirrors bestStreak), NOT the live current values — earning one
  // of these keeps it earned even if a later run busts or the streak
  // breaks. See schema.sql's resolve_money_cashout for where these are set.
  { id: 'money-streak-1', label: 'Pocket Change', category: 'money-streak', hint: 'Cash out for the first time', rarity: 'common', field: 'moneyBestBankStreak', min: 1 },
  { id: 'money-streak-5', label: 'Penny Pincher', category: 'money-streak', hint: 'Bank 5 days in a row', rarity: 'common', field: 'moneyBestBankStreak', min: 5 },
  { id: 'money-streak-15', label: 'Ebenezer Scrooge', category: 'money-streak', hint: 'Bank 15 days in a row', rarity: 'rare', field: 'moneyBestBankStreak', min: 15 },

  { id: 'money-lifetime-250', label: 'Nest Egg', category: 'money-lifetime', hint: 'Earn $250 lifetime', rarity: 'common', field: 'moneyLifetimeCents', min: 25000 },
  { id: 'money-lifetime-1000', label: 'Coin Collector', category: 'money-lifetime', hint: 'Earn $1,000 lifetime', rarity: 'common', field: 'moneyLifetimeCents', min: 100000 },
  { id: 'money-lifetime-2500', label: 'The Vault', category: 'money-lifetime', hint: 'Earn $2,500 lifetime', rarity: 'rare', field: 'moneyLifetimeCents', min: 250000 },
  { id: 'money-lifetime-10000', label: 'Moneybags', category: 'money-lifetime', hint: 'Earn $10,000 lifetime', rarity: 'rare', field: 'moneyLifetimeCents', min: 1000000 },

  { id: 'money-run-25', label: 'Steady Hand', category: 'money-run', hint: 'Bank $25 in a single run', rarity: 'common', field: 'moneyBestRunCents', min: 2500 },
  { id: 'money-run-50', label: 'The Banker', category: 'money-run', hint: 'Bank $50 in a single run', rarity: 'rare', field: 'moneyBestRunCents', min: 5000 },
  { id: 'money-run-100', label: 'Midas Touch', category: 'money-run', hint: 'Bank $100 in a single run', rarity: 'legendary', field: 'moneyBestRunCents', min: 10000 },
  { id: 'money-run-250', label: 'Lottery', category: 'money-run', hint: 'Bank $250 in a single run', rarity: 'special', field: 'moneyBestRunCents', min: 25000 },

  { id: 'money-style-walkaway', label: 'Walking Away', category: 'money-unique', hint: 'Cash out after just 1 push', rarity: 'common', field: 'moneyBankedAfterOnePush', min: true },
  { id: 'money-rank-top3', label: 'Golden Goose', category: 'money-unique', hint: 'Reach top 3 on the weekly money leaderboard', rarity: 'legendary', field: 'moneyReachedTop3Weekly', min: true },
  { id: 'money-style-greedy', label: 'Too Greedy', category: 'money-unique', hint: 'Bust with $100+ unbanked in one run', rarity: 'legendary', field: 'moneyBustedOver100', min: true },

  // ---- Money variant: Shop ----
  // Reads owns*/moneyDiamondsSpentLifetime off the same stats object as
  // everything above — see AuthContext.jsx for where each is fetched.
  // Ordered common -> rare -> legendary (BadgeGrid.jsx renders each
  // category in plain array order, no separate sort) rather than the
  // order they were first described in.
  { id: 'money-shop-button-skin', label: 'Oooh Shiny', category: 'money-shop', hint: 'Buy a push-button skin', rarity: 'common', field: 'ownsDiamondButton', min: true },
  { id: 'money-shop-row-style', label: 'Time to Decorate', category: 'money-shop', hint: 'Buy a row background', rarity: 'common', field: 'ownsAnyRowStyle', min: true },
  { id: 'money-shop-aura', label: 'Standing Out', category: 'money-shop', hint: 'Buy a name color', rarity: 'common', field: 'ownsAnyAura', min: true },
  { id: 'money-shop-diamonds-50', label: 'Put Them to Good Use', category: 'money-shop', hint: 'Spend 50 diamonds in the shop', rarity: 'rare', field: 'moneyDiamondsSpentLifetime', min: 50 },
  {
    id: 'money-shop-all-upgrades',
    label: 'Modification Master',
    category: 'money-shop',
    hint: 'Buy all 3 Money Mode upgrades',
    rarity: 'legendary',
    fields: [
      { field: 'ownsInsurance', min: true },
      { field: 'ownsStreakBonus', min: true },
      { field: 'ownsDaredevil', min: true },
    ],
  },

  // ---- Secret ---- (see SECRET_CATEGORY above and BadgeGrid.jsx — every
  // hint below shows as "???" until earned, so keep them real/specific
  // here regardless; the masking is purely a display-layer concern.)
  { id: 'secret-leonidas', label: 'Leonidas', category: 'secret', hint: 'Bank $200 in a single Money Mode run while Daredevil is active', rarity: 'special', field: 'moneyDaredevilRun200', min: true },
  { id: 'secret-hermes', label: 'Hermes', category: 'secret', hint: 'Click the Contact link in the footer', rarity: 'special', field: 'clickedContact', min: true },
  { id: 'secret-orion', label: 'Orion', category: 'secret', hint: 'Finish #1 on the weekly Money Mode leaderboard 5 times', rarity: 'special', field: 'moneyWeeklyWins', min: 5 },
  {
    id: 'secret-davinci',
    label: 'Leonardo da Vinci',
    category: 'secret',
    hint: 'Finish #1 on the weekly leaderboard with each of the 3 upgrades active',
    rarity: 'special',
    fields: [
      { field: 'wonWeeklyWithInsurance', min: true },
      { field: 'wonWeeklyWithStreakBonus', min: true },
      { field: 'wonWeeklyWithDaredevil', min: true },
    ],
  },
  { id: 'secret-artemis', label: 'Artemis', category: 'secret', hint: 'Reach a 50 streak in classic mode AND bank $100 in Money Mode on the same day', rarity: 'special', field: 'artemisEarned', min: true },
  // Deliberately unclaimable right now — no code anywhere ever sets
  // nukeEarned, and it's deliberately NOT in ALLOWED_BADGE_FIELDS
  // (supabase/functions/_shared/utils.ts) either, so even the admin
  // "claim all badges" dev tool can't grant it. A placeholder for later.
  { id: 'secret-nuke', label: 'N.U.K.E.', category: 'secret', hint: 'Not obtainable yet — check back another time', rarity: 'special', field: 'nukeEarned', min: true },
];

// A badge is either a single {field, min} threshold, or — for a badge that
// needs several independent things to ALL be true ("own all 3 upgrades",
// "won the week with each of the 3 upgrades") — a `fields: [{field, min},
// ...]` array, ANDed together instead of a bare `field`/`min` pair. This
// normalizes both shapes to the same list so every consumer below only
// ever has to handle one case.
export function badgeConditions(badge) {
  return badge.fields ?? [{ field: badge.field, min: badge.min }];
}

function badgeIsEarned(badge, stats) {
  return badgeConditions(badge).every(({ field, min }) => {
    const value = stats[field];
    return min === true ? !!value : (value || 0) >= min;
  });
}

export function earnedBadges(stats) {
  return BADGES.filter((b) => badgeIsEarned(b, stats));
}

// Every field any badge reads, maxed out to whatever value guarantees it's
// earned (the highest `min` seen per field; `true` for boolean flags) —
// powers the admin "claim all badges" dev tool (Home.jsx's
// adminClaimAllBadges). Adding a new badge above is automatically enough
// to make it claimable too; nothing here needs updating by hand — with one
// deliberate exception: a field not listed in ALLOWED_BADGE_FIELDS
// (supabase/functions/_shared/utils.ts) gets silently dropped server-side
// regardless of what this returns, which is exactly how N.U.K.E. stays
// unclaimable even by this admin tool.
export function maxStatsForAllBadges() {
  const result = {};
  for (const b of BADGES) {
    for (const { field, min } of badgeConditions(b)) {
      if (min === true) {
        result[field] = true;
      } else {
        result[field] = Math.max(result[field] || 0, min);
      }
    }
  }
  return result;
}

// Every field any badge reads, reset to its "not earned" value (0 or
// false) — powers the admin "reset all badges" dev tool (Home.jsx's
// adminResetBadges). Same auto-updates-with-BADGES property as
// maxStatsForAllBadges above.
export function zeroStatsForAllBadges() {
  const result = {};
  for (const b of BADGES) {
    for (const { field, min } of badgeConditions(b)) {
      result[field] = min === true ? false : 0;
    }
  }
  return result;
}

// Mechanical camelCase -> snake_case key conversion — every stats field
// name in this codebase already follows that correspondence 1:1 with its
// `profiles` column (bestStreak/best_streak, moneyLifetimeCents/
// money_lifetime_cents, moneyReachedTop3Weekly/money_reached_top3_weekly,
// ...), so this needs no manual mapping table or special-cased rules
// either — deliberately kept to the single obvious rule (insert _ before
// each uppercase letter) rather than trying to also guess where digit
// runs belong, since that guess isn't actually knowable from the
// camelCase spelling alone (compare moneyReachedTop3Weekly, no
// underscore before "3", against a column that USED to be named
// money_busted_over_100, underscore before "100" — same digit-after-
// lowercase shape, different real answer). The column that broke this
// was renamed (money_busted_over_100 -> money_busted_over100) to match
// the convention instead — see schema.sql's own comment on that column.
// Used by Home.jsx to turn maxStatsForAllBadges()/zeroStatsForAllBadges()
// into the column names the admin Edge Function actually writes.
export function camelToSnakeFields(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())] = value;
  }
  return result;
}

// Wordle-style shareable summary of a finished (busted) run. Uncapped on
// purpose — a real megastreak run is rare enough that showing the full,
// ridiculous row of circles is the whole point of bragging about it.
export function buildShareText({ streak, url }) {
  const pct = rarityForStreak(streak);
  const circles = '🟢'.repeat(streak) + '🔴';
  const line =
    streak === 0
      ? "Pushdle — busted on my very first push! 💀"
      : `Pushdle — survived ${streak} push${streak === 1 ? '' : 'es'} (top ${formatRarity(pct)}) before busting.`;
  return `${line}\n${circles}\n${url}`;
}

// Only rare-and-up badges get a flair emoji — common ones are too easy to
// use as a meaningful leaderboard flex. Keys must stay in sync with the
// allowed list in supabase/schema.sql's `selected_emoji` check constraint;
// update both together if this ever changes.
export const BADGE_EMOJI = {
  'streak-20': '⭐',
  'streak-30': '🌀',
  'streak-40': '🍀',
  'streak-50': '🎲',
  'streak-100': '🎲💯🎲',
  'bust-0': '💀',
  'days-30': '🔥',
  'days-50': '⚡',
  'days-100': '🚀',
  'pushes-200': '🟢',
  'pushes-500': '🔴',
  'pushes-1000': '💥',
  'money-streak-15': '🧓',
  'money-lifetime-2500': '🏦',
  'money-lifetime-10000': '💰',
  'money-run-50': '💵',
  'money-run-100': '🙌',
  'money-run-250': '🤑',
  'money-rank-top3': '🪿',
  'money-style-greedy': '😵',
  'money-shop-all-upgrades': '💠',
  'money-shop-diamonds-50': '💎',
  'secret-leonidas': '🗡️',
  'secret-hermes': '🪶',
  'secret-orion': '👑',
  'secret-davinci': '⚖️',
  'secret-artemis': '☄️',
  'secret-nuke': '☢️',
};

// Reverse lookup (emoji character -> that badge's rarity) — powers the
// glow/pulse effect on `special`-rarity flair wherever it renders
// (Leaderboard.jsx rows, Profile.jsx, PublicProfile.jsx). Built once here
// rather than at each render site, and keyed by the emoji itself (not
// badge id) since every render site only ever has the raw stored
// selected_emoji character in hand, not which badge it came from.
export const BADGE_EMOJI_RARITY = Object.fromEntries(
  Object.entries(BADGE_EMOJI).map(([id, emoji]) => [emoji, BADGES.find((b) => b.id === id)?.rarity])
);
