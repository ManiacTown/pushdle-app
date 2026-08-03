// Money-variant game mode constants — separate from game.js, which is
// scoped to the classic streak game. No client-side roll to mirror here
// (unlike game.js's rollPush for guests): this mode has no guest path at
// all, every push/cash-out is server-authoritative via the money-push/
// money-cashout Edge Functions. Keep these in sync with schema.sql's
// resolve_money_push if either ever changes.
export const MONEY_SUCCESS_CHANCE = 0.97;
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
