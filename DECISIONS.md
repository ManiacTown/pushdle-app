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

## Weekly money-leaderboard results modal (2026-08-09)

The Monday weekly reset (`api/weekly-money-reset.js`) previously zeroed
`money_weekly_cents` and granted the Golden Goose badge to the top 3
completely silently — no player was ever told their rank, and nobody
outside the top 3 got anything at all for a strong week. Added a real
prize structure and an announcement modal on top of the existing reset:

- **Prizes are real, not cosmetic**: 1st/2nd/3rd place get 20/15/10
  diamonds, 4th-10th get 5 each, credited straight to `money_diamonds`.
  `finalize_money_week` (new RPC, `schema.sql`) does the rank computation
  and the payout in one SQL statement.
- **Idempotency was the hard part.** Every other step in the weekly-reset
  handler is safe to retry (a boolean OR, an overwrite with the same
  value) — `money_diamonds = money_diamonds + prize` is not; retrying it
  would double-pay. Fixed by having `finalize_money_week` write its own
  `top3` result into `money_weekly_resets` as its last statement, in the
  SAME transaction as the diamond credit — so the handler's existing
  resume check (`existing[0].top3` already set) correctly detects a prior
  successful run and skips calling the RPC again, with no window where
  the credit could land without the write, or vice versa. Don't split
  those two writes back into separate calls without re-solving this.
