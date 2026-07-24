# Pushdle — Design & Decisions Log

This is a condensed history of why this project is built the way it is,
distilled from the chat where it was designed. Read this before making
changes so you don't accidentally undo an intentional decision.

## The concept

A daily "push your luck" game, inspired by RNGdle (a daily random-number
game) but built around a single mechanic: press a button repeatedly, each
press has a chance of ending your run. No skill, pure nerve. Score =
number of successful presses (streak) before you bust.

We considered a "bank vs push" variant (decide after each win whether to
lock in your score or risk it) but the person chose the simpler "keep
pressing until you lose" version instead — no decision points, just
suspense. That earlier bank/push variant still exists as reference
(`pushdle.html` in outputs) but is NOT the direction going forward.

## Core game rules — do not change without asking

- **Success chance per press: 90%** (`SUCCESS_CHANCE` in `lib/game.js`).
- **First press only: 99.9% success** (`FIRST_PRESS_SUCCESS_CHANCE`).
  This exists specifically so almost nobody busts immediately — it's a
  deliberate "safety net" for the first press only. From the second press
  onward it's the normal 90%.
- **Rarity display**: `0.9^streak * 100` = the probability of surviving
  that many presses in a row = "TOP X% of runs." This is real math, not a
  flavor number — keep it accurate if the odds ever change.
- **One run per day** in the original single-file version (date-scoped
  localStorage key). Not yet ported to this multi-page app's Home page —
  worth adding.

## Daily reset boundary — Pacific midnight, not UTC

- The day/leaderboard resets at midnight in the `America/Los_Angeles`
  timezone (DST-aware — real PST in winter, real PDT in summer), not at
  UTC midnight. This was a deliberate fix, not the original design: UTC
  midnight used to land mid-afternoon/evening for Pacific-based players,
  which reset the leaderboard hours before anyone expected a new day, and
  left it looking empty/broken during actual prime playing time.
