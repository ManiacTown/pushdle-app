import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { useChrome } from '../lib/ChromeContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useParticles } from '../lib/useParticles.js';
import { pacificDateString, msUntilNextPacificMidnight, formatCountdown } from '../lib/pacificDate.js';
import { MONEY_SUCCESS_CHANCE, MONEY_BONUS_EVERY, formatCents } from '../lib/money.js';
import {
  playPush,
  playSuccess,
  playBust,
  playReveal,
  playCoinCollect,
  playCoinBank,
  playPoke,
  playBankPoke,
  playBankPress,
  playComboFull,
  playDiamond,
  playInsuranceSave,
  playShieldJump,
  playNav,
} from '../lib/sound.js';
import { modeSlotStyle } from '../lib/modeTransition.js';
import { getMoneyQuote, getMoneyBustQuote, getMoneyBankQuote, getMoneyInsuranceQuote } from '../lib/quotes.js';

// Reachable via Home.jsx's mode-switch button, open to everyone who's
// played classic at least once (see hasPlayedClassic there). Requires a
// real account (no guest path at all, unlike classic mode) — the
// money-push/money-cashout Edge Functions this calls both 401 without
// one, so this component never has to special-case a guest itself; a
// guest simply has no `user` to act with.
//
// Deliberately independent from Home.jsx's own state machine (state.status
// etc.) rather than threading a third value through it — classic mode's
// bust-reveal choreography is delicate and this avoids any risk of
// regressing it. The reveal sequence below IS the same timed choreography
// as classic's runBustSequence though (identical delays), reusing the
// exact .bust-busted/.bust-rarity/.bust-reveal-row CSS — just "Busted!"/
// "Banked!" in place of always "Busted!", and "$X earned" in place of
// "TOP X%".

const DEFAULT_RUN = { status: 'loading', pushes: 0, earningsCents: 0 };

// Shared literal width for the run/wallet panel pair (see the panel row
// below) — a real fixed px value, not a flex-computed share, so the two
// always render exactly the same size regardless of either one's own
// padding/font or how many digits its dollar amount has.
const MONEY_PANEL_WIDTH = 144;
// Exported so Home.jsx's mode-switch/Shop button row can share the exact
// same gap (see the header-panel row there) instead of a second, easily-
// drifting magic number.
export const MONEY_PANEL_GAP = 12;

// How long Home.jsx should wait after onMoneyResolved fires before it
// actually reveals a money-badge toast — matches this component's own
// fixed reveal-sequence length (runRevealSequence below ends at 7900ms,
// see setRevealing(false) there) plus the same 800ms chrome-uncollapse CSS
// transition classic mode's own 8000ms toast delay already accounts for
// (see Home.jsx's recordBustAndCheckBadges). Every money run — bust or
// cash-out — runs this exact same sequence, so unlike classic there's no
// shorter streak-0-style case to special-case here.
export const MONEY_BADGE_REVEAL_DELAY_MS = 8700;

