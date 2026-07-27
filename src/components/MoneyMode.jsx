import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { useChrome } from '../lib/ChromeContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useParticles } from '../lib/useParticles.js';
import { pacificDateString, msUntilNextPacificMidnight } from '../lib/pacificDate.js';
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
} from '../lib/sound.js';
import { modeSlotStyle } from '../lib/modeTransition.js';
import { getMoneyQuote, getMoneyBustQuote, getMoneyBankQuote } from '../lib/quotes.js';

// TEMP: only reachable via Home.jsx's isAdmin-gated mode-switch button —
// see that gate's comment for the full removal plan once this is ready
// for everyone. Requires a real account (no guest path at all, unlike
// classic mode) — the money-push/money-cashout Edge Functions this calls
// are ALSO admin-gated server-side, so this component never has to
// special-case a guest itself; a guest simply has no `user` to act with.
//
// Deliberately independent from Home.jsx's own state machine (state.status
// etc.) rather than threading a third value through it — classic mode's
// bust-reveal choreography is delicate and this avoids any risk of
// regressing it. The reveal sequence below IS the same timed choreography
// as classic's runBustSequence though (identical delays), reusing the
// exact .bust-busted/.bust-rarity/.bust-reveal-row CSS — just "Busted!"/
// "Banked!" in place of always "Busted!", and "$X earned" in place of
// "TOP X%".
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const DEFAULT_RUN = { status: 'loading', pushes: 0, earningsCents: 0 };

// How long Home.jsx should wait after onMoneyResolved fires before it
// actually reveals a money-badge toast — matches this component's own
// fixed reveal-sequence length (runRevealSequence below ends at 7900ms,
// see setRevealing(false) there) plus the same 800ms chrome-uncollapse CSS
// transition classic mode's own 8000ms toast delay already accounts for
// (see Home.jsx's recordBustAndCheckBadges). Every money run — bust or
// cash-out — runs this exact same sequence, so unlike classic there's no
// shorter streak-0-style case to special-case here.
export const MONEY_BADGE_REVEAL_DELAY_MS = 8700;