- `pacificDateString()` — `src/lib/pacificDate.js` on the client/Node side,
  mirrored in `supabase/functions/_shared/utils.ts` for the Deno Edge
  Functions (Deno can't import the client file directly) — is the single
  source of truth for "what day is it." Every place that computes "today"
  (guest `storage.js`, Home/Leaderboard/PublicProfile, the `push`/`admin`
  Edge Functions, `scripts/lib/bot-day-sim.mjs`) must go through one of
  these two, never a raw `new Date().toISOString().slice(0,10)` — that's
  UTC and will silently reintroduce the same bug.
- The bot-seeding cron (`vercel.json`) intentionally has **two** schedule
  entries — `0 7 * * *` and `0 8 * * *` UTC — both hitting the same
  endpoint. Vercel Cron only supports fixed UTC schedules, and Pacific
  midnight itself moves between those two UTC hours across the DST
  transition, so one static entry can't track it. Whichever entry lands
  first after the real Pacific midnight does the actual seeding; the other
  fires into an already-seeded day and no-ops, since `simulateAllBots`
  already skips any bot with an existing run for today's Pacific date.
  Don't collapse this back to a single entry without re-solving the DST
  problem some other way.

## Visual design system (established — reuse, don't reinvent)

- Dark, near-black background (`--bg: #08080c`) with a faint tiled
  plus-sign grid pattern (small, dark gray, tightly spaced — NOT a bright
  interactive grid, we tried that and reverted it).
- Neon accent palette: violet `#8b5cf6`, cyan `#22e5ff`, green `#39ff8f`
  (success), red `#ff2d6d` (failure/danger).
- Fonts: **Space Grotesk** for display/headings, **JetBrains Mono** for
  labels/stats/mono text. Loaded via Google Fonts.
- Buttons and panels lean on outer glow (`box-shadow`) rather than
  gradient/gloss fills — we explicitly moved away from a "light shining
  on a sphere" look toward flat fills + neon outline + glow, because it
  reads more like actual neon signage.
- The push button is a perfect circle (`aspect-ratio: 1/1` + flex
  centering), and importantly **the button's position never moves**,
  even when other UI around it animates. This was a specific fix — an
  earlier version accidentally let the whole stage shift when the header
  collapsed; now only the streak chip moves independently via
  `position: relative` + `top` offset, which doesn't disturb sibling
  layout the way flow-based reflow does.

## Interaction patterns already validated (keep these principles)

- **Idle → hover transitions must not fight CSS animations.** We hit this
  bug twice: an element with an active `animation` (even one that's
  finished and is just holding its `forwards` end-state) will silently
  block `:hover` rules from changing the same property. Fix pattern: once
  a bounce/pulse animation finishes, swap the animation class for a
  plain "settled" class that uses a normal `transition` instead — only
  then does `:hover` actually work. Watch for this bug in any new bounce/
  pulse effects.
- **Timer cleanup matters.** The bust sequence (Busted! → rarity reveal →
  panels) runs on chained `setTimeout`s. If the player triggers a reset
  while those are still pending, the stale timers were firing later and
  undoing the reset. Fix: track every timer ID in an array and clear all
  of them at the start of any reset action. Apply this pattern to any
  future multi-step timed sequence.
- **Spotlight hover on panels**: cards (header, result, leaderboard) use
  a cursor-tracked radial gradient (`--mx`/`--my` custom properties set
  on `mousemove`) for a subtle "premium dashboard" glow. Keep this
  consistent if new panel-style pages are added.
- **Bust sequence pacing** (currently in the single-file prototype, not
  yet in this app): "Busted!" bounces in at 1.0s, fades out at 4.5s;
  "TOP X%" bounces in at 2.5s and *persists* (does not fade) — when
  Busted! fades, TOP X% eases upward to fill the freed space rather than
  leaving a gap. This timing was iterated on repeatedly — treat it as
  deliberate, not arbitrary.

## Architecture decisions for this React app specifically

- `lib/storage.js` is the **only** place allowed to touch `localStorage`.
  Every function in it is `async` on purpose, even though localStorage is
  synchronous — so that swapping in a real backend (Supabase/Firebase/
  custom API) later only requires changing this one file, not every page
  that reads/writes data.
- `lib/AuthContext.jsx` is a mock auth provider shaped like a real one
  (`user`, `login()`, `logout()`) specifically so swapping in real auth
  doesn't change how pages consume it.
- `lib/game.js` holds shared pure logic (odds, rarity math, badge
  thresholds) so Home, Profile, and Leaderboard don't duplicate it.
- Pages are intentionally simple/unstyled-inline right now — the single-
  file prototype has much richer micro-interactions (particle bursts,
  screen flash, staggered panel reveals, the full bust sequence) that
  were deliberately left out of this scaffold to keep the initial React
  port small and verifiably working. Porting them in is expected next
  work, not an oversight.

## Explicitly deferred / not done yet

- Real accounts (current login is a placeholder that just stores a
  username locally).
- Real cross-device leaderboard (currently simulated with fake names and
  the same 90% odds math, both in the single-file prototype and this app).
- One-run-per-day enforcement in the React app (exists in the single-file
  prototype via a date-scoped storage key, not yet ported).
- Particle bursts, screen flash, the full staggered bust-sequence timing,
  and most hover micro-interactions from the single-file prototype.

## Reference files

- `pushdle-purestreak.html` — the most complete single-file prototype,
  most visual/motion polish lives here. Good source to port FROM.
- `pushdle.html` — earlier bank/push variant, kept for reference only,
  not the current direction.

## Money-variant game mode (admin-gated, in progress)

A second game mode layered onto the same Home page: instead of building a
streak, each push earns accumulating in-game currency ($1/push, +$3 bonus
every 5th push), busting loses only the *current run's* unbanked earnings,
and the player can cash out any time to bank it permanently. Currently
**gated behind `isAdmin` end-to-end** — not visible to real players yet;
this is a deliberate, easily-reversible temporary gate (grep `isAdmin &&`
in Home.jsx and the money-push/money-cashout/admin Edge Functions), not a
finished/shipped feature.

- **Schema**: parallel `money_runs` table (not a `mode` column on
  `daily_runs` — different terminal states/columns entirely), plus
  `profiles.money_wallet_cents` (spendable) and `profiles.money_lifetime_cents`
  (leaderboard rank, only ever increases) — split so a future shop can
  spend the wallet without ever lowering leaderboard rank.
- **RPCs**: `resolve_money_push`/`resolve_money_cashout` (security definer,
  service-role only, row-locked), mirroring `resolve_push`'s pattern. Push
  never touches `profiles` at all — only cash-out moves money out of the
  run into the permanent columns, which is what makes "bust only loses
  unbanked earnings" automatic.
- **Edge Functions**: `money-push`, `money-cashout` — both re-check
  `isAdmin` server-side (the actual enforcement point; the RPCs themselves
  are revoked from anon/authenticated).
- **Client**: `src/components/MoneyMode.jsx` is a deliberately independent
  component (not threaded through Home.jsx's classic `state.status`
  machine) — its bust-reveal choreography intentionally mirrors classic's
  `runBustSequence` timing almost exactly, reusing the same `.bust-busted`/
  `.bust-rarity` CSS. `src/lib/useParticles.js` was extracted out of
  Home.jsx so both modes share the particle-burst system.
- **Current polish state** (all implemented, locally tested, not yet
  playable by real users due to the admin gate): money-bag button with
  press/bounce physics and coin-pop-with-real-gravity trajectory; full
  bust/bank reveal sequence matching classic's pacing; a wallet ("bank")
  panel next to the run panel that stays visible pre-push, exits right
  during a push, and reappears with a coin-flight-and-landing animation
  (green/gold sparkle burst + sound on landing); a "tap" glow inviting the
  next push, mirroring classic's busted-idle glow; a staggered slide
  transition between classic ↔ money mode (`src/lib/modeTransition.js` —
  shared timing/direction logic so both modes' JSX animate off the same
  numbers); real sound effects (`public/coin_collect.mp3`,
  `public/coin_bank.mp3`) alongside the existing synthesized cues in
  `lib/sound.js`.
- **Known-fixed bug worth knowing about**: the wallet panel used to show
  `$0` before the first push instead of the real persistent balance. Root
  cause was in `AuthContext.jsx` — the login-time `sync-stats` merge did
  `setStats(data)` (a full overwrite) while a separate, independently-timed
  fetch for `moneyWalletCents`/`moneyLifetimeCents` merged via
  `setStats(prev => ({...prev, ...}))`. Whichever resolved second won; if
  `sync-stats` landed after the wallet fetch, it silently wiped the money
  fields back to `undefined`. Fixed by making both merge instead of
  overwrite. If a similar "stats look right sometimes, wrong other times"
  bug ever resurfaces, suspect a `setStats(fullObject)` call somewhere that
  should be a functional merge instead.
- **Not built yet**: a real shop/purchase flow (`MoneyShop.jsx` is a shell
  — wallet balance shown, item cards disabled/"coming soon", no
  `spend_money` RPC yet). Removing the admin gate for public rollout is a
  separate future step once the mechanic itself has been validated further.

## Security incident: stat tampering via `sync-stats` (2026-07-24, fixed)

An account (`acheron`) was found with `best_streak: 999999999` and
`total_pushes: 323434243` — discovered by eyeballing the Supabase table
editor, not any automated alert (there isn't one yet — see below).

**Root cause**: `merge_local_stats` (in `schema.sql`) exists so a
brand-new signup's pre-account `localStorage` progress survives becoming
server-authoritative — it does `best_streak = greatest(current, submitted)`
etc., "only ever raises, never lowers." The `sync-stats` Edge Function
that calls it took the submitted numbers straight from the client's
request body with **no validation at all**. Since this ran on every login
(not just once) with no bound on the values, any logged-in user could call
`sync-stats` directly — bypassing the actual game entirely — with a
hand-forged body (`{ bestStreak: 999999999, ... }`) and permanently inflate
their own stats. Confirmed by reading `supabase/functions/sync-stats/index.ts`
and `merge_local_stats` directly; the round, absurd submitted numbers are
the signature of someone typing values into a forged request, not a game
bug.

**Fix (two independent layers, either alone now closes the hole)**:
1. `sync-stats/index.ts` rejects the request outright (HTTP 400) if
   `totalPushes > 100,000`, anything is negative, or `bestStreak > totalPushes`
   (a streak can never exceed the pushes it took to build it — a free
   invariant that was never checked before).
2. `profiles.stats_migrated` (new column) makes `merge_local_stats` a
   no-op past the first successful call per account — there's nothing
   legitimate left to merge after that anyway. All existing accounts were
   backfilled to `stats_migrated = true` immediately so nobody gets a
   bonus free merge under the new logic.

`acheron`'s `best_streak`/`total_pushes` were reset to 0. Both layers were
verified live: a forged `999999999`-style payload now gets a 400; a
plausible-looking forged payload (`9999`/`9999`) on an already-migrated
account comes back completely unchanged.

**Residual risk / what this doesn't cover**: this was narrowly scoped to
`merge_local_stats` — the one place in the whole schema that trusted a
client-submitted number in a "take the max" write. Everything else
players' scores/currency run through (`resolve_push`, `resolve_money_push`,
`resolve_money_cashout`) computes results **entirely server-side** from
scratch (dice rolls happen in the RPC itself via `random()`, never trusting
a client-reported outcome) — that pattern was already correct and wasn't
part of this incident. If a similar bug is ever suspected again: grep for
any RPC/Edge Function that takes a numeric value from `req.json()` or a
function argument and writes it (even via `greatest()`/a monotonic
merge) without a plausibility bound — that shape is what to distrust.
There's still no automated anomaly alerting (a scheduled query flagging
implausible jumps, e.g.) — this incident was caught by manually looking at
the table editor, not tooling. Worth adding if this class of bug matters
enough to want to catch it faster next time.