export default function MoneyMode({ forceBustSignal, resetSignal, forceDiamondSignal, modeTransition, onMoneyResolved }) {
  const { user, stats, setStats, refreshMoneyStats } = useAuth();
  const navigate = useNavigate();
  const { setCollapsed } = useChrome();
  const { particles, rings, spawnEffect, popCoin, spawnDebris, spawnSpark } = useParticles();
  const [run, setRun] = useState(DEFAULT_RUN);
  const [rolling, setRolling] = useState(false);
  const [tick, setTick] = useState(0);
  // Bust impact effects — same pair Home.jsx uses (see triggerBust there).
  const [shaking, setShaking] = useState(false);
  const [shakeAmount, setShakeAmount] = useState(6);
  const [flashKey, setFlashKey] = useState(0);
  // '' | 'pressing' | 'bouncing' — see the bagPress/bagBounce keyframes in
  // global.css. 'pressing' goes on immediately at click (before we know
  // the outcome) and holds its squashed end state through the network
  // round trip; 'bouncing' takes over once a SUCCESS response lands,
  // timed with popCoin() so the bag looks like it's flexing to launch the
  // coin. A bust never bounces — it just resets straight to '', and the
  // existing shake/flash/debris trio carries that outcome instead.
  const [bagAnim, setBagAnim] = useState('');
  // Result reveal — identical shape/timing to Home.jsx's
  // showBusted/bustedSettled/bustedSlid/showRarity/bustRevealing/instant.
  const [showLabel, setShowLabel] = useState(false);
  const [labelSettled, setLabelSettled] = useState(false);
  const [labelSlid, setLabelSlid] = useState(false);
  const [showAmount, setShowAmount] = useState(false);
  const [revealing, setRevealing] = useState(false);
  const [instant, setInstant] = useState(false);
  // Wallet/bank panel + the coin-flies-over-then-lands animation on
  // cash-out. Tracks THIS WEEK's earnings (money_weekly_cents, reset every
  // Monday by api/weekly-money-reset.js) — not a lifetime total, which is
  // what this used to show before the production launch. Lifetime still
  // exists (money_lifetime_cents) for the Lifetime leaderboard tab and
  // money-lifetime badges, just no longer displayed in this panel.
  // displayedWeeklyCents is its own state (not just reading stats
  // directly) so it can keep showing the OLD balance for the whole reveal
  // and only tick up right when the coin visually lands — see the sync
  // effect below and launchCoinToWallet. flyingCoin holds the measured
  // flight path (null when nothing's mid-flight); floaterAmount drives
  // the rising "+$X" text at the wallet once it lands.
  const [displayedWeeklyCents, setDisplayedWeeklyCents] = useState(() => stats?.moneyWeeklyCents ?? 0);
  const [flyingCoin, setFlyingCoin] = useState(null);
  const [floaterAmount, setFloaterAmount] = useState(null);
  // Same "hold the old value until the reveal's had a moment to land"
  // technique as displayedWeeklyCents above, applied to the insurance
  // status badge (see the render below) — without this, the badge would
  // flip from ARMED to USED THIS WEEK the instant the push response comes
  // back, before the player's even seen the "Insured!" reveal begin.
  // suppressInsuranceSyncRef mirrors suppressWalletSyncRef's own role.
  const [displayedInsuranceUsed, setDisplayedInsuranceUsed] = useState(() => !!stats?.insuranceUsedThisWeek);
  // Measured flight path for the shield-save animation (see
  // runInsuranceRevealSequence/insuranceBadgeRef) — null when nothing's
  // happening, same shape/pattern as flyingCoin above: appears already at
  // full (covering) size and jumps from the status badge's own position
  // straight to the bag (phase:'jump'), landing already covering it —
  // then, after a real held pause, not just a slow patch of the same
  // animation, lifts away upward and fades (phase:'lift'); see
  // .money-shield-fly--jump/--lift in global.css for the two separate
  // CSS animations this switches between. A measured start/delta rather
  // than a plain boolean since the badge can sit anywhere depending on
  // layout/viewport — this can't just be a fixed "pop over the bag"
  // position the way an earlier version was.
  const [flyingShield, setFlyingShield] = useState(null);
  // Visible before the first push and again once the result's been read —
  // hidden the instant a push actually goes out, so it "exits" the same
  // way the header/mode-switch row do while a run is in progress, just
  // sliding right instead of shrinking upward (see .money-wallet-panel in
  // global.css).
  const [showWalletPanel, setShowWalletPanel] = useState(true);
  const [impactSparkles, setImpactSparkles] = useState([]);
  // Drives the Cash Out button's own one-shot expand-then-settle bounce on
  // click (.btn-cash-out--pop) — see cashOut().
  const [bankBtnAnim, setBankBtnAnim] = useState(false);
  // Keeps the Cash Out button visible for 1.5s after it's clicked instead
  // of it vanishing the instant run.status flips off 'playing' (which
  // happens almost immediately — well before the ~7s reveal sequence even
  // gets going) — see the render condition below and cashOut().
  const [cashOutLingering, setCashOutLingering] = useState(false);
  // The bag's own "poke" flinch once a run is resolved — mirrors
  // Home.jsx's pokeBustedButton (same .push-wrap--poke bounce class,
  // reused as-is since it's plain transform, not push-specific) so the
  // bag never feels dead after busting or banking. See pokeMoneyBag.
  const [bagPoking, setBagPoking] = useState(false);
  // Combo bar below the bag — fills one notch per push, 0-MONEY_BONUS_EVERY
  // (the top value is a brief "full" hold before it resets to 0 for the
  // next cycle) — deliberately the SAME constant the server's actual
  // bonus push uses (see money.js/schema.sql's resolve_money_push), not a
  // separately-chosen bar size, so the bar always telegraphs the real
  // bonus cadence rather than an arbitrary one that could drift from it.
  // See push()'s success branch and the mount-load effect below for how
  // this stays in sync with run.pushes.
  const [comboFill, setComboFill] = useState(0);
  // The corner money-icon's one-shot "bounce up and fade away" on hitting
  // a full bar (see .money-combo-icon--pop) — cleared via a timer, at
  // which point removing the class lets the icon's own base transition
  // bring it back to its resting spot (see the CSS comment on why this
  // needs no separate "show again" step).
  const [comboIconPop, setComboIconPop] = useState(false);
  // The combo-bar "+$X" floater — reuses .money-wallet-floater verbatim
  // (same class, same rise-and-fade animation) since the ask was
  // specifically for it to look exactly like the real wallet gain floater,
  // not a bespoke effect. Holds the actual bonus amount in cents (or null
  // when nothing's showing), not just a boolean — resolve_money_push rolls
  // a random $1-$5 bonus now (used to be a flat $3), so this has to show
  // whatever that push's roll actually was, read straight off the
  // money-push response rather than assumed client-side.
  const [comboBonusCents, setComboBonusCents] = useState(null);
  // The combo-bar diamond-earned floater — same "+X" rise-and-fade slot as
  // comboBonusCents just above, but a plain boolean rather than an amount
  // since a diamond roll is always exactly +1 (see resolve_money_push's
  // mutually-exclusive money-vs-diamond branch: a full bar sets one of
  // these two, never both).
  const [comboDiamondEarned, setComboDiamondEarned] = useState(false);
  // Whether the CURRENT (still-filling) cycle will pay out a diamond once
  // it fills — this is what actually drives the corner icon's src (see
  // the combo bar JSX below), continuously for the whole cycle, not just
  // at the pop moment. Seeded from money_runs.next_bonus_is_diamond on
  // load/resume (loadTodayRun) and kept in sync off every push response's
  // nextDiamond field. On a FILL push specifically, the update is
  // deliberately deferred to the same timer that clears comboIconPop (see
  // push()'s success branch) — the server has already re-rolled the
  // NEXT cycle's value by the time that response lands, but the icon
  // popping away right now needs to keep showing what THIS cycle just
  // paid out until it's actually gone, not jump ahead mid-animation.
  const [nextIsDiamond, setNextIsDiamond] = useState(false);
  // Quip subtext — mirrors Home.jsx's quote/bustQuote pattern (see
  // quotes.js's money-variant pools). moneyQuote cycles every 3 pushes
  // while playing (quoteBucketRef tracks which 3-push bucket it was last
  // rolled for, same technique as Home.jsx's quoteBucketRef);
  // moneyBustQuip/moneyBankQuip/moneyInsuranceQuip are each picked ONCE,
  // right when that outcome happens, and held — not re-rolled by poking.
  const [moneyQuote, setMoneyQuote] = useState(null);
  const [moneyBustQuip, setMoneyBustQuip] = useState(null);
  const [moneyBankQuip, setMoneyBankQuip] = useState(null);
  const [moneyInsuranceQuip, setMoneyInsuranceQuip] = useState(null);
  // True when weekly bust insurance is what closed out THIS run (see
  // triggerInsuranceSave) — run.status is still just 'cashed_out' in the
  // data itself (same terminal state a deliberate cash-out leaves), this
  // is purely a local "how do I flavor the reveal" flag layered on top,
  // not persisted — reloading mid-idle after an insurance save just shows
  // the plain Banked! look, same simplification moneyBankQuip's own
  // pick-once-live reasoning already accepts.
  const [insuranceSaved, setInsuranceSaved] = useState(false);
  const quoteBucketRef = useRef(-1);
  const amountRef = useRef(null);
  const walletPanelRef = useRef(null);
  const cashOutBtnRef = useRef(null);
  const bagBtnRef = useRef(null);
  const insuranceBadgeRef = useRef(null);
  const lastPokeAtRef = useRef(0);
  const sparkleId = useRef(0);
  const timers = useRef([]);
  // A separate bucket from `timers` above, specifically for self-contained
  // click-feedback timers (button bounce reset, cash-out lingering clear)
  // — those need to survive runRevealSequence()'s own clearTimers() call,
  // which wipes `timers` the instant a reveal starts (it's guarding against
  // a double-click starting overlapping reveal sequences, not meant to
  // touch unrelated click feedback that was just queued a moment earlier).
  const clickFxTimers = useRef([]);
  // True from a successful cash-out response until the coin actually lands
  // (see launchCoinToWallet) — broader than the `flyingCoin` state it
  // parallels, covering the ~5.7s wait before the coin even launches too.
  // Needed because refreshMoneyStats (called right when the cash-out
  // response comes back, so onMoneyResolved's badge-diff timing lines up
  // with the reveal sequence's own start) updates `stats.moneyWeeklyCents`
  // immediately — this stops that from also jumping displayedWeeklyCents
  // ahead of the coin-landing animation, same reasoning the `flyingCoin`
  // guard below already documents.
  const suppressWalletSyncRef = useRef(false);
  // See displayedInsuranceUsed's own comment above.
  const suppressInsuranceSyncRef = useRef(false);

  useEffect(() => {
    return () => clickFxTimers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    // Hold the pre-cashout value until the coin actually lands — see
    // suppressWalletSyncRef's own comment for why this is broader than
    // just `flyingCoin` now.
    if (flyingCoin || suppressWalletSyncRef.current) return;
    setDisplayedWeeklyCents(stats?.moneyWeeklyCents ?? 0);
  }, [stats?.moneyWeeklyCents, flyingCoin]);

  useEffect(() => {
    if (suppressInsuranceSyncRef.current) return;
    setDisplayedInsuranceUsed(!!stats?.insuranceUsedThisWeek);
  }, [stats?.insuranceUsedThisWeek]);

  // Mid-run quip cycling — identical mechanics to Home.jsx's own quote
  // effect (same 3-push bucket size, same "only re-roll when the bucket
  // actually changes" guard so a quip sticks around for its full window
  // instead of re-randomizing on every render), just against run.pushes
  // instead of state.streak.
  useEffect(() => {
    if (run.status !== 'playing' || run.pushes < 3) {
      setMoneyQuote(null);
      quoteBucketRef.current = -1;
      return;
    }
    const bucket = Math.floor(run.pushes / 3);
    if (bucket !== quoteBucketRef.current) {
      quoteBucketRef.current = bucket;
      setMoneyQuote(getMoneyQuote());
    }
  }, [run.pushes, run.status]);

  // Header + nav bar collapse (see ChromeContext) whenever a run is in
  // progress OR the reveal is still choreographing itself — same rule as
  // Home.jsx's classicCollapsed (midRun || bustRevealing), just against
  // this mode's own run/reveal state.
  const midRun = run.status === 'playing' && run.pushes > 0;
  const collapsed = midRun || revealing;
  useEffect(() => {
    setCollapsed(collapsed);
  }, [collapsed, setCollapsed]);
  useEffect(() => {
    return () => setCollapsed(false);
  }, [setCollapsed]);

  // Ticks once a second purely to force a re-render, so the "next run in
  // HH:MM:SS" countdown below (which reads the live clock fresh every
  // render, not from this state) stays current — same pattern as Home.jsx.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    return () => timers.current.forEach(clearTimeout);
  }, []);

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  function resetRevealVisuals() {
    setShowLabel(false);
    setLabelSettled(false);
    setLabelSlid(false);
    setShowAmount(false);
    setRevealing(false);
    setInstant(false);
  }

  // Same two-stage bounce-in/settle-then-slide/reveal-from-right timeline
  // as Home.jsx's runBustSequence, identical delays on purpose — the ask
  // was specifically to match, not just resemble, the original's pacing.
  // The wallet panel re-entering (a little after the amount appears) and
  // the extended hold before chrome un-collapses are the two pieces that
  // don't have a classic-mode equivalent — see cashOut/launchCoinToWallet
  // for how the coin-flight timing lines up with this same schedule.
  function runRevealSequence() {
    clearTimers();
    resetRevealVisuals();
    setRevealing(true);
    timers.current.push(
      setTimeout(() => {
        setShowLabel(true);
        playReveal();
      }, 1800)
    );
    timers.current.push(setTimeout(() => setLabelSettled(true), 2600));
    timers.current.push(setTimeout(() => setLabelSlid(true), 3600));
    timers.current.push(
      setTimeout(() => {
        setShowAmount(true);
        playReveal();
      }, 4250)
    );
    // Gave the wallet panel a beat longer to reappear than its first cut —
    // 900ms after the amount reveals now (was 400ms), so "$X earned" gets
    // read on its own for a moment before the bank panel slides back in.
    timers.current.push(setTimeout(() => setShowWalletPanel(true), 5150));
    timers.current.push(setTimeout(() => setRevealing(false), 7900));
  }

  // Insurance saving a run gets its OWN timeline, not runRevealSequence's —
  // it has a real physical beat (the shield jumping onto the bag already
  // covering it, holding, then lifting away) that classic's Busted!/TOP-X%
  // pacing was never built around, and it was asked to be deliberately
  // SLOWER/more spaced-out than a normal reveal so each beat has room to
  // actually register: bust (silent beat) -> shield JUMPS to the bag
  // ALREADY AT FULL SIZE, landing already covering it -> shield finishes
  // jumping, THEN "Insured!" appears -> a real ~1.5s HOLD (the shield just
  // sits there, still covering the bag) -> shield LIFTS away upward and
  // fades (not a shrink-in-place) -> the status pill flips the moment it's
  // gone -> label slides -> "$X earned" appears -> wallet panel returns ->
  // coin flies. JUMP_MS/LIFT_MS must match @keyframes moneyShieldJump/
  // moneyShieldLift's own durations in global.css — they're driven
  // independently (this is JS setTimeout math, those are CSS animations),
  // so if one changes the other has to too.
  const JUMP_MS = 550;
  const HOLD_MS = 1500;
  const LIFT_MS = 700;
  function runInsuranceRevealSequence(data) {
    clearTimers();
    resetRevealVisuals();
    setRevealing(true);

    const jumpStart = 900; // the initial "bust" beat, held in silence
    const jumpDone = jumpStart + JUMP_MS; // shield has landed on the bag, already covering it; "Insured!" appears now
    const liftStart = jumpDone + HOLD_MS; // the shield just sits there covering the bag for a real held beat
    const liftDone = liftStart + LIFT_MS; // shield has lifted away + faded; pill flips together
    const labelSlide = liftDone + 700;
    const amountShow = labelSlide + 700;
    const walletBack = amountShow + 700;
    const coinLaunch = walletBack + 550; // lets the wallet panel finish sliding in first
    const done = coinLaunch + 1400; // coin flight (650ms) + impact settle

    // Measured once, up front, and reused for both the jump and lift
    // phases below — the badge/bag don't move mid-sequence, so there's no
    // need to re-measure between phases, just to swap which animation
    // class is applied to the same measured start/delta.
    let flight = null;
    const badge = insuranceBadgeRef.current;
    const bag = bagBtnRef.current;
    if (badge && bag) {
      const from = badge.getBoundingClientRect();
      const to = bag.getBoundingClientRect();
      const startX = from.left + from.width / 2;
      const startY = from.top + from.height / 2;
      const landX = to.left + to.width / 2;
      const landY = to.top + to.height / 2;
      flight = { startX, startY, dx: landX - startX, dy: landY - startY };
    }

    timers.current.push(
      setTimeout(() => {
        // The launch whoosh plays at the START of the jump, not layered
        // with any other cue — spacing the jump/reveal/lift sounds out
        // across their own distinct beats (rather than firing two at once)
        // is what was asked for after the first pass felt rushed.
        playShieldJump();
        if (flight) setFlyingShield({ ...flight, phase: 'jump' });
      }, jumpStart)
    );

    timers.current.push(
      setTimeout(() => {
        // The jump has physically finished arriving before this fires —
        // "Insured!" reads as a reaction to the shield having gotten
        // there, not a coincidence of timing.
        setShowLabel(true);
        playReveal();
      }, jumpDone)
    );

    timers.current.push(
      setTimeout(() => {
        if (flight) {
          setFlyingShield({ ...flight, phase: 'lift' });
          playInsuranceSave();
          spawnWalletImpact(flight.startX + flight.dx, flight.startY + flight.dy);
        }
      }, liftStart)
    );

    timers.current.push(
      setTimeout(() => {
        setFlyingShield(null);
        setLabelSettled(true);
        // Deliberately delayed this far, not instant — refreshMoneyStats
        // (called right after this returns, in push()) would otherwise
        // flip the status badge from ARMED to USED THIS WEEK the moment
        // the network response lands, long before the player's seen any
        // of this play out. Tied to the shield's own lift-and-fade
        // completing (not a separate arbitrary delay) so the pill visibly
        // switches at the exact moment the shield is gone, reading as one
        // event — the shield WAS the insurance; once it's lifted away,
        // the status is spent.
        suppressInsuranceSyncRef.current = false;
        setDisplayedInsuranceUsed(true);
      }, liftDone)
    );

    timers.current.push(setTimeout(() => setLabelSlid(true), labelSlide));
    timers.current.push(
      setTimeout(() => {
        setShowAmount(true);
        playReveal();
      }, amountShow)
    );
    timers.current.push(setTimeout(() => setShowWalletPanel(true), walletBack));
    timers.current.push(
      setTimeout(() => launchCoinToWallet(data.walletCents, data.lifetimeCents, data.weeklyCents, data.earningsCents), coinLaunch)
    );
    timers.current.push(setTimeout(() => setRevealing(false), done));
  }

  // Loads today's existing run, if any — a fresh day (or a first-ever
  // push) has no row yet, which reads as a normal not-yet-started
  // 'playing' state rather than an error. If the run was ALREADY resolved
  // before this mount (e.g. navigated away mid-reveal and back), land
  // straight at the settled end-state instead of replaying the whole
  // ~7s sequence — same reasoning as Home.jsx's loadRunState "restore an
  // already-resolved bust" path.
  useEffect(() => {
    if (!user) {
      setRun(DEFAULT_RUN);
      return;
    }
    let cancelled = false;
    loadTodayRun(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function loadTodayRun(isCancelled) {
    supabase
      .from('money_runs')
      .select('pushes, earnings_cents, status, next_bonus_is_diamond')
      .eq('user_id', user.id)
      .eq('date', pacificDateString())
      .maybeSingle()
      .then(({ data }) => {
        if (isCancelled && isCancelled()) return;
        const next = data
          ? { status: data.status, pushes: data.pushes, earningsCents: data.earnings_cents }
          : { status: 'playing', pushes: 0, earningsCents: 0 };
        setRun(next);
        // Seeds the corner icon correctly on a fresh mount/resume — a row
        // that doesn't exist yet hasn't rolled a first cycle (no pushes
        // have happened to create it), but the combo bar itself is hidden
        // until pushes > 0 anyway (see the render below), so `false` here
        // is never actually shown before the first push's own response
        // provides the real value.
        setNextIsDiamond(data ? data.next_bonus_is_diamond : false);
        if (next.status === 'dead' || next.status === 'cashed_out') {
          setInstant(true);
          setShowLabel(true);
          setLabelSettled(true);
          setLabelSlid(true);
          setShowAmount(true);
          setShowWalletPanel(true);
          // Picked once here too, not just at the moment of a live bust/
          // cash-out — otherwise refreshing the page (or switching modes
          // and back) mid-idle would fall back to the plain static text
          // instead of a quip.
          if (next.status === 'dead') setMoneyBustQuip(getMoneyBustQuote());
          else setMoneyBankQuip(getMoneyBankQuote());
        } else if (next.status === 'playing' && next.pushes > 0) {
          // Mounting straight into a run already mid-play (e.g. navigated
          // away after pushing once, then back) — the wallet panel should
          // already be in its "exited" state here too, not defaulting back
          // to visible just because this is a fresh mount. Same idea for
          // the combo bar's fill level — %MONEY_BONUS_EVERY is always the
          // correct resting value (a push count that's an exact multiple
          // means a cycle just completed and reset, never "currently full").
          setShowWalletPanel(false);
          setComboFill(next.pushes % MONEY_BONUS_EVERY);
        }
      });
  }

  // Admin dev-tool trigger (see resetSignal prop) — the server-side row was
  // just wiped (see Home.jsx's adminResetMoneyDay), so re-run the same
  // "load today's run" fetch a fresh mount would do, landing back on a
  // clean 'playing'/0-pushes state. Deliberately a signal prop rather than
  // a `key`-forced remount (which this used to be) — a full remount at this
  // exact spot (conditionally rendered by uiMode, right where a mode switch
  // ALSO swaps element types) turned out to be exactly the combination that
  // could leave a stale MoneyMode instance behind after later switching
  // back to classic (confirmed via repeated live reproduction — a classic
  // bust earlier in the session, then this key-forced remount, then
  // switching away, would occasionally fail to unmount the old instance,
  // and it'd keep sitting there invisibly, still taking up layout space).
  // Explicitly resets every other piece of local session state too, since
  // a signal-prop refresh doesn't get that "everything back to its useState
  // default" reset a real remount gave for free.
  const resetSignalRef = useRef(resetSignal);
  useEffect(() => {
    if (resetSignal === resetSignalRef.current) return; // skip the initial mount value
    resetSignalRef.current = resetSignal;
    clearTimers();
    clickFxTimers.current.forEach(clearTimeout);
    clickFxTimers.current = [];
    setRolling(false);
    setShaking(false);
    setShakeAmount(6);
    setBagAnim('');
    resetRevealVisuals();
    setFlyingCoin(null);
    setFloaterAmount(null);
    setShowWalletPanel(true);
    setImpactSparkles([]);
    setBankBtnAnim(false);
    setCashOutLingering(false);
    setBagPoking(false);
    setComboFill(0);
    setComboIconPop(false);
    setComboBonusCents(null);
    setComboDiamondEarned(false);
    setNextIsDiamond(false);
    setMoneyQuote(null);
    setMoneyBustQuip(null);
    setMoneyBankQuip(null);
    setMoneyInsuranceQuip(null);
    setInsuranceSaved(false);
    setFlyingShield(null);
    suppressWalletSyncRef.current = false;
    suppressInsuranceSyncRef.current = false;
    setDisplayedInsuranceUsed(!!stats?.insuranceUsedThisWeek);
    setRun(DEFAULT_RUN);
    // Same cancellation-guard pattern as the mount effect above, for the
    // same reason — without it, two rapid "Reset money timer" clicks fire
    // two independent loadTodayRun() queries, and whichever one's network
    // response happens to land LAST wins, even if it's the STALER of the
    // two (i.e. the one triggered by the FIRST click), silently clobbering
    // the actually-latest reset's data.
    let cancelled = false;
    loadTodayRun(() => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);

  // Shared by a real push-bust and the admin Force Bust trigger below —
  // same bust-impact trio Home.jsx's triggerBust uses: screen flash,
  // screen shake (amplitude scaled by how far the run got, same 0-1 curve
  // capped at pushes=30), and falling debris alongside the red burst —
  // spawnEffect's red burst is the "impact", spawnDebris is the wreckage
  // falling after — then the full timed reveal sequence.
  function triggerMoneyBust(pushesAtBust) {
    setBagAnim('');
    playBust();
    setFlashKey((k) => k + 1);
    const bustIntensity = Math.min(1, pushesAtBust / 30);
    setShakeAmount(4 + bustIntensity * 14);
    setShaking(true);
    timers.current.push(setTimeout(() => setShaking(false), 500));
    spawnEffect('var(--neon-red)', 24);
    spawnDebris(bustIntensity);
    setMoneyBustQuip(getMoneyBustQuote());
    runRevealSequence();
  }

  // Weekly bust insurance saved this run (see resolve_money_push's bust
  // branch in schema.sql and money-push/index.ts's insuranceUsed field) —
  // this bag still busted, so none of triggerMoneyBust's impact effects
  // (shake/flash/debris) fire; instead runInsuranceRevealSequence (see
  // above) walks through its own slower, more spaced-out timeline: the
  // shield visibly jumps off the status pill to the bag ALREADY covering
  // it, holds there for a real beat, then lifts away and fades (see
  // .money-shield-fly--jump/--lift in global.css), then the SAME
  // coin-to-wallet flight cashOut() uses — data.status is already
  // 'cashed_out' and data.earningsCents already holds the insured (halved)
  // amount, the RPC did the actual banking, this sequence is just
  // presenting it.
  function triggerInsuranceSave(data) {
    setBagAnim('');
    setInsuranceSaved(true);
    setMoneyInsuranceQuip(getMoneyInsuranceQuote());
    // Same "hold the pre-save balance through the whole reveal, only apply
    // it once the coin visually lands" reasoning as cashOut() below, and
    // same "don't let a live refreshMoneyStats jump the status badge ahead
    // of the reveal" reasoning for the insurance-sync suppression — see
    // runInsuranceRevealSequence's own comment on where that gets released.
    suppressWalletSyncRef.current = true;
    suppressInsuranceSyncRef.current = true;
    runInsuranceRevealSequence(data);
  }

  async function push() {
    if (!user || rolling || run.status !== 'playing') return;
    setRolling(true);
    setBagAnim('pressing');
    setShowWalletPanel(false); // exits right away — see runRevealSequence for when it comes back
    // Clears a stale true left over from an EARLIER run's insurance save —
    // otherwise a genuinely new run's plain cash-out (or bust) could
    // inherit the previous run's "Insured!" label/quip, since nothing else
    // resets this outside the admin resetSignal effect (see
    // insuranceSaved's own comment on why it's not derived from run.status
    // directly). Harmless to call on every push within the SAME run too —
    // it's already false until the one push that might set it true, and
    // that push ends the run either way.
    setInsuranceSaved(false);
    playPush();
    try {
      const { data, error } = await supabase.functions.invoke('money-push');
      if (error || !data) throw error ?? new Error('no response');
      setRun({ status: data.status, pushes: data.pushes, earningsCents: data.earningsCents });
      if (data.success) {
        setBagAnim('bouncing');
        popCoin();
        playSuccess(data.pushes);
        playCoinCollect();
        timers.current.push(setTimeout(() => setBagAnim(''), 450));
        // Advances the combo bar a notch per push; hitting a full bar
        // holds briefly (with its own cue, the corner icon's bounce-away,
        // and a "+$X"/"+1 diamond" floater showing whatever this push
        // actually won) before resetting for the next cycle — see
        // .money-combo-fill in global.css for the width transition this
        // drives. Gated on the server's own bonusCents/diamondEarned (not a
        // locally-recomputed "is this the 5th push" check) since that's the
        // authoritative signal for whether — and what — a reward landed.
        // The two are mutually exclusive (see resolve_money_push's 10%
        // roll), so at most one of the two floaters ever shows per fill.
        const gotBonus = data.bonusCents > 0;
        const gotDiamond = data.diamondEarned;
        setComboFill((f) => {
          if (gotBonus || gotDiamond) {
            if (gotDiamond) {
              playDiamond();
              setComboDiamondEarned(true);
            } else {
              playComboFull();
              setComboBonusCents(data.bonusCents);
            }
            setComboIconPop(true);
            // The server has ALREADY re-rolled next_bonus_is_diamond for
            // the cycle that's starting now (data.nextDiamond) by the time
            // this response lands — but flipping the corner icon's src to
            // that new value right this instant would make it change mid-
            // pop, showing the wrong icon rising away. Deferred to the
            // same 500ms mark comboIconPop itself clears, so the icon
            // finishes popping away as what THIS cycle just paid out, then
            // fades back in as whatever's coming next.
            clickFxTimers.current.push(setTimeout(() => {
              setComboIconPop(false);
              setNextIsDiamond(data.nextDiamond);
            }, 500));
            clickFxTimers.current.push(setTimeout(() => {
              setComboBonusCents(null);
              setComboDiamondEarned(false);
            }, 1200));
            clickFxTimers.current.push(setTimeout(() => setComboFill(0), 350));
            return MONEY_BONUS_EVERY;
          }
          return f + 1;
        });
        // Non-fill push — next_bonus_is_diamond didn't change server-side,
        // but keep local state in lockstep with the server's own value
        // regardless (cheap, and avoids ever silently drifting).
        if (!gotBonus && !gotDiamond) setNextIsDiamond(data.nextDiamond);
        // Diamonds are credited server-side inside resolve_money_push
        // itself (unlike the money bonus, which just adds to earningsCents
        // and rides along in `data` above), regardless of how this run
        // later ends — refresh so stats.moneyDiamonds reflects it
        // immediately rather than only after the next bust/cash-out's own
        // refreshMoneyStats call.
        if (gotDiamond) refreshMoneyStats();
      } else if (data.insuranceUsed) {
        triggerInsuranceSave(data);
        // Insurance moves real money (wallet/lifetime/weekly/streak — see
        // resolve_money_push's bust branch), same as a real cash-out —
        // refresh so those and any newly-earned badge show up immediately,
        // same reasoning as the plain-bust branch below.
        refreshMoneyStats().then((fresh) => fresh && onMoneyResolved?.(fresh));
      } else {
        triggerMoneyBust(data.pushes);
        // A bust can flip money_busted_over100 and resets money_bank_streak
        // server-side (see resolve_money_push) — refresh so those show up
        // in stats immediately instead of only after a reload, and report
        // the fresh slice up so Home.jsx can check for a newly-earned
        // badge. Fired right away, not delayed — this is just the data
        // fetch/diff; the toast's own reveal timing lives in Home.jsx.
        refreshMoneyStats().then((fresh) => fresh && onMoneyResolved?.(fresh));
      }
    } catch (err) {
      console.error('money push failed:', err);
      setBagAnim('');
    } finally {
      setRolling(false);
    }
  }

  // Admin dev-tool trigger (see forceBustSignal prop) — busts the run IN
  // PLACE via the same effects/reveal a real bust would use, rather than
  // Home.jsx remounting this component: a remount would load an
  // already-'dead' row fresh and take the "restore an already-resolved
  // run" instant path (see the load-on-mount effect above), skipping the
  // whole animated sequence this button is supposed to demonstrate.
  const forceBustSignalRef = useRef(forceBustSignal);
  useEffect(() => {
    if (forceBustSignal === forceBustSignalRef.current) return; // skip the initial mount value
    forceBustSignalRef.current = forceBustSignal;
    if (!user || run.status !== 'playing') return;
    (async () => {
      const { data, error } = await supabase.functions.invoke('admin', { body: { action: 'force_bust_money' } });
      if (error || !data?.success) {
        console.error('force bust money failed:', error ?? data);
        return;
      }
      setRun((r) => ({ ...r, status: 'dead' }));
      triggerMoneyBust(run.pushes);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceBustSignal]);

  // Admin dev-tool trigger (see forceDiamondSignal prop) — Home.jsx has
  // already told the server to force money_runs.next_bonus_is_diamond to
  // true (see adminForceMoneyDiamond there) by the time this fires; this
  // effect is just the client picking that up so the corner icon reflects
  // it right away, without waiting on the next push. A light direct
  // select, not a full loadTodayRun — that would also reset comboFill/
  // reveal state off the CURRENT row, which is exactly the in-progress
  // state this should leave alone.
  const forceDiamondSignalRef = useRef(forceDiamondSignal);
  useEffect(() => {
    if (forceDiamondSignal === forceDiamondSignalRef.current) return; // skip the initial mount value
    forceDiamondSignalRef.current = forceDiamondSignal;
    if (!user) return;
    supabase
      .from('money_runs')
      .select('next_bonus_is_diamond')
      .eq('user_id', user.id)
      .eq('date', pacificDateString())
      .maybeSingle()
      .then(({ data }) => {
        if (data) setNextIsDiamond(data.next_bonus_is_diamond);
      });
  }, [forceDiamondSignal, user]);

  async function cashOut() {
    if (!user || rolling || run.status !== 'playing' || run.pushes === 0) return;
    setRolling(true);
    // Same stale-flag guard as push()'s own — a deliberate cash-out on a
    // fresh run shouldn't inherit an earlier run's "Insured!" flavor.
    setInsuranceSaved(false);
    // Immediate click feedback — playBankPress is its own dedicated "press"
    // cue, distinct from playCoinBank (that one's reserved for the coin
    // actually landing a couple seconds later, in launchCoinToWallet, not
    // this click). Sparkles trace the button's own outline
    // (spawnBankBorderSparkles) rather than radiating from its center —
    // reads as the border itself lighting up, not a burst blowing past it.
    // The button also gets a quick expand-then-settle bounce
    // (bankBtnAnim/.btn-cash-out--pop) timed to roughly the same ~450ms.
    playBankPress();
    setBankBtnAnim(true);
    clickFxTimers.current.push(setTimeout(() => setBankBtnAnim(false), 450));
    const btn = cashOutBtnRef.current;
    if (btn) {
      spawnBankBorderSparkles(btn.getBoundingClientRect());
    }
    // Keeps the button itself visible (still bouncing, then just sitting
    // there) for a beat after the click instead of vanishing the instant
    // run.status flips away from 'playing' — see the render condition
    // below, which ORs this in.
    setCashOutLingering(true);
    clickFxTimers.current.push(setTimeout(() => setCashOutLingering(false), 1500));
    try {
      const { data, error } = await supabase.functions.invoke('money-cashout');
      if (error || !data) throw error ?? new Error('no response');
      setRun({ status: data.status, pushes: run.pushes, earningsCents: data.earningsCents });
      // Deliberately NOT updating displayedWeeklyCents here — that happens
      // once the coin visually lands (see launchCoinToWallet), so the
      // wallet panel keeps showing the pre-cashout balance for the whole
      // reveal instead of jumping ahead of the animation. refreshMoneyStats
      // below DOES update the underlying stats.moneyWeeklyCents right away
      // (so onMoneyResolved's badge-diff timing lines up with the reveal
      // sequence's own start, not 5.7s late) — suppressWalletSyncRef is
      // what keeps that from leaking into the visible wallet panel early.
      suppressWalletSyncRef.current = true;
      setMoneyBankQuip(getMoneyBankQuote());
      runRevealSequence();
      // Cash-out can move money_best_run_cents, money_weekly_cents,
      // money_best_weekly_cents, money_best_bank_streak, and
      // money_banked_after_one_push server-side (see
      // resolve_money_cashout) — refresh so those (and the badge check)
      // reflect it without a reload. Fired now, not delayed — see the
      // comment above.
      refreshMoneyStats().then((fresh) => fresh && onMoneyResolved?.(fresh));
      // Gives the "$X earned" text a beat to actually be read (it appears
      // at 4250ms, see runRevealSequence), AND lets the wallet panel
      // finish sliding back in first (re-appears at 5150ms, ~400ms
      // entrance transition — see .money-wallet-panel in global.css) —
      // otherwise the coin would be measuring/flying toward a target that's
      // still mid-slide-in, not its real resting position.
      timers.current.push(
        setTimeout(() => launchCoinToWallet(data.walletCents, data.lifetimeCents, data.weeklyCents, data.earningsCents), 5700)
      );
    } catch (err) {
      console.error('money cash-out failed:', err);
    } finally {
      setRolling(false);
    }
  }

  // Measures the live "$X earned" text and the wallet panel's own real
  // screen positions (both position:fixed-friendly viewport coordinates
  // from getBoundingClientRect, so no shared positioned ancestor is
  // needed) and animates a coin between them, then — once it visually
  // arrives — actually applies the new wallet/lifetime/weekly totals and
  // shows the rising "+$X" confirmation at the wallet. walletCents/
  // lifetimeCents still get applied to `stats` (they back the Lifetime
  // leaderboard tab and money-lifetime badges elsewhere) even though this
  // panel itself only displays weeklyCents now.
  function launchCoinToWallet(walletCents, lifetimeCents, weeklyCents, earnedCents) {
    const amountEl = amountRef.current;
    const walletEl = walletPanelRef.current;
    if (!amountEl || !walletEl) {
      // Refs not ready for some reason (very unlikely, but money should
      // never just silently vanish because an animation couldn't measure
      // itself) — apply the real update directly instead.
      setStats((prev) => ({ ...prev, moneyWalletCents: walletCents, moneyLifetimeCents: lifetimeCents, moneyWeeklyCents: weeklyCents }));
      suppressWalletSyncRef.current = false;
      return;
    }
    const from = amountEl.getBoundingClientRect();
    const to = walletEl.getBoundingClientRect();
    const startX = from.left + from.width / 2;
    const startY = from.top + from.height / 2;
    const landX = to.left + to.width / 2;
    const landY = to.top + to.height / 2;
    setFlyingCoin({ startX, startY, dx: landX - startX, dy: landY - startY });
    timers.current.push(
      setTimeout(() => {
        setFlyingCoin(null);
        suppressWalletSyncRef.current = false;
        setStats((prev) => ({ ...prev, moneyWalletCents: walletCents, moneyLifetimeCents: lifetimeCents, moneyWeeklyCents: weeklyCents }));
        setFloaterAmount(earnedCents);
        spawnWalletImpact(landX, landY);
        playCoinBank(); // the money actually hitting the bank, not the earlier click
        timers.current.push(setTimeout(() => setFloaterAmount(null), 1200));
      }, 650)
    );
  }

  // Small green/gold burst right at the wallet the instant the coin lands
  // — a separate lightweight one-off, not the shared useParticles system,
  // since that one's trajectory math is built around bursting off the
  // PUSH BUTTON specifically (see BUTTON_RADIUS in useParticles.js); this
  // needs to burst from an arbitrary screen point instead (same
  // position:fixed + measured-coordinates approach as the flying coin).
  function spawnWalletImpact(x, y) {
    const colors = ['#39ff8f', '#ffd45e'];
    const count = 10;
    const newOnes = Array.from({ length: count }).map((_, i) => {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const dist = 24 + Math.random() * 20;
      return {
        id: sparkleId.current++,
        color: colors[i % 2],
        style: {
          left: x,
          top: y,
          '--dx': `${Math.cos(angle) * dist}px`,
          '--dy': `${Math.sin(angle) * dist}px`,
        },
      };
    });
    setImpactSparkles((s) => [...s, ...newOnes]);
    const ids = newOnes.map((p) => p.id);
    timers.current.push(
      setTimeout(() => setImpactSparkles((s) => s.filter((p) => !ids.includes(p.id))), 550)
    );
  }

  // Cash Out button click feedback — traces the button's own rectangular
  // outline (walking its perimeter at even arc-length steps) rather than
  // radiating from one center point like spawnWalletImpact above, so it
  // reads as the border itself lighting up and drifting outward a touch,
  // not a burst blowing past the button. Reuses the same impactSparkles
  // array/.money-impact-spark rendering — just a different starting-point
  // distribution and a shorter travel distance.
  function spawnBankBorderSparkles(rect) {
    const { left, top, width: w, height: h } = rect;
    const perimeter = 2 * (w + h);
    const count = 22;
    const colors = ['#39ff8f', '#ffd45e'];
    const newOnes = Array.from({ length: count }).map((_, i) => {
      const d = ((i / count) * perimeter + Math.random() * (perimeter / count) * 0.6) % perimeter;
      let x, y, nx, ny;
      if (d < w) {
        x = left + d; y = top; nx = 0; ny = -1;
      } else if (d < w + h) {
        x = left + w; y = top + (d - w); nx = 1; ny = 0;
      } else if (d < 2 * w + h) {
        x = left + w - (d - w - h); y = top + h; nx = 0; ny = 1;
      } else {
        x = left; y = top + h - (d - 2 * w - h); nx = -1; ny = 0;
      }
      const dist = 10 + Math.random() * 16;
      return {
        id: sparkleId.current++,
        color: colors[i % 2],
        style: {
          left: x,
          top: y,
          '--dx': `${nx * dist}px`,
          '--dy': `${ny * dist}px`,
        },
      };
    });
    setImpactSparkles((s) => [...s, ...newOnes]);
    const ids = newOnes.map((p) => p.id);
    // clickFxTimers, not timers — this fires from cashOut() in the same
    // tick as runRevealSequence()'s own clearTimers() call, which would
    // otherwise wipe this cleanup before it ever runs (see the comment on
    // clickFxTimers' declaration).
    clickFxTimers.current.push(
      setTimeout(() => setImpactSparkles((s) => s.filter((p) => !ids.includes(p.id))), 600)
    );
  }

  // Mirrors Home.jsx's pokeBustedButton — once the run is resolved, the
  // bag stops taking real pushes but shouldn't just go dead on click
  // either. Reuses the exact same .push-wrap--poke flinch (plain
  // transform, nothing push-specific about it) plus a debounce guard for
  // the same reason pokeBustedButton has one (a double-click/fast mash
  // firing two real click events for what reads as one action). Deliberately
  // different per outcome, as asked: busted reuses spawnSpark (the same
  // red/white crack-spark classic's own poke uses) + playPoke (a dull
  // boop, fitting for prodding something broken); banked reuses
  // spawnWalletImpact (the same green/gold burst the coin landing uses,
  // anchored to the bag's own position via bagBtnRef) + playCoinCollect
  // (already a cheerful, coin-flavored cue, not otherwise used once a run
  // is over) — so poking a win feels rewarding rather than reusing the
  // bust-flavored cue for both outcomes.
  function pokeMoneyBag() {
    const now = Date.now();
    if (now - lastPokeAtRef.current < 260) return;
    lastPokeAtRef.current = now;

    setBagPoking(true);
    clickFxTimers.current.push(setTimeout(() => setBagPoking(false), 220));

    if (banked) {
      // playBankPoke, not playCoinCollect — a relaxed, gentle tone in the
      // same family as playPoke below (not the sharper sampled coin-collect
      // sound, which read as too sharp/"clinky" for an idle, already-
      // resolved moment).
      playBankPoke();
      const btn = bagBtnRef.current;
      if (btn) {
        const r = btn.getBoundingClientRect();
        spawnWalletImpact(r.left + r.width / 2, r.top + r.height / 2);
      }
    } else {
      playPoke();
      spawnSpark();
    }
  }

  // A guest can unlock Money Mode (see Home.jsx's hasPlayedClassic gate —
  // it reads local classic-mode progress the same way for guests and
  // logged-in accounts alike) and land here via the header button or
  // MoneyModeUnlockModal's "Try Money Mode" — but can't actually play it:
  // there's nowhere for a guest run to bank its earnings. Shown in place
  // of the game itself, not as an error, so this reads as "one more step"
  // rather than a dead end.
  if (!user) {
    return (
      <div className="panel spotlight" style={{ textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>🔒</div>
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>Money Mode needs an account</h3>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 18 }}>
          Guest runs have nowhere to bank earnings — create a free account to start playing.
        </p>
        <button
          className="btn-ghost"
          style={{ color: '#ffd45e', borderColor: 'rgba(255,212,94,0.5)', padding: '10px 24px', fontSize: 13 }}
          onClick={() => {
            playNav();
            navigate('/login');
          }}
        >
          Create an account →
        </button>
      </div>
    );
  }

  const resolved = run.status === 'dead' || run.status === 'cashed_out';
  const banked = run.status === 'cashed_out';

  return (
    <>
      <div
        className={shaking ? 'screen-shake' : ''}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', '--shake-amount': `${shakeAmount}px` }}
      >
        {/* Both panels are real flex children again — justifyContent:center
            centers them TOGETHER as a pair when both are visible (an
            absolute-positioned wallet panel, tried previously, kept the
            run panel dead-center alone but left the PAIR looking shifted
            right whenever both were showing, which is what actually
            matters most of the time). The run panel's own solo-centering
            (mid-push, wallet collapsed) instead comes from animating
            `gap` to 0 in lockstep with the wallet panel's own collapse —
            with a real flex sibling at max-width:0 AND gap:0, the row's
            total content width shrinks to exactly the run panel's width,
            so justifyContent:center lands it dead center either way.
            A fixed, EQUAL literal `width` on both panels (below) is what
            makes them split evenly around that center — without it, each
            panel's width came from its own content (bigger font/padding
            on the run panel, a shorter dollar string some days), so the
            pair as a whole was still centered but visibly lopsided, one
            side bulkier than the other. (Tried flex-grow with a shared
            flex-basis:0 first — in practice Chromium still let each
            panel's own padding skew the split, so a literal matching
            width for both, not a computed share, is what actually holds
            here.) The row's own width is fixed to exactly panelWidth*2 +
            gap so there's no leftover space for justifyContent to have to
            account for. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            width: MONEY_PANEL_WIDTH * 2 + MONEY_PANEL_GAP,
            gap: showWalletPanel ? MONEY_PANEL_GAP : 0,
            transition: 'gap 0.4s ease',
            marginBottom: 36,
            ...modeSlotStyle(modeTransition, 0),
          }}
        >
          {/* minHeight matches the wallet panel's own natural height
              (107px, measured — it's taller because of the vault icon on
              top of its own amount+label) so the two sit even as a pair;
              flex column + justifyContent:center is what re-centers this
              panel's shorter amount+label content within that taller box,
              rather than leaving it pinned to the top. */}
          <div
            className="spotlight"
            style={{
              background: '#06060a',
              border: '1px solid rgba(255,212,94,0.4)',
              borderRadius: 12,
              padding: '12px 30px',
              textAlign: 'center',
              minHeight: 107,
              boxSizing: 'border-box',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              width: MONEY_PANEL_WIDTH,
              flexShrink: 0,
            }}
          >
            <div className="mono hover-pop" style={{ fontWeight: 700, fontSize: 42, color: '#ffd45e' }}>
              {formatCents(run.earningsCents)}
            </div>
            <div className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
              {banked ? '' : "today's run"}
            </div>
          </div>

          {/* Visible before the first push and again once the reveal's
              read its result — hidden (via the collapsed class, not
              unmounted) while a push is actually out, "exiting right"
              the same way the header/mode-switch row exit upward. Always
              in the DOM so that transition can actually play, and so
              walletPanelRef keeps pointing at a real, measurable element
              for the coin-flight math (see launchCoinToWallet) — an
              unmount/remount would lose that between runs. A real flex
              sibling again (see the row's own comment above) — its
              width:0 collapse combined with the row's gap:0 is what lets
              the run panel re-center alone. The literal width itself
              comes from MONEY_PANEL_WIDTH via this custom property (see
              global.css) rather than being duplicated as a raw number
              there, so it can only ever match the run panel's own width. */}
          <div
            className={'money-wallet-panel' + (showWalletPanel ? '' : ' money-wallet-panel--collapsed')}
            style={{ '--wallet-panel-width': `${MONEY_PANEL_WIDTH}px` }}
          >
            <div
              ref={walletPanelRef}
              className="spotlight"
              style={{
                background: '#06060a',
                border: '1px solid rgba(57,255,143,0.4)',
                borderRadius: 12,
                padding: '12px 24px',
                textAlign: 'center',
                position: 'relative',
                minHeight: 107,
                boxSizing: 'border-box',
              }}
            >
              <img src="/vault.png" width={26} height={26} style={{ display: 'block', margin: '0 auto 6px' }} />
              <div className="mono hover-pop" style={{ fontWeight: 700, fontSize: 28, color: 'var(--neon-green)' }}>
                {formatCents(displayedWeeklyCents)}
              </div>
              {/* Was a bare "bank" — misleading once this switched from a
                  lifetime-mirroring total to money_weekly_cents (resets
                  every Monday, see displayedWeeklyCents' own comment
                  above); "banked this week" makes the reset-on-Monday
                  nature of the number legible at a glance instead of
                  reading as a permanent balance. */}
              <div className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                banked this week
              </div>
              {floaterAmount != null && (
                <div className="money-wallet-floater">+{formatCents(floaterAmount)}</div>
              )}
            </div>
          </div>
        </div>

        {/* Weekly bust insurance status (see MoneyShop.jsx/
            resolve_money_push's bust branch in schema.sql) — only shown to
            players who actually own it, same "no clutter for what you
            don't have" reasoning as the diamond-button skin only rendering
            once owned. Reads displayedInsuranceUsed (a locally-delayed
            mirror of stats.insuranceUsedThisWeek — see its own comment)
            rather than stats directly, so a live save doesn't flip this
            the instant the response lands. Still just works for admin's
            "Reset insurance timer" dev tool (see Home.jsx) via its own
            refreshMoneyStats() call — no signal prop needed, since that
            path isn't suppressed (only triggerInsuranceSave sets the
            suppress ref). Same slot as the run/wallet row above (0) since
            it's visually part of that same cluster and should animate with
            it, not independently. Red for "used" (not just dimmed) —
            deliberately reads as the OPPOSITE of armed's green, a clear
            on/off state rather than "still fine, just faded." */}
        {stats?.ownsInsurance && (
          <div
            ref={insuranceBadgeRef}
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 9,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              padding: '4px 10px',
              borderRadius: 20,
              // marginBottom, not marginTop — .money-tap-aura (the "tap"
              // label above the bag, see global.css) is absolutely
              // positioned 12px above .money-bag-wrap's own top edge,
              // entirely outside normal flow, so this badge needs real
              // clearance below it or the two visually collide regardless
              // of how far apart their own boxes sit in the document.
              marginBottom: 28,
              border: `1px solid ${displayedInsuranceUsed ? 'rgba(255,45,109,0.4)' : 'rgba(57,255,143,0.4)'}`,
              color: displayedInsuranceUsed ? 'var(--neon-red)' : 'var(--neon-green)',
              ...modeSlotStyle(modeTransition, 0),
            }}
          >
            🛡️ {displayedInsuranceUsed ? 'Insurance used this week' : 'Insurance armed'}
          </div>
        )}

        {/* poking (see pokeMoneyBag) reuses .push-wrap--poke on THIS
            wrapper, not the <button> — same reasoning as Home.jsx's own
            push-wrap: it moves the bag, the tap-aura, and the particle
            field together as one rigid piece rather than letting them
            visually separate for the ~220ms flinch. */}
        <div
          className={'money-bag-wrap' + (bagPoking ? ' push-wrap--poke' : '')}
          style={{ position: 'relative', ...modeSlotStyle(modeTransition, 1) }}
        >
          {/* Mirrors push-btn--idle-pulse's own condition exactly (playing,
              not mid-press/bounce) — same "still here, tap again" invite as
              classic's glowing border, just as a small glowing label since
              this button has no border/box to glow (see .money-bag-btn's
              own comment on why it's borderless). */}
          {run.status === 'playing' && !bagAnim && <div className="money-tap-aura">tap</div>}
          <button
            ref={bagBtnRef}
            onClick={resolved ? pokeMoneyBag : push}
            // Only truly disabled mid-network-request or before the initial
            // load-on-mount fetch has resolved ('loading') — once resolved
            // (busted/banked), clicks route to pokeMoneyBag instead of
            // being swallowed, same as classic's push button staying
            // "live" after a bust (see pokeBustedButton in Home.jsx).
            disabled={rolling || run.status === 'loading'}
            className={
              'money-bag-btn' +
              (run.status === 'dead'
                ? ' money-bag-btn--dead'
                : run.status === 'cashed_out'
                ? ' money-bag-btn--cashed'
                : ' money-bag-btn--playing' + (bagAnim ? '' : ' money-bag-btn--idle-pulse')) +
              (bagAnim === 'pressing' ? ' money-bag-btn--pressing' : '') +
              (bagAnim === 'bouncing' ? ' money-bag-btn--bouncing' : '')
            }
            style={{ width: 190, height: 190, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            {/* No button chrome — the bag image itself is the button; a
                drop-shadow glow (see the className above, in global.css)
                carries the playing/cashed-out/busted state instead of a
                circular border like classic's push-btn. */}
            <img src="/money-bag-flat.png" alt="" width={150} height={150} style={{ display: 'block', pointerEvents: 'none' }} />
          </button>
          <div className="particle-field">
            {rings.map((r) => (
              <div key={r.id} className="pulse-ring" style={{ '--ring-color': r.color }} />
            ))}
            {particles.map((p) => (
              <div
                key={p.id}
                className={'particle' + (p.debris ? ' particle--debris' : '') + (p.coin ? ' particle--coin' : '')}
                style={p.style}
              />
            ))}
          </div>
        </div>

        {/* Combo bar — MONEY_BONUS_EVERY notch-divided segments, filling
            one per push (see push()'s success branch) and resetting with
            its own cue once full. Always mounted whenever pushes > 0 so
            far this run (same "always mounted, class-toggled" technique
            as .money-wallet-panel/.money-cashout-wrap), so it can
            transition in on the first push and back out on bust/bank
            instead of popping. The corner icon and "+$X" floater live in
            .money-combo-inner, NOT .money-combo-track — the track needs
            overflow:hidden to keep the fill bar's corners clean, but that
            would clip the icon bouncing above the bar and the floater
            rising even further, so they're siblings of the track instead,
            inside a wrapper that isn't clipped. */}
        {run.pushes > 0 && (
          <div className={'money-combo-wrap' + (run.status === 'playing' ? '' : ' money-combo-wrap--collapsed')}>
            <div className="money-combo-inner">
              <div className="money-combo-track">
                <div className="money-combo-fill" style={{ width: `${(comboFill / MONEY_BONUS_EVERY) * 100}%` }} />
                {Array.from({ length: MONEY_BONUS_EVERY - 1 }).map((_, i) => (
                  <div key={i} className="money-combo-notch" style={{ left: `${((i + 1) / MONEY_BONUS_EVERY) * 100}%` }} />
                ))}
              </div>
              {/* Shows whichever reward the CURRENT cycle will pay out
                  (nextIsDiamond) for the bar's entire fill, not just at
                  the moment it fills — the roll itself already happened
                  when this cycle started (see money_runs.
                  next_bonus_is_diamond), so there's no reason to hide it
                  from the player until the last push. Still "bounces away
                  and fades back in" via money-combo-icon--pop exactly like
                  before; nextIsDiamond just doesn't switch to the NEXT
                  cycle's value until that pop's own 500ms timer (see
                  push()'s success branch), so it pops away as whatever was
                  just earned and reappears as whatever's coming next. */}
              <img
                src={nextIsDiamond ? '/diamond.png' : '/money.png'}
                alt=""
                className={'money-combo-icon' + (comboIconPop ? ' money-combo-icon--pop' : '')}
              />
              {/* Directly right of the corner icon (which sits at
                  right:-4px, width:20px within this same 160px-wide
                  .money-combo-inner — icon spans roughly x=144 to x=164)
                  rather than the base class's own centered-above-panel
                  position, which was built for the wallet panel's much
                  wider box. No color override — left as the class's own
                  default (var(--neon-green)), same "exactly how it looks
                  for banking" green as the real wallet floater. */}
              {comboBonusCents != null && (
                <div className="money-wallet-floater" style={{ left: '176px', top: '-8px' }}>
                  +{formatCents(comboBonusCents)}
                </div>
              )}
              {/* Same slot/animation as the money floater above, mutually
                  exclusive with it (see push()'s success branch) — diamond
                  blue instead of green, plus the actual diamond icon since
                  "+1" alone wouldn't read as a diamond specifically. */}
              {comboDiamondEarned && (
                <div
                  className="money-wallet-floater"
                  style={{ left: '176px', top: '-8px', color: '#2bc8f7', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <img src="/diamond.png" alt="" width={14} height={14} style={{ display: 'block' }} />
                  +1
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quips — mirrors Home.jsx's quote/bustQuote fallback chain
            exactly: a picked-once idle quip once resolved (moneyBustQuip/
            moneyBankQuip/moneyInsuranceQuip), a cycling mid-run quip once
            pushes >= 3 (moneyQuote), falling back to the plain static line
            whenever the relevant quip hasn't been rolled yet (e.g. the
            instant a run resolves, before that render's setMoneyBustQuip/
            setMoneyBankQuip/setMoneyInsuranceQuip call has landed).
            insuranceSaved is checked before the plain banked case since
            run.status is 'cashed_out' either way — see its own comment on
            why this is a separate local flag, not a third money_runs
            status. */}
        <div className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', ...modeSlotStyle(modeTransition, 2) }}>
          {run.status === 'dead'
            ? moneyBustQuip ?? 'Cashed-out money is always safe.'
            : run.status === 'cashed_out' && insuranceSaved
            ? moneyInsuranceQuip ?? 'Insurance covered half.'
            : run.status === 'cashed_out'
            ? moneyBankQuip ?? 'Nice take.'
            : run.pushes === 0
            ? `Tap to take your first push. ${Math.round(MONEY_SUCCESS_CHANCE * 100)}% survive after that.`
            : moneyQuote ?? 'Cash out any time.'}
        </div>

        {resolved && (
          <div style={{ marginTop: 24, textAlign: 'center', ...modeSlotStyle(modeTransition, 3) }}>
            <div className="bust-reveal-row">
              {showLabel && (
                <div
                  className={'bust-busted' + (labelSettled ? ' settled' : '') + (labelSlid ? ' slid' : '')}
                  style={insuranceSaved ? { color: '#2bc8f7' } : banked ? { color: 'var(--neon-green)' } : undefined}
                >
                  {insuranceSaved ? 'Insured!' : banked ? 'Banked!' : 'Busted!'}
                </div>
              )}
              {showAmount && (
                <div ref={amountRef} className={'bust-rarity' + (instant ? ' instant' : '')}>
                  {/* Busting shows $0 — you didn't actually earn anything
                      from a run you didn't bank, even though earningsCents
                      itself still holds the (now-lost) amount for the
                      wallet/lifetime split's own bookkeeping elsewhere. */}
                  <span style={{ color: '#ffd45e' }}>{formatCents(banked ? run.earningsCents : 0)} earned</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Always mounted for the rest of the run once pushes > 0 (like
            .money-wallet-panel), class-toggled rather than conditionally
            rendered straight off run.status — that would unmount the
            button the instant status flips off 'playing' (within a couple
            hundred ms of the click, long before the ~7s reveal even gets
            going), which read as it just vanishing. cashOutLingering (see
            cashOut()) holds it visible — still finishing its click bounce
            — for 1.5s after the click, then this collapses it the same
            graceful way the wallet panel exits. */}
        {run.pushes > 0 && (
          <div
            className={'money-cashout-wrap' + (run.status === 'playing' || cashOutLingering ? '' : ' money-cashout-wrap--collapsed')}
            style={modeSlotStyle(modeTransition, 3)}
          >
            <button
              ref={cashOutBtnRef}
              className={'btn-ghost btn-cash-out' + (bankBtnAnim ? ' btn-cash-out--pop' : '')}
              onClick={cashOut}
              disabled={rolling || run.status !== 'playing'}
            >
              💵 Cash out {formatCents(run.earningsCents)}
            </button>
          </div>
        )}

        {resolved && (
          <div className="mono" style={{ marginTop: 20, fontSize: 11, color: 'var(--text-dim)', ...modeSlotStyle(modeTransition, 3) }}>
            Next run in {formatCountdown(msUntilNextPacificMidnight())}
          </div>
        )}
      </div>

      {flashKey > 0 && <div key={flashKey} className="screen-flash" />}

      {/* Same position:fixed + measured-coordinates approach as the flying
          coin below — see runInsuranceRevealSequence/insuranceBadgeRef.
          className switches between the jump and lift animations (see
          global.css) as flyingShield.phase changes; the left/top/--fly-dx/
          --fly-dy stay the same measured values throughout both phases. */}
      {flyingShield && (
        <div
          className={`money-shield-fly--${flyingShield.phase}`}
          style={{
            left: flyingShield.startX,
            top: flyingShield.startY,
            '--fly-dx': `${flyingShield.dx}px`,
            '--fly-dy': `${flyingShield.dy}px`,
          }}
        >
          🛡️
        </div>
      )}

      {/* position:fixed with viewport coordinates measured directly off
          the reveal text and wallet panel (see launchCoinToWallet) — no
          shared positioned ancestor needed between two elements that far
          apart in the layout. */}
      {flyingCoin && (
        <div
          className="money-fly-coin"
          style={{
            left: flyingCoin.startX,
            top: flyingCoin.startY,
            '--fly-dx': `${flyingCoin.dx}px`,
            '--fly-dy': `${flyingCoin.dy}px`,
          }}
        />
      )}

      {/* Same position:fixed + measured-coordinates approach as the
          flying coin above — see spawnWalletImpact. */}
      {impactSparkles.map((p) => (
        <div
          key={p.id}
          className="money-impact-spark"
          style={{ left: p.style.left, top: p.style.top, '--dx': p.style['--dx'], '--dy': p.style['--dy'], background: p.color }}
        />
      ))}
    </>
  );
}
