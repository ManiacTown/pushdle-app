// Money-variant game mode constants — separate from game.js, which is
// scoped to the classic streak game. No client-side roll to mirror here
// (unlike game.js's rollPush for guests): this mode has no guest path at
// all, every push/cash-out is server-authoritative via the money-push/
// money-cashout Edge Functions. Keep these in sync with schema.sql's
// resolve_money_push if either ever changes.
export const MONEY_SUCCESS_CHANCE = 0.97;
// Pushes #1 through this many are guaranteed successes server-side (see
// resolve_money_push's `v_chance := case when v_pushes < 10 ...` in
// schema.sql) — display-only here, same "keep in sync" reasoning as
// MONEY_SUCCESS_CHANCE above.
export const MONEY_GUARANTEED_PUSHES = 10;
export const MONEY_PUSH_CENTS = 100;
// Random, not fixed — resolve_money_push rolls a uniform $1-$5 (in $1
// steps) every time the combo bar fills. These bounds are documentation/
// reference only (e.g. for any UI copy describing the range); the actual
// roll happens server-side, same "client never knows the outcome in
// advance" reasoning as MONEY_SUCCESS_CHANCE above — nothing here computes
// or predicts a specific push's bonus.
export const MONEY_BONUS_MIN_CENTS = 100;
export const MONEY_BONUS_MAX_CENTS = 500;
export const MONEY_BONUS_EVERY = 5;

// Every value in this design lands on a whole dollar (base $1, bonus $1-$5,
// always in $1 increments) — renders as "$4", never "$4.00".
export function formatCents(cents) {
  return `$${Math.round((cents ?? 0) / 100)}`;
}

// Weekly money-leaderboard prize tiers — mirrors finalize_money_week's own
// CASE in schema.sql purely for display (MoneyWeeklyResultsModal.jsx's
// prize infographic, Home.jsx's admin preview tool). The RPC is the one
// real source of truth for what actually gets credited; keep both in sync
// if the tiers ever change.
export function diamondsForWeeklyRank(rank) {
  if (rank === 1) return 20;
  if (rank === 2) return 15;
  if (rank === 3) return 10;
  if (rank != null && rank <= 10) return 5;
  return 0;
}
