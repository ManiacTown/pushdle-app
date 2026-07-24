// Money-variant game mode constants — separate from game.js, which is
// scoped to the classic streak game. No client-side roll to mirror here
// (unlike game.js's rollPush for guests): this mode has no guest path at
// all, every push/cash-out is server-authoritative via the money-push/
// money-cashout Edge Functions. Keep these in sync with schema.sql's
// resolve_money_push if either ever changes.
export const MONEY_SUCCESS_CHANCE = 0.95;
export const MONEY_PUSH_CENTS = 100;
export const MONEY_BONUS_CENTS = 300;
export const MONEY_BONUS_EVERY = 5;

// Every value in this design lands on a whole dollar (base $1 + $3 bonus,
// always in $1 increments) — renders as "$4", never "$4.00".
export function formatCents(cents) {
  return `$${Math.round((cents ?? 0) / 100)}`;
}