- **New per-account snapshot columns** (`profiles.money_last_week_rank`/
  `money_last_week_score_cents`/`money_last_week_diamonds_awarded`) —
  written only by `finalize_money_week`, read by
  `MoneyWeeklyResultsModal.jsx`. `money_weekly_results_seen` gates the
  modal itself — same one-way-flag shape as `money_unlock_seen`/
  `pity_intro_seen`, except this one flips back to `false` every time
  `finalize_money_week` ranks that account again in a newly-completed
  week (it's a once-PER-WEEK ack, not once-ever).
- **Only ranked accounts ever see the modal** — `finalize_money_week` only
  touches profiles with `money_weekly_cents > 0` that week, so an account
  that didn't play money mode at all last week never has its
  `money_weekly_results_seen` flipped and the modal never triggers for it.
- **`WeeklyPodium` was extracted** out of `Leaderboard.jsx` into its own
  `src/components/WeeklyPodium.jsx` so the modal's podium graphic and the
  leaderboard page's "last week's champions" panel are the literal same
  component, not two copies that can drift apart.
- **Admin dev-tools preview** ("🐔 Preview weekly results" in Home.jsx's
  admin panel) uses the admin's own real last-week snapshot if they have
  one, falling back to a fixed 2nd-place demo otherwise — lets this be
  tested end-to-end (Golden Goose banner, podium, prize infographic) from
  a fresh admin account that's never actually ranked, same as the other
  preview dev-tools buttons never mutate the real seen-flag.

## Daredevil odds buff: 92% -> 94% (2026-09-16)

Math check (break-even pot before another push stops being +EV, using
`p·v/(1-p)` where v is the average $ value per push): at 92%, Daredevil's
ceiling was ~$35 versus baseline/Streak Bonus's ~$50/$56, despite paying
2x per push — meaning any run that went past a fairly small pot was
strictly worse off than having no upgrade at all, not a "high risk, high
reward" trade-off. 94% brings that ceiling to ~$48, close to parity with
baseline while still trailing Streak Bonus, so Daredevil no longer traps
anyone who plays a normal-length run but also doesn't dominate the other
two upgrades. `DAREDEVIL_SUCCESS_CHANCE` in `money.js` and the matching
literal in `resolve_money_push` (`schema.sql`, migration
`20260916180000_daredevil_odds_buff.sql`) were the only two places this
number lives — both display copy (`About.jsx`/`MoneyShop.jsx`) already
read from the `money.js` constant.

## Weekly bust insurance becomes a choice, not an auto-trigger (2026-09-16)

Insurance used to auto-spend itself on the very first bust of the week,
no matter how small the pot — a $6 nothing-run could burn the whole
week's insurance before a genuinely big pot ever got a chance to bust.
Now the player decides in the moment.

- **Split into two RPCs.** `resolve_money_push`'s bust branch no longer
  resolves an insurance-eligible bust inline — it parks the run in a new
  `money_runs.status = 'bust_pending_insurance'`, leaving
  `earnings_cents`/`pushes` exactly as they were pre-bust. The actual
  bank-half-or-let-it-stand logic that used to live inline there moved,
  byte-for-byte, into a new `resolve_money_insurance_decision(p_user_id,
  p_date, p_use_insurance)` RPC — called only once the player actually
  answers. Deliberately NOT a new roll of any kind: the bust already
  happened server-side; this only commits to one of two already-known
  outcomes, the same trust level `resolve_money_cashout` already has (see
  the stat-tampering incident above for why that distinction matters here
  — a client is never trusted to report an outcome, only to pick between
  ones the server already computed).
- **Declining doesn't burn insurance** — it stays armed for a later bust
  the same week. That's the actual point of this change: letting players
  save it for a pot that's actually worth insuring, instead of it being
  forced onto whatever bust happens first.
- **No timeout on the decision.** Closing the tab mid-prompt just leaves
  the row in `bust_pending_insurance` — `MoneyMode.jsx`'s existing
  load-on-mount effect picks that status back up like any other on next
  visit and the same `InsuranceDecisionModal` reappears, no separate
  "resume a pending decision" code path needed. Not eligible for the
  weekly upgrade-lock edge case (switching away from Insurance mid-week)
  since `active_money_upgrade` is already locked for the week once chosen
  (`20260820224408_money_upgrade_choice_weekly_lock.sql`).
- **Client-side, no new choreography inserted into the delicate reveal
  timers** (see the "Timer cleanup matters" principle above) — `push()`
  simply stops and does nothing further when it sees
  `'bust_pending_insurance'` (no `triggerMoneyBust`/`triggerInsuranceSave`
  yet), and `decideInsurance()` (new) calls the two existing, unmodified
  reveal functions once a real answer comes back. The impact FX (shake/
  flash/debris) and "Busted!" beat only ever play for a genuinely
  finalized bust, same as before this feature existed.
- **Found and fixed a related bug while wiring this up**: `Profile.jsx`
  and `PublicProfile.jsx`'s "Today's Money" tile computed
  `status === 'dead' ? 0 : earnings_cents` — with the new pending status,
  that would have displayed the full pre-decision pot as if already
  banked. Changed to the inverse check (`status === 'cashed_out' ? earnings_cents : 0`),
  which is correct for both the old two-status world and the new one.

## Four new push-button skins: Lucky Dice, Lucky Clover, High Roller Chip, Golden Egg (2026-09-16)

The push_skin shop category had exactly one item (`diamond_button`) since
launch, backed by its own dedicated `owns_diamond_button`/
`purchase_diamond_button`/hardcoded `active_push_skin` special case that
predates the generic `owned_cosmetics`/`purchase_cosmetic`/
`set_active_cosmetic` system auras and row styles already use. All four
new skins go through that generic system instead (`skin_` id prefix, same
shape as `aura_`/`row_`) — `diamond_button` was deliberately left alone
rather than migrated, since "it predates them and already works" was
already this codebase's stated reasoning for not touching it.

- **Art**: each is a hand-authored inline SVG (`public/skin-*.svg`)
  following the diamond icon's own recipe — circular radial-gradient
  badge, a flat two-tone-shaded object in the middle, a soft drop-shadow
  ellipse underneath. Chosen specifically because that recipe is
  vector-icon-shaped (gradients + flat polygon/path facets), not
  photoreal/painterly, so it was buildable directly in code rather than
  needing a commissioned asset. The clover's first attempt (over-lapping
  plain circles + crosshair vein lines) read as an abstract target icon,
  not a clover, when actually screenshotted — rebuilt using the standard
  "four hearts rotated 90° around a shared point" clover construction,
  which reads correctly. Verified visually via a throwaway Playwright
  script rendering the actual `.push-btn-skin` CSS against the real
  `global.css` (both at 190px button size and 36px shop-card size, in
  both playing and dead/grayscale states) — no way to preview raw SVG
  files any other way, and this also happens to be the first time this
  session's screenshot-based verification loop was used on this project.
