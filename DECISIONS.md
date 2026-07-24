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