export default function MoneyMode({ forceBustSignal, resetSignal, modeTransition, onMoneyResolved }) {
  const { user, stats, setStats, refreshMoneyStats } = useAuth();
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
  // Wallet panel + the coin-flies-over-then-lands animation on cash-out.
  // displayedWalletCents is its own state (not just reading stats directly)
  // so it can keep showing the OLD balance for the whole reveal and only
  // tick up right when the coin visually lands — see the sync effect below
  // and launchCoinToWallet. flyingCoin holds the measured flight path
  // (null when nothing's mid-flight); floaterAmount drives the rising
  // "+$X" text at the wallet once it lands.
  const [displayedWalletCents, setDisplayedWalletCents] = useState(() => stats?.moneyWalletCents ?? 0);
  const [flyingCoin, setFlyingCoin] = useState(null);
  const [floaterAmount, setFloaterAmount] = useState(null);
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
  // next cycle) — deliberately the SAME constant the server's actual +$3
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
  // The "+$3" floater — reuses .money-wallet-floater verbatim (same class,
  // same rise-and-fade animation) since the ask was specifically for it to
  // look exactly like the real wallet gain floater, not a bespoke effect.
  const [comboBonusText, setComboBonusText] = useState(false);
  // Quip subtext — mirrors Home.jsx's quote/bustQuote pattern (see
  // quotes.js's money-variant pools). moneyQuote cycles every 3 pushes
  // while playing (quoteBucketRef tracks which 3-push bucket it was last
  // rolled for, same technique as Home.jsx's quoteBucketRef);
  // moneyBustQuip/moneyBankQuip are each picked ONCE, right when that
  // outcome happens, and held — not re-rolled by poking.
  const [moneyQuote, setMoneyQuote] = useState(null);
  const [moneyBustQuip, setMoneyBustQuip] = useState(null);
  const [moneyBankQuip, setMoneyBankQuip] = useState(null);
  const quoteBucketRef = useRef(-1);
  const amountRef = useRef(null);
  const walletPanelRef = useRef(null);
  const cashOutBtnRef = useRef(null);
  const bagBtnRef = useRef(null);
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
  // with the reveal sequence's own start) updates `stats.moneyWalletCents`
  // immediately — this stops that from also jumping displayedWalletCents
  // ahead of the coin-landing animation, same reasoning the `flyingCoin`
  // guard below already documents.
  const suppressWalletSyncRef = useRef(false);

  useEffect(() => {
    return () => clickFxTimers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    // Hold the pre-cashout value until the coin actually lands — see
    // suppressWalletSyncRef's own comment for why this is broader than
    // just `flyingCoin` now.
    if (flyingCoin || suppressWalletSyncRef.current) return;
    setDisplayedWalletCents(stats?.moneyWalletCents ?? 0);
  }, [stats?.moneyWalletCents, flyingCoin]);

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
      .select('pushes, earnings_cents, status')
      .eq('user_id', user.id)
      .eq('date', pacificDateString())
      .maybeSingle()
      .then(({ data }) => {
        if (isCancelled && isCancelled()) return;
        const next = data
          ? { status: data.status, pushes: data.pushes, earningsCents: data.earnings_cents }
          : { status: 'playing', pushes: 0, earningsCents: 0 };
        setRun(next);
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
    setComboBonusText(false);
    setMoneyQuote(null);
    setMoneyBustQuip(null);
    setMoneyBankQuip(null);
    suppressWalletSyncRef.current = false;
    setRun(DEFAULT_RUN);
    loadTodayRun();
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

  async function push() {
    if (!user || rolling || run.status !== 'playing') return;
    setRolling(true);
    setBagAnim('pressing');
    setShowWalletPanel(false); // exits right away — see runRevealSequence for when it comes back
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
        // and a "+$3" floater — matching the real bonus this telegraphs)
        // before resetting for the next cycle — see .money-combo-fill in
        // global.css for the width transition this drives.
        setComboFill((f) => {
          const next = f + 1;
          if (next >= MONEY_BONUS_EVERY) {
            playComboFull();
            setComboIconPop(true);
            setComboBonusText(true);
            clickFxTimers.current.push(setTimeout(() => setComboIconPop(false), 500));
            clickFxTimers.current.push(setTimeout(() => setComboBonusText(false), 1200));
            clickFxTimers.current.push(setTimeout(() => setComboFill(0), 350));
            return MONEY_BONUS_EVERY;
          }
          return next;
        });
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

  async function cashOut() {
    if (!user || rolling || run.status !== 'playing' || run.pushes === 0) return;
    setRolling(true);
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
      // Deliberately NOT updating displayedWalletCents here — that happens
      // once the coin visually lands (see launchCoinToWallet), so the
      // wallet panel keeps showing the pre-cashout balance for the whole
      // reveal instead of jumping ahead of the animation. refreshMoneyStats
      // below DOES update the underlying stats.moneyWalletCents right away
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
        setTimeout(() => launchCoinToWallet(data.walletCents, data.lifetimeCents, data.earningsCents), 5700)
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
  // arrives — actually applies the new wallet/lifetime totals and shows
  // the rising "+$X" confirmation at the wallet.
  function launchCoinToWallet(walletCents, lifetimeCents, earnedCents) {
    const amountEl = amountRef.current;
    const walletEl = walletPanelRef.current;
    if (!amountEl || !walletEl) {
      // Refs not ready for some reason (very unlikely, but money should
      // never just silently vanish because an animation couldn't measure
      // itself) — apply the real update directly instead.
      setStats((prev) => ({ ...prev, moneyWalletCents: walletCents, moneyLifetimeCents: lifetimeCents }));
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
        setStats((prev) => ({ ...prev, moneyWalletCents: walletCents, moneyLifetimeCents: lifetimeCents }));
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

  if (!user) {
    return (
      <div className="panel spotlight" style={{ textAlign: 'center', padding: 24 }}>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          The money variant needs an account — guest runs have nowhere to bank earnings.
        </p>
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
            so justifyContent:center lands it dead center either way. */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: showWalletPanel ? 12 : 0,
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
              max-width:0 collapse combined with the row's gap:0 is what
              lets the run panel re-center alone. */}
          <div className={'money-wallet-panel' + (showWalletPanel ? '' : ' money-wallet-panel--collapsed')}>
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
                {formatCents(displayedWalletCents)}
              </div>
              <div className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
                bank
              </div>
              {floaterAmount != null && (
                <div className="money-wallet-floater">+{formatCents(floaterAmount)}</div>
              )}
            </div>
          </div>
        </div>

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
            instead of popping. The corner icon and "+$3" floater live in
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
              <img
                src="/money.png"
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
              {comboBonusText && (
                <div className="money-wallet-floater" style={{ left: '176px', top: '-8px' }}>+$3</div>
              )}
            </div>
          </div>
        )}

        {/* Quips — mirrors Home.jsx's quote/bustQuote fallback chain
            exactly: a picked-once idle quip once resolved (moneyBustQuip/
            moneyBankQuip), a cycling mid-run quip once pushes >= 3
            (moneyQuote), falling back to the plain static line whenever
            the relevant quip hasn't been rolled yet (e.g. the instant a
            run resolves, before that render's setMoneyBustQuip/
            setMoneyBankQuip call has landed). */}
        <div className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', ...modeSlotStyle(modeTransition, 2) }}>
          {run.status === 'dead'
            ? moneyBustQuip ?? 'Cashed-out money is always safe.'
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
                  style={banked ? { color: 'var(--neon-green)' } : undefined}
                >
                  {banked ? 'Banked!' : 'Busted!'}
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