- **New shared CSS class `.push-btn-skin`** (global.css) replaces what
  would otherwise have been 4 more near-copies of `.push-btn-diamond` —
  a single `--skin-glow` custom property (set inline per-skin from
  `cosmetics.js`'s `PUSH_SKIN_GLOW_COLORS`) parameterizes every glow via
  `color-mix(in srgb, var(--skin-glow) X%, transparent)`, replacing what
  diamond's own version hardcodes as literal `rgba(43,200,247,X)` values.
  `diamond_button` itself was left on its own dedicated class rather than
  ported to the new one — no reason to risk regressing the one skin
  that's been live and working since launch.
- **`owns_any_push_skin`** (new profile column) backs game.js's "Oooh
  Shiny" badge now instead of `owns_diamond_button` directly — that badge
  always meant "bought A push-button skin," not specifically the diamond
  one, which only mattered while it was the only option. Backfilled from
  existing `owns_diamond_button` owners in the same migration
  (`20260916210000_push_skin_cosmetics.sql`), same "recompute from what's
  already true" pattern as `20260821180500_backfill_shop_badge_tracking.sql`.
  Needed its own explicit `grant select (owns_any_push_skin) on profiles
  to anon, authenticated` — under the corrected column-level-privilege
  model from the same day's security fix, a newly added column isn't
  readable by anon/authenticated by default anymore the way it used to be
  under the old blanket table-level grant, so this is a real step now,
  not a no-op.
- **Pricing**: Dice/Clover 10 diamonds (parity with diamond_button),
  Chip 15, Golden Egg 25 (deliberately pricier — "exclusive" framing, ties
  into the existing Golden Goose weekly-#1 lore without requiring an
  actual eligibility gate).
- **Revised after first pass**: the initial icons each sat inside a
  circular gradient badge (matching diamond_button's own PNG construction
  literally). Feedback was that this read as "clicking a puck with a
  picture on it," not "clicking the object itself" — removed the badge
  circle entirely and enlarged each object (dice/clover/chip/egg) to fill
  the frame on its own, transparent background. This also means
  `.push-btn-skin`'s `filter:drop-shadow` glow now hugs each object's own
  irregular silhouette instead of a uniform circle, matching the technique
  `.money-bag-btn` already used elsewhere in this codebase (glow hugging
  the bag's own shape, not a circular box around empty space) — same
  underlying CSS mechanism, just newly applied to a second icon family.

## Fusion gradient colors: Ashy, Phoenix, Nebula (2026-09-16)

Three two-tone gradient colors — Ashy (crimson→ash-black), Phoenix
(gold→fire-orange), Nebula (violet→cyan, literally `.gradient-title`'s
own site-brand pair) — added as a premium tier alongside the existing
flat Gold/Violet/Emerald/Diamond colors, for both Name Color and Row
Background.

- **New ids, same generic system**: `aura_ashy`/`aura_phoenix`/
  `aura_nebula` and `row_ashy`/`row_phoenix`/`row_nebula` go through the
  exact same `owned_cosmetics`/`purchase_cosmetic`/`set_active_cosmetic`
  path the flat colors already use — `owns_any_aura`/`owns_any_row_style`
  already match by prefix, so no new tracking columns were needed, unlike
  the push-skin batch's `owns_any_push_skin`.
- **`AURA_GRADIENTS`/`ROW_STYLE_GRADIENTS`** (cosmetics.js) are deliberately
  SEPARATE maps from `AURA_COLORS`/`ROW_STYLE_COLORS`, not more entries in
  those — a `[start, end]` pair isn't a valid CSS `color` or plain
  `background` value on its own. Every call site that needs the real
  rendered value now goes through `auraStyle`/`auraBackground`/
  `rowStyleBackground` (gradient-or-flat, picked automatically); every
  call site that only needs one representative flat color — a border,
  a button accent, `BoughtBadge` — goes through `auraSwatchColor`/
  `rowStyleSwatchColor` (the gradient's first stop) instead, since a
  border-color/box-shadow can't be a gradient at all.
- **Re-enables gradient text for Name Color**, which had been deliberately
  removed earlier ("Visual design system" section, and `auraStyle`'s own
  prior comment) in favor of a flat "just recolor the name" look. That
  earlier decision wasn't wrong for a single flat color; a genuine
  two-tone fusion item just isn't expressible without it. `auraStyle` now
  branches: a fusion id gets `background-clip:text` + `color:transparent`
  (the same technique `.gradient-title` already used site-wide, just with
  a per-item pair instead of fixed violet/cyan stops); a flat id keeps the
  exact prior cancel-out-the-clip/plain-`color` behavior, unchanged.
- **`About.jsx`'s reference page was refactored** to iterate
  `COSMETIC_CATEGORIES` itemIds instead of `Object.entries(AURA_COLORS)`/
  `Object.entries(ROW_STYLE_COLORS)` directly — the old approach would
  have silently never shown the three new fusion items (they're not IN
  those two maps at all) without this page also being remembered and
  hand-edited a second time.
- **Pricing**: 15 diamonds for a fusion aura (vs. 8 flat), 20 for a fusion
  row (vs. 12 flat) — same "premium tier costs more" pattern as Golden
  Egg among the push skins.
- **Verified visually**: no live account/purchase needed for this one —
  rendered the exact `linear-gradient(135deg, ...)`/`background-clip:text`
  CSS this produces in a throwaway Playwright page (gradient username
  text, a leaderboard-row-shaped tint, and the small reference swatch) to
  confirm the technique actually renders as intended before calling it
  done.

## Sunday anti-sniping blackout for the weekly money leaderboard (2026-08-25)

With real diamond prizes on the line (see above), the top of the weekly
money leaderboard invited last-minute sniping — watch the board, see a
rival is $1,842 to your $1,841, push once more to edge them out right
before Monday's reset. Fix: the top 10 standings go fully invisible for
everyone on the last day of the money week (Sunday, Pacific).

- **This had to be enforced server-side, not in the UI.** A client-side
  "don't render the top 10 on Sundays" check would've been trivially
  bypassed by anyone willing to open dev tools and hit the Supabase REST
  endpoint directly with the app's own public anon/publishable key —
  `profiles` already had a blanket `grant select ... to anon,
  authenticated` with no column restriction, so `money_weekly_cents` was
  fully bulk-readable/sortable by anyone, any row, any day, regardless of
  what the React components chose to show. Fixed with a column-level
  `revoke select (money_weekly_cents) on profiles from anon,
  authenticated` — after this, a raw query for that column just fails,
  full stop, for anyone. Three new SECURITY DEFINER RPCs
  (`get_money_weekly_leaderboard`, `get_public_money_stats`,
  `get_my_weekly_cents` — `schema.sql`, "Weekly money leaderboard
  blackout" section) are the only remaining read paths, and the first two
  apply the actual masking.
- **Two separate leak paths, not just one.** The obvious fix is hiding the
  leaderboard's top 10 rows. The one that's easy to miss: a sniper doesn't
  need the leaderboard at all if they already know a specific rival's
  `/player/:id` — they can just bookmark it and refresh all day Sunday for
  that one account's live total. `get_public_money_stats` closes this
  too: during blackout, any account OTHER than the caller's own comes back
  hidden; viewing your own public profile still shows your real number.
- **The top 10 rows are OMITTED, not nulled or flagged.** `pacific_money_blackout()`
  (day check computed in Postgres itself, `extract(dow from now() at time
  zone 'America/Los_Angeles') = 0`, not trusted from the client) gates a
  `filter (where not v_blackout or rnk > 10)` on the leaderboard RPC's own
  jsonb_agg — rank 1-10 genuinely never leaves the database during
  blackout, there's nothing in the response for a client to work with even
  by accident. `hiddenCount` tells `Leaderboard.jsx` how many blurred
  placeholder rows to render in their place, with a "Stats Hidden for Last
  Day of Money Mode" card on top.
- **No exceptions, not even for your own rank.** If your own account is
  one of the withheld top 10 during blackout, you're just as absent from
  the response as everyone else there — the "You are rank #X" banner
  naturally shows nothing, same as a genuinely unranked account. Not
  special-cased; this falls straight out of the omission-based design.
- **`allRows.findIndex`/positional-index rank display broke** the moment
  leading rows could be absent — position 0 in the array can genuinely be
  rank 11 now. Every row across every Leaderboard.jsx view (streak,
  weekly, last week, lifetime) now carries its own explicit `rank` field
  set at fetch time, and both the medal/rank-color rendering and the "You
  are rank #X" banner read `row.rank`, never array position, even for the
  views that still always return a gapless list.
- **Admin preview switch** (`profiles.money_blackout_preview`, "🕶️
  Blackout preview: ON/OFF" in Home.jsx's admin panel) — a real two-way
  toggle, not a one-shot preview like the other admin buttons, since
  there's no fake data to fabricate here the way the results-modal preview
  fakes a demo rank. `pacific_money_blackout()` ORs in `exists (select 1
  from profiles where id = auth.uid() and money_blackout_preview)` —
  since `auth.uid()` always resolves to whoever is actually making THIS
  request, flipping the switch only ever changes what the flipping
  account sees; every other visitor's own calls still resolve to their
  own (false) flag and get the real board. No separate scoping logic
  needed anywhere else for that to hold.
- **Verified against production data, not a mock.** Supabase
  anon/publishable keys are meant to be public (same design intent as
  this feature's own threat model) — pulled `VITE_SUPABASE_URL`/
  `VITE_SUPABASE_ANON_KEY` straight out of the live site's shipped JS
  bundle to stand up a local `.env.local` pointed at the real project,
  confirmed the new RPCs against real rows before merging.

## Badge toast re-fired for already-owned shop/secret badges (2026-09-21, fixed)

`earnedAtRunStart` (Home.jsx) is the baseline snapshot a bust/cash-out
diffs against to find what's genuinely NEWLY earned — anything in that
baseline is treated as already-owned and skipped. It was built from an
explicit hand-picked field list (`{ bestStreak, totalPushes, dayStreak,
moneyBestBankStreak, ... }`) instead of spreading the real stats object,
reasoned at the time as avoiding polluting it with fields no badge reads.
That list was never updated when the Shop badges (`ownsAnyPushSkin`,
`ownsAnyRowStyle`, `ownsAnyAura`, `moneyDiamondsSpentLifetime`,
`ownsInsurance`/`ownsStreakBonus`/`ownsDaredevil`) or the Secret badges
(`moneyDaredevilRun200`, `clickedContact`, `moneyWeeklyWins`,
`wonWeeklyWith*`, `artemisEarned`) were added to `BADGES` — every one of
those came back `undefined` in the baseline, so `earnedBadges()` always
scored them as not-yet-earned THERE specifically, while the real
post-bust stats correctly had them earned. Net effect: every already-owned
shop/secret badge looked "newly earned" on literally every single bust or
cash-out, forever, for any account that owned one.

This is the SAME bug shape as an earlier incident (visible in this same
code's own prior comment) where omitting the money-* fields from this
exact snapshot did the identical thing to money badges specifically. Two
occurrences of the identical bug class, caused by the identical root
cause (a hand-maintained field allowlist nobody remembers to update when
`BADGES` grows), was enough to stop patching it as a list and fix the
actual pattern: `earnedAtRunStart` now spreads the whole stats object
(`earnedBadges({ ...s, bestStreak: best })`) instead of naming fields.
Confirmed safe first — `badgeIsEarned` (game.js) only ever reads
`stats[field]` for the exact field(s) each badge names, so extra
unrelated keys in the object are inert, meaning there was never a real
upside to hand-picking in the first place. Self-maintaining now: a future
badge category needs zero changes here, same as
`recordBustAndCheckBadges`'/`checkMoneyBadges`' own `earnedBadges` calls
elsewhere in this file already worked. Purely a client-side display bug —
nothing server-side was ever wrong, so no data cleanup was needed, just
the annoying repeat toast.

## Two "can't act before you've acknowledged X" gaps closed (2026-09-21)

Both were the same shape: a real gate existed (a modal that's supposed to
block you), but there was a window BEFORE that gate actually mounted
where the thing it was meant to prevent was still possible.

- **Weekly results vs. every button on the page.** The weekly-results
  modal (`MoneyWeeklyResultsModal`) only actually mounts after a 1400ms
  delay PLUS an async `money_weekly_resets` fetch — during that whole
  window, every button on the page (push, cash out, mode switch, shop)
  was fully live, so a fast player could play right through an
  unacknowledged weekly result. Fixed with the same technique
  `OnboardingModal.jsx` already uses for its own pre-appear delay: a new
  `moneyWeeklyResultsPending` flag (true the instant
  `money_weekly_results_seen === false` and a rank is known — i.e. long
  before the delayed effect gets around to calling
  `setShowMoneyWeeklyResultsModal`) renders the same invisible
  full-viewport `.onboarding-preblock` div. One flag, one div, blocks
  literally everything underneath — no per-button `disabled` threading
  needed, and it can't drift out of sync with individual buttons the way
  a hand-maintained list would.
- **Money bag vs. the weekly upgrade choice.** `MoneyUpgradeChoiceModal`
  is supposed to force a choice before playing once
  `money_upgrade_choice_seen` resets false for the week, but it only
  actually shows once `authStats` has loaded AND its own trigger effect
  has run — until then, `MoneyMode.jsx`'s bag button had no idea a choice
  was pending, so a push could land under whatever `active_money_upgrade`
  happened to still be set. Fixed by computing the identical eligibility
  condition (`moneyUpgradeChoiceSeen === false` and owns at least one
  upgrade) independently inside `MoneyMode.jsx` itself as
  `upgradeChoicePending`, and gating both `push()`'s own guard and the
  button's `disabled` prop on it — a real disable, not the "still
  clickable, routes to a poke" treatment a plain bust gets, since there's
  nothing to acknowledge with a poke here. Scoped to the bag/push button
  only (not cash-out) since the two resets that matter — the day and the
  week — always land on the same Monday-midnight-Pacific moment, so
  there's never a real in-progress run with unbanked money sitting around
  while a choice is pending to accidentally block.

## Secret badge descriptions leaked on other players' public profiles (2026-09-23, fixed)

`BadgeGrid.jsx` (shared by `Profile.jsx` — your own, interactive — and
`PublicProfile.jsx` — read-only, someone else's) masked a secret badge's
real hint as `'???'` purely on whether it was EARNED
(`!has && isSecret ? '???' : b.hint`), with zero concept of who was
actually looking at it. That's correct on your own profile (the
description IS the reward for earning it), but meant anyone could learn
exactly how to earn a secret badge just by visiting a friend's public
profile who'd already gotten it — a real spoiler leak, not a security
hole (see below).

Fixed with a new `isOwnProfile` prop on `BadgeGrid`, `true` only from
`Profile.jsx`; `PublicProfile.jsx` never passes it, so it defaults to
`false` even in the one case where the id being viewed happens to be the
current visitor's own — deliberately, matching that page's own existing
comment that `/player/:id` is always "the same thing everyone else sees,"
on purpose (that route exists specifically so clicking your own
leaderboard row shows the identical read-only view a stranger would get,
not a jump back to the editable `/profile`). New logic:
`isSecret && (!has || !isOwnProfile) ? '???' : b.hint`.

**Residual/accepted gap, not addressed**: this masking is still purely a
display-layer courtesy, not real secrecy — every secret badge's real hint
text ships as a plain string in `game.js`'s `BADGES` array, bundled into
the JS and sitting in memory regardless of this fix, so anyone who opens
devtools can already read every secret badge's condition directly. `game.js`'s
own existing comment on `BADGES` already says as much ("the masking is
purely a display-layer concern"). This fix stops the CASUAL leak (just
browsing a friend's profile) without pretending to stop a deliberate one —
doing the latter would mean moving hint text server-side and gating it per
viewer, a much bigger change nobody's asked for.
