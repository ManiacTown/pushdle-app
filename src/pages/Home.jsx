import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as storage from '../lib/storage.js';
import { pacificDateString, msUntilNextPacificMidnight, formatCountdown } from '../lib/pacificDate.js';
import {
  rollPush,
  rarityForStreak,
  formatRarity,
  earnedBadges,
  buildShareText,
  BADGES,
  maxStatsForAllBadges,
  zeroStatsForAllBadges,
  camelToSnakeFields,
  FIRST_RUN_GUARANTEE_STREAK,
  PITY_GUARANTEE_STREAK,
  PITY_CHARGES_NEEDED,
} from '../lib/game.js';
import { getQuoteForStreak, getBustQuoteForStreak, getPokeQuip } from '../lib/quotes.js';
import { MONEY_SUCCESS_CHANCE, diamondsForWeeklyRank } from '../lib/money.js';
import { modeSlotStyle, MODE_TRANSITION_PHASE_MS } from '../lib/modeTransition.js';
import { playPush, playSuccess, playBust, playBadge, playNav, playReveal, playPoke, playShopOpen, playShopClose } from '../lib/sound.js';
import { spotlightMove } from '../lib/spotlight.js';
import { useChrome } from '../lib/ChromeContext.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useParticles } from '../lib/useParticles.js';
import { hasSeenOnboardingLocally } from '../lib/onboarding.js';
import { hasSeenMoneyUnlockLocally, markMoneyUnlockSeenLocally } from '../lib/moneyUnlock.js';
import OnboardingModal from '../components/OnboardingModal.jsx';
import MoneyModeUnlockModal from '../components/MoneyModeUnlockModal.jsx';
import PityIntroModal from '../components/PityIntroModal.jsx';
import MoneyWeeklyResultsModal from '../components/MoneyWeeklyResultsModal.jsx';
import MoneyUpgradeChoiceModal from '../components/MoneyUpgradeChoiceModal.jsx';
import ModifierUpdateModal from '../components/ModifierUpdateModal.jsx';
import MoneyMode, { MONEY_BADGE_REVEAL_DELAY_MS, MONEY_PANEL_GAP } from '../components/MoneyMode.jsx';
import MoneyShop from '../components/MoneyShop.jsx';
import BadgeToastStack from '../components/BadgeToast.jsx';

const DEFAULT_STATS = { totalPushes: 0, dayStreak: 0, lastPlayedDate: null, bustedAtZero: false, bustedAtOne: false };
// The "intensity" system (button heartbeat + background glow, see the
// effect below) doesn't start ramping until the streak passes this —
// early pushes stay at the calm resting baseline the whole way through.
const INTENSITY_START_STREAK = 15;
// How long the Comeback Boost meter's fill-up animation runs for (see
// bust() below) — must match .pity-meter-fill's own `transition: width`
// duration in global.css, since this is also how long interaction stays
// blocked for (pityFillBlocking) and the spotlight dim stays up, timed to
// the CSS animation actually finishing rather than an arbitrary guess.
const PITY_FILL_ANIM_MS = 3200;
// How long after a bust the fill-reveal waits before starting, for a
// streak > 0 bust specifically — matches runBustSequence's own final
// setBustRevealing(false) mark (6850ms), i.e. the exact moment the rest of
// the chrome finishes un-collapsing, so the meter's own reveal lines up
// with "the panels have reset" rather than fighting the reveal for
// attention mid-choreography. A streak-0 bust never collapses chrome in
// the first place (see runBustSequence), so it uses a short fixed delay
// instead — just enough to clear the initial bust flash/thud.
const PITY_FILL_REVEAL_DELAY_STREAK_0_MS = 400;
const PITY_FILL_REVEAL_DELAY_MS = 6850;

export default function Home() {
  const [state, setState] = useState({ streak: 0, status: 'playing', newBestToday: false });
  const [bestStreak, setBestStreakState] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [showBusted, setShowBusted] = useState(false);
  const [bustedSettled, setBustedSettled] = useState(false);
  const [bustedSlid, setBustedSlid] = useState(false);
  const [showRarity, setShowRarity] = useState(false);
  const [bustRevealing, setBustRevealing] = useState(false);
  const { particles, rings, spawnEffect, spawnDebris, spawnSpark, clearParticles } = useParticles();
  const [flashKey, setFlashKey] = useState(0);
  // Bust impact effects — see triggerBust. shaking gates whether the
  // .screen-shake class/animation is applied at all; shakeAmount is its
  // amplitude in px (read via the --shake-amount CSS var).
  const [shaking, setShaking] = useState(false);
  const [shakeAmount, setShakeAmount] = useState(6);
  const [tick, setTick] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  // Admin dev-tools "summon onboarding" preview — see OnboardingModal.jsx's
  // forceOpen prop.
  const [forceShowOnboarding, setForceShowOnboarding] = useState(false);
  // Celebratory modal (see MoneyModeUnlockModal.jsx) shown once per
  // account, gated by profiles.money_unlock_seen — see the effect below
  // (near the other useLayoutEffects) for the actual trigger condition.
  const [showMoneyUnlockModal, setShowMoneyUnlockModal] = useState(false);
  // True only when the admin dev-tools button summoned this for
  // preview/QA (see the "🎉 Preview money unlock" button below) — a
  // preview dismissal must NOT call markMoneyUnlockSeen, or previewing it
  // would consume a real player's actual one-time unlock moment.
  const [moneyUnlockPreview, setMoneyUnlockPreview] = useState(false);
  // Explainer modal (see PityIntroModal.jsx) shown once per account, the
  // first time the Comeback Boost meter's fill animation actually plays —
  // see schedulePityFillReveal for the real trigger, gated by
  // profiles.pity_intro_seen.
  const [showPityIntroModal, setShowPityIntroModal] = useState(false);
  // Same preview-flag reasoning as moneyUnlockPreview above — an admin
  // dev-tools summon must NOT call markPityIntroSeen, or previewing it
  // would consume a real player's actual one-time explainer moment.
  const [pityIntroPreview, setPityIntroPreview] = useState(false);
  // Weekly results modal (see MoneyWeeklyResultsModal.jsx) — shown once
  // per completed week to any account finalize_money_week actually
  // ranked, gated by profiles.money_weekly_results_seen. moneyWeeklyResultsData
  // holds the {rank, scoreCents, diamondsAwarded, top3} snapshot for
  // whichever trigger (real or admin preview) opened it — set right
  // before setShowMoneyWeeklyResultsModal(true) either way, so the modal
  // itself never has to know which path populated it.
  const [showMoneyWeeklyResultsModal, setShowMoneyWeeklyResultsModal] = useState(false);
  const [moneyWeeklyResultsData, setMoneyWeeklyResultsData] = useState(null);
  // Same preview-flag reasoning as moneyUnlockPreview/pityIntroPreview
  // above — an admin dev-tools summon must NOT call
  // markMoneyWeeklyResultsSeen, or previewing it would consume this
  // account's own real unseen-results moment.
  const [moneyWeeklyResultsPreview, setMoneyWeeklyResultsPreview] = useState(false);
  // Weekly upgrade-choice modal (see MoneyUpgradeChoiceModal.jsx) — shown
  // once per money week, the first time an account with at least one owned
  // upgrade actually enters Money Mode after money_upgrade_choice_seen
  // resets false. No preview-data state needed the way the results modal
  // has (moneyWeeklyResultsData) — this one only ever shows this account's
  // own real owned-upgrades/active-upgrade snapshot, nothing to fabricate.
  const [showMoneyUpgradeChoiceModal, setShowMoneyUpgradeChoiceModal] = useState(false);
  // "What's new" recap (see ModifierUpdateModal.jsx) — shown once to any
  // logged-in account on login, gated on profiles.modifier_update_seen. No
  // preview-data state needed, same reasoning as MoneyUpgradeChoiceModal
  // above — this one only ever shows its own static, hand-written content.
  const [showModifierUpdateModal, setShowModifierUpdateModal] = useState(false);
  // Same preview-flag reasoning as moneyWeeklyResultsPreview above — an
  // admin dev-tools summon must NOT call markModifierUpdateSeen, or
  // previewing it would consume this account's own real one-time moment.
  const [modifierUpdatePreview, setModifierUpdatePreview] = useState(false);
  // Money-variant mode switch — open to everyone (see hasPlayedClassic
  // below for the one real requirement). Not persisted across reloads —
  // always starts back on classic.
  const [uiMode, setUiMode] = useState('classic');
  // Retriggers the odds-text flash below every time the mode actually
  // changes — keyed remount (same trick as flashKey/screen-flash) is what
  // lets the same CSS animation restart from its 0% keyframe on every
  // switch, not just the first time.
  const [oddsFlashKey, setOddsFlashKey] = useState(0);
  useEffect(() => {
    setOddsFlashKey((k) => k + 1);
  }, [uiMode]);
  // Mirrors uiMode for revealBadgeToast below, which needs the LIVE mode at
  // the moment a scheduled reveal actually fires — a bust/cash-out can
  // resolve (server round trip included) well after the user's already
  // switched away from the mode that earned it, and a reveal scheduled
  // before that switch doesn't get cancelled just because dismissBadgeToast
  // ran first (there was nothing pending yet to cancel).
  const uiModeRef = useRef(uiMode);
  useEffect(() => {
    uiModeRef.current = uiMode;
  }, [uiMode]);
  // Drives the staggered slide transition between classic/money content —
  // null outside a switch. See src/lib/modeTransition.js for what each
  // phase/direction actually renders as; startModeSwitch below is what
  // sequences exit -> flip uiMode -> enter -> clear, since only one mode's
  // JSX is ever mounted at a time (this is a sequential swap, not two
  // trees sliding past each other simultaneously).
  const [modeTransition, setModeTransition] = useState(null);
  function startModeSwitch(target) {
    if (modeTransition || target === uiMode) return;
    // Money mode is gated behind having played classic at least once —
    // see hasPlayedClassic's own declaration/comment below for the actual
    // check. Kept here too (not just on the button that's hidden until
    // it's true) so any other future call site can't skip the
    // requirement.
    if (target === 'money' && !hasPlayedClassic) return;
    playNav(); // reused as-is — already described as "a light, airy tick"
    // A toast earned in the mode we're LEAVING shouldn't just vanish when
    // that mode's component unmounts a moment from now — start its exit
    // animation right away so it's finished (or nearly so) by the time the
    // swap below actually happens.
    dismissBadgeToast();
    // The shop only makes sense inside money mode (see the `uiMode ===
    // 'money' &&` guard around it below) — closing it here means it's
    // already gone by the time MoneyMode itself unmounts, instead of
    // leaving it open (invisible, but still mounted) behind classic mode
    // until the next time someone reopens it.
    if (target === 'classic') setShowMoneyShop(false);
    const direction = target === 'money' ? 'forward' : 'backward';
    setModeTransition({ direction, phase: 'exit' });
    setTimeout(() => {
      setUiMode(target);
      setModeTransition({ direction, phase: 'enter' });
      setTimeout(() => setModeTransition(null), MODE_TRANSITION_PHASE_MS);
    }, MODE_TRANSITION_PHASE_MS);
  }
  const [showMoneyShop, setShowMoneyShop] = useState(false);
  // Bumped by adminResetMoneyDay to tell MoneyMode to re-fetch a clean run
  // state after its server-side row gets wiped — a signal prop MoneyMode
  // itself reacts to (see its own resetSignal effect), not a `key`-forced
  // remount like this used to be. A remount right at this exact spot
  // (conditionally rendered by uiMode, where a mode switch ALSO swaps
  // element types) turned out to risk leaving a stale MoneyMode instance
  // behind after later switching back to classic — confirmed via repeated
  // live reproduction, see MoneyMode.jsx's own comment on resetSignal.
  const [moneyResetSignal, setMoneyResetSignal] = useState(0);
  // Bumped by the Force Bust button (when uiMode==='money') to tell
  // MoneyMode to bust itself in place — see the comment above
  // adminForceBustMoney's old body for why this can't just be another
  // signal-prop-triggered reset.
  const [moneyForceBustSignal, setMoneyForceBustSignal] = useState(0);
  // Bumped by the "Force diamond next" dev button to tell MoneyMode to
  // re-read money_runs.next_bonus_is_diamond after adminForceMoneyDiamond
  // has set it server-side — see MoneyMode.jsx's own forceDiamondSignal
  // effect for why this is a light re-fetch rather than a full reset.
  const [moneyForceDiamondSignal, setMoneyForceDiamondSignal] = useState(0);
  const [buttonHover, setButtonHover] = useState(false);
  const [stats, setStats] = useState(DEFAULT_STATS);
  const [earnedAtRunStart, setEarnedAtRunStart] = useState(new Set());
  // Comeback Boost pity meter's own displayed value — deliberately NOT
  // read straight off authStats.pityCount. A bust that adds a charge
  // updates authStats immediately (see bust/recordBustAndCheckBadges), but
  // the METER shouldn't visibly jump until the bust reveal has fully
  // settled — see the fill-reveal scheduling in bust() below, which is
  // the only place this changes for an "add" outcome; every other outcome
  // (clear/consume/no-op) just syncs it immediately since the meter isn't
  // even visible mid-run/mid-reveal to notice.
  const [displayedPityCount, setDisplayedPityCount] = useState(0);
  // True for exactly the duration of the meter's fill-up animation after a
  // qualifying bust (see PITY_FILL_ANIM_MS) — blocks interaction so the
  // player just watches it happen instead of already mashing Push again.
  const [pityFillBlocking, setPityFillBlocking] = useState(false);
  const [newBadges, setNewBadges] = useState([]);
  const [showBadges, setShowBadges] = useState(false);
  // True for exactly the duration of the toast's exit animation (see
  // dismissBadgeToast below and global.css's .badge-toast-stack.leaving) —
  // showBadges/newBadges stay populated the whole time so the toast keeps
  // rendering (now with the .leaving class) instead of unmounting instantly.
  const [badgesLeaving, setBadgesLeaving] = useState(false);
  // The default "1 in 10 chance this ends it." subtext, once the streak
  // reaches 3, gets replaced by one of these — re-rolled every 3 pushes
  // (see the effect below), not every push, so each one actually gets a
  // moment to be read instead of flickering past.
  const [quote, setQuote] = useState(null);
  const quoteBucketRef = useRef(-1);
  // "Run over. Come back tomorrow." — replaced by one of these once busted,
  // picked once (at the moment of busting, or on mount if reloading an
  // already-busted-today page — see triggerBust and the mount-restore
  // block below) rather than rotating, since a bust is a single terminal
  // event, not an ongoing thing to keep re-flavoring.
  const [bustQuote, setBustQuote] = useState(null);
  // True only when restoring an already-resolved bust on mount (navigating
  // back to an already-busted-today page) — skips the rarity/badge entrance
  // animations, which otherwise replay their slide-in from scratch every
  // time, since those elements have no "already settled" state of their own
  // the way .bust-busted does.
  const [instant, setInstant] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  // Clicking the busted button doesn't do anything to the run (there's
  // nothing left to push) but it shouldn't feel like clicking a dead
  // element either — see pokeBustedButton. poking gates a quick one-off
  // flinch animation on just the button itself (not the whole-screen
  // .screen-shake reserved for the actual bust impact); pokeQuip is a
  // transient one-liner that briefly takes over the subtext in place of
  // bustQuote, then hands it back.
  const [poking, setPoking] = useState(false);
  const [pokeQuip, setPokeQuip] = useState(null);
  const pokeCountRef = useRef(0);
  // A double-click (or just fast mashing) fires two real click events for
  // what a user experiences as one action — without this, that silently
  // advances pokeCountRef an extra step, throwing off "every 3rd click"
  // from the user's own perspective even though the code's modulo math is
  // correct. Anything under this since the last COUNTED poke is ignored
  // rather than incrementing the counter again.
  const lastPokeAtRef = useRef(0);
  // Tracks the ONE pending "hide the quip" timeout, so a poke that lands
  // while a previous quip is still on screen replaces that timeout instead
  // of leaving the old one running too — two pending clears would race,
  // and whichever fires first would cut the (newer, still-fresh) quip's
  // display short.
  const pokeQuipTimerRef = useRef(null);
  const timers = useRef([]);
  // The timeout id of a badge-toast reveal that's been scheduled but
  // hasn't fired yet (see revealBadgeToast/dismissBadgeToast below) — kept
  // separate from the bulk `timers` array so it can be specifically
  // cancelled (not just left to fire later) when the mode that earned it
  // gets left before the reveal ever happens.
  const pendingRevealTimerRef = useRef(null);
  // Mirrors showBadges for use inside the reveal timeout's callback, which
  // otherwise closes over whatever showBadges was at the moment the timer
  // was scheduled (seconds earlier) rather than its live value.
  const showBadgesRef = useRef(false);
  useEffect(() => {
    showBadgesRef.current = showBadges;
  }, [showBadges]);
  const statsInitialized = useRef(false);
  const streakPanelRef = useRef(null);
  // Drives the shop panel's height (see the money-shop-wrap render below) —
  // measured off shopContentRef's actual rendered content instead of a
  // fixed guess, so switching tabs (each a different height) animates
  // smoothly between the two real sizes instead of snapping, and the panel
  // can never clip its own bottom border again (see global.css's old
  // max-height comment history — that approach required re-measuring a
  // "worst case" by hand and clipped for real on more than one occasion
  // when it drifted out of date). shopContentRef's own element needs
  // overflow:hidden (see its render below) so it forms its own block
  // formatting context — otherwise MoneyShop's marginTop collapses straight
  // through this plain div and out of it, so scrollHeight silently excludes
  // that margin and the measured height comes up short by exactly that much,
  // clipping the panel's own bottom edge the same way the old fixed-guess
  // approach used to.
  const shopContentRef = useRef(null);
  const [shopContentHeight, setShopContentHeight] = useState(0);
  const { collapsed: chromeCollapsed, setCollapsed } = useChrome();
  const {
    user,
    isAdmin,
    stats: authStats,
    setStats: setAuthStats,
    refreshMoneyStats,
    moneyUnlockSeen,
    markMoneyUnlockSeen,
    onboardingSeen,
    pityIntroSeen,
    markPityIntroSeen,
    moneyWeeklyResultsSeen,
    markMoneyWeeklyResultsSeen,
    modifierUpdateSeen,
    markModifierUpdateSeen,
  } = useAuth();

  // Money mode's progression gate, computed once here rather than
  // inline at each of its three call sites (startModeSwitch, the
  // unlock-modal trigger effect, and the mode-switch button's own
  // render logic below) — those all used to repeat this exact
  // ternary by hand, which is exactly the kind of thing that quietly
  // drifts out of sync if the threshold ever changes in only one of
  // the copies. Deliberately reads authStats (not this component's own
  // `stats`) for a logged-in user — see the removed inline copies'
  // original comment, preserved here: `stats` is a ONE-TIME snapshot of
  // authStats taken the instant it first turns non-null, and authStats
  // can legitimately go non-null from the money-stats fetch (no
  // totalPushes field at all) before the separate sync-stats login-merge
  // — which is what actually carries totalPushes in — has resolved.
  // Reading `stats` here could freeze this gate on a false "0 pushes"
  // for a returning user with real history, for the rest of the
  // session. authStats itself stays live and re-renders once sync-stats
  // lands, so this can't get stuck. Safe to reference from code defined
  // textually ABOVE this line too (startModeSwitch, the trigger effect)
  // — a function declaration's body, and a useEffect callback that
  // hasn't fired yet, both only actually read this at CALL time, by
  // which point this render's already run top-to-bottom past this line.
  const hasPlayedClassic = user ? (authStats?.totalPushes ?? 0) > 0 : (stats?.totalPushes ?? 0) > 0;

  // Logged-in users' today's run lives server-side (daily_runs), and so do
  // their lifetime stats now (profiles.best_streak/total_pushes/day_streak/
  // busted_at_zero/busted_at_one) — AuthContext merges any pre-existing
  // local progress into the server row on login and holds the
  // authoritative copy as `authStats`. Guests have no server row, so they
  // keep using storage.js exactly as before.
  async function loadRunState() {
    const today = pacificDateString();
    let s;
    if (user) {
      let { data } = await supabase
        .from('daily_runs')
        .select('streak, status, boosted')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle();

      // No server row yet — if this device has a GUEST run for today,
      // carry it over instead of just resetting to 0: still 'playing'
      // (the old behavior lost a run you were mid-way through), or already
      // 'dead' (a guest who busts and THEN signs up otherwise vanishes off
      // today's leaderboard for that run — their lifetime stats are
      // already preserved separately either way). Uses the same
      // sync-stats path AuthContext.jsx's own login-time merge already
      // calls — safe to call again here even though that call is already
      // in flight in a separate, unrelated effect with no guaranteed
      // ordering against this one (merge_local_stats is idempotent: the
      // lifetime-stats portion no-ops once already migrated, and the
      // today-run seed only ever takes effect via daily_runs' own
      // unique(user_id,date) constraint, i.e. only if this exact race —
      // no row yet — is genuinely what's happening). Re-queries afterward
      // rather than trusting sync-stats' own response, since that only
      // returns the lifetime fields, not today's row.
      if (!data) {
        const todayState = await storage.getTodayState();
        if ((todayState.status === 'playing' || todayState.status === 'dead') && todayState.streak > 0) {
          const [localBest, localStats] = await Promise.all([storage.getBestStreak(), storage.getStats()]);
          await supabase.functions
            .invoke('sync-stats', {
              body: {
                bestStreak: localBest,
                ...localStats,
                todayDate: todayState.date,
                todayStreak: todayState.streak,
                todayStatus: todayState.status,
              },
            })
            .catch(() => {}); // best-effort — falls through to a fresh run below either way
          ({ data } = await supabase
            .from('daily_runs')
            .select('streak, status, boosted')
            .eq('user_id', user.id)
            .eq('date', today)
            .maybeSingle());
        }
      }

      s = data
        ? { date: today, streak: data.streak, status: data.status, newBestToday: false, boosted: data.boosted }
        : { date: today, streak: 0, status: 'playing', newBestToday: false, boosted: false };
    } else {
      s = await storage.getTodayState();
    }
    setState(s);
    // The bust reveal (Busted!/TOP X%/badge toast) otherwise only ever
    // plays once, driven by ephemeral component state set from
    // runBustSequence's timers — if the player navigates away and back
    // (remounting Home) after an earlier bust today, restore the settled
    // end-state directly instead of it just staying blank forever.
    if (s.status === 'dead') {
      setInstant(true);
      setShowBusted(true);
      setBustedSettled(true);
      setBustQuote(getBustQuoteForStreak(s.streak));
      if (s.streak > 0) {
        setBustedSlid(true);
        setShowRarity(true);
      }
      const ids = await storage.getTodayNewBadges();
      if (ids.length > 0) {
        setNewBadges(BADGES.filter((b) => ids.includes(b.id)));
        setShowBadges(true);
      }
    }
  }

  // Only loadRunState on an actual login/logout, not on every authStats
  // update — applySuccess/recordBustAndCheckBadges call setAuthStats after
  // every push, and re-running loadRunState() on each of those would
  // re-fetch daily_runs and stomp state.newBestToday back to false (it's
  // hardcoded false in loadRunState's constructed object, since that value
  // has no daily_runs column) — and worse, mid-bust, would force the
  // "restore an already-resolved bust" instant-settle path over the top of
  // runBustSequence's still-running choreography, which is what was
  // breaking the reveal timing and the badge toast.
  useEffect(() => {
    if (user === undefined) return; // auth still resolving
    loadRunState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Separately: load bestStreak/stats/earnedAtRunStart exactly once per
  // login (or per guest session) — guarded by statsInitialized so the
  // async wait for AuthContext's login-time merge (authStats starts null)
  // doesn't turn into a resync on every later authStats change from this
  // same run's own pushes. Those already keep `stats`/`bestStreak` in sync
  // directly (see applySuccess/recordBustAndCheckBadges) — this effect's
  // only job is the one-time initial load.
  useEffect(() => {
    statsInitialized.current = false;
  }, [user]);

  // Same reset reasoning as statsInitialized above, for
  // moneyUnlockShownRef (declared further down, next to the effect that
  // actually reads it) — without this, a logout followed by a DIFFERENT
  // account logging in in the same tab would stay wrongly suppressed by
  // the first account's already-fired flag.
  useEffect(() => {
    moneyUnlockShownRef.current = false;
  }, [user]);

  // Same reset reasoning as moneyUnlockShownRef above, for
  // pityIntroShownRef (declared next to schedulePityFillReveal, the effect
  // that actually reads it).
  useEffect(() => {
    pityIntroShownRef.current = false;
  }, [user]);

  useEffect(() => {
    if (user === undefined) return;
    if (statsInitialized.current) return;

    async function loadStats() {
      if (user) {
        // authStats gets built up from TWO independent, unordered async
        // calls in AuthContext.jsx — refreshMoneyStats' money-only update
        // and sync-stats' classic-stats response (bestStreak/pityCount/
        // etc.) — with no fixed resolution order. Checking just "is
        // authStats truthy yet" locks in whichever one happens to land
        // first: if refreshMoneyStats wins the race, authStats becomes
        // non-null with bestStreak/pityCount still undefined, and since
        // this effect only ever runs its initialization ONCE
        // (statsInitialized), that stuck-undefined pityCount silently
        // never gets corrected even once sync-stats' real response lands a
        // moment later — confirmed live: the pity meter stayed hidden
        // after a real login despite pity_count being nonzero server-side.
        // moneyLifetimeCents is never present on sync-stats' own response,
        // so checking for BOTH markers is what actually guarantees every
        // field either call could contribute (money AND classic/pity
        // alike) has landed before this snapshot gets taken.
        if (authStats?.bestStreak === undefined || authStats?.moneyLifetimeCents === undefined) return null;
        return { best: authStats.bestStreak, s: authStats };
      }
      const [best, s] = await Promise.all([storage.getBestStreak(), storage.getStats()]);
      return { best, s };
    }

    loadStats().then((result) => {
      if (!result) return;
      statsInitialized.current = true;
      const { best, s } = result;
      setBestStreakState(best);
      setStats(s);
      setDisplayedPityCount(s.pityCount ?? 0);
      // Snapshot of what's already earned before this run's pushes count,
      // so a bust/cash-out can later diff against it to find what's newly
      // earned. Explicit field picks, not a wholesale ...s spread — s is
      // authStats for logged-in players, which also carries fields no
      // badge reads (moneyWalletCents, etc. — see AuthContext.jsx). Must
      // include every field ANY badge reads, classic AND money alike (see
      // BADGES in game.js) — omitting the money-* fields here used to make
      // every already-earned money badge look "not yet earned" in this
      // baseline, so checkMoneyBadges' diff against it treated ALL of them
      // as newly earned on every single money-mode bust/cash-out, not just
      // genuinely new ones.
      setEarnedAtRunStart(
        new Set(
          earnedBadges({
            bestStreak: best,
            totalPushes: s.totalPushes,
            dayStreak: s.dayStreak,
            bustedAtZero: s.bustedAtZero,
            bustedAtOne: s.bustedAtOne,
            moneyBestBankStreak: s.moneyBestBankStreak,
            moneyLifetimeCents: s.moneyLifetimeCents,
            moneyBestRunCents: s.moneyBestRunCents,
            moneyBankedAfterOnePush: s.moneyBankedAfterOnePush,
            moneyReachedTop3Weekly: s.moneyReachedTop3Weekly,
            moneyBustedOver100: s.moneyBustedOver100,
          }).map((b) => b.id)
        )
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authStats]);

  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
      clearTimeout(pokeQuipTimerRef.current);
    };
  }, []);

  // Header + nav bar collapse (see ChromeContext) whenever there's an
  // active streak in progress, or while the bust reveal is still
  // choreographing itself — both cases want the board to feel focused,
  // uninterrupted by chrome. Falls back to collapsed=false on unmount so
  // navigating away never leaves the nav bar stuck hidden.
  //
  // Only pushes into the SHARED ChromeContext value while classic mode is
  // actually the active one — MoneyMode.jsx drives the exact same shared
  // value with its own equivalent rule while IT'S active, so whichever
  // mode is currently mounted is the one steering this. The header below
  // reads the shared value (chromeCollapsed), not this local one, which is
  // what makes it react correctly to either mode instead of only ever
  // reflecting classic's own state.status/streak.
  const midRun = state.status === 'playing' && state.streak > 0;
  const classicCollapsed = midRun || bustRevealing;
  useEffect(() => {
    if (uiMode === 'classic') setCollapsed(classicCollapsed);
  }, [uiMode, classicCollapsed, setCollapsed]);
  useEffect(() => {
    return () => setCollapsed(false);
  }, [setCollapsed]);

  // "Intensity" system — a couple of otherwise-independent visual effects
  // ramp off the current streak instead of each having its own separate
  // curve (see spawnEffect below for the particle-burst piece). Written
  // onto :root (not just kept in JS state) because the background glow
  // lives on <body>, outside this component's own subtree — see the
  // --pulse-duration/--bg-glow-* comment in global.css.
  //
  // The button itself only gets faster, not recolored — recoloring it too
  // (an earlier version of this shifted its glow toward red/amber the same
  // way the background does) read as the button "going crazy" at a high
  // streak rather than just your heart racing, so --pulse-color-* are left
  // alone at their static :root defaults now, only --pulse-duration is
  // still driven from here.
  //
  // The background gets its own more pronounced ramp (a wider alpha range
  // than the button) that keeps climbing over a long window — 45 pushes
  // past the streak-15 start, so it's still visibly deepening all the way
  // out to streak 60 instead of maxing out early and then just sitting
  // there for the rest of a long run.
  //
  // Nothing ramps at all before streak 15 — early pushes stay at the calm
  // resting baseline, and the whole cycle (both the button's heartbeat and
  // the background) only starts counting once you're past that point.
  //
  // Busting drops the effective streak straight to 0 (not just left at
  // whatever it was when you died) — otherwise the background stayed hot
  // and the button (if it were still mid-run) would keep racing even
  // though the run itself is over. .app-shell's own transitions (0.5s,
  // see global.css) ease it back to resting rather than snapping.
  useEffect(() => {
    const lerp = (a, b, t) => a + (b - a) * t;
    const lerpRgb = (c1, c2, t) => c1.map((v, i) => Math.round(lerp(v, c2[i], t)));

    const effectiveStreak = state.status === 'dead' ? 0 : state.streak;
    const rampStreak = Math.max(0, effectiveStreak - INTENSITY_START_STREAK);
    const pulseIntensity = Math.min(1, rampStreak / 30);
    const bgIntensity = Math.min(1, rampStreak / 45);
    const bgPrimary = lerpRgb([139, 92, 246], [255, 45, 109], bgIntensity); // violet -> red
    const bgAccent = lerpRgb([34, 229, 255], [255, 170, 40], bgIntensity); // cyan -> amber

    const root = document.documentElement.style;
    root.setProperty('--pulse-duration', `${lerp(1.7, 0.7, pulseIntensity)}s`);
    root.setProperty('--bg-glow-1', `rgba(${bgPrimary.join(',')},${lerp(0.16, 0.6, bgIntensity)})`);
    root.setProperty('--bg-glow-2', `rgba(${bgAccent.join(',')},${lerp(0.08, 0.5, bgIntensity)})`);

    // These live on :root, outside this component's own subtree (see the
    // comment above) — nothing else ever resets them, so without this,
    // navigating away mid-high-streak (Profile/Leaderboard/etc, no bust in
    // between) left the whole site's background stuck at whatever
    // intensity the streak was at, forever, since Home never got another
    // chance to run this effect again and bring it back down. removeProperty
    // (not re-setting to the resting values by hand) falls back to the
    // exact same numbers via :root's own defaults in global.css — those
    // were deliberately kept in sync with this effect's own bgIntensity=0/
    // pulseIntensity=0 output, so there's only one place either is defined.
    return () => {
      root.removeProperty('--pulse-duration');
      root.removeProperty('--bg-glow-1');
      root.removeProperty('--bg-glow-2');
    };
  }, [state.streak, state.status]);

  // Swaps in a new quip every 3 pushes once the streak hits 3 (see
  // quoteBucketRef — only re-rolls when Math.floor(streak/3) actually
  // changes, not on every render/push, so each quote sticks around for
  // its full 3-push window instead of re-randomizing constantly). Resets
  // to the default text (quote: null) below streak 3 and on bust, same
  // "snap back to resting" idea as the intensity effect above.
  useEffect(() => {
    if (state.status !== 'playing' || state.streak < 3) {
      setQuote(null);
      quoteBucketRef.current = -1;
      return;
    }
    const bucket = Math.floor(state.streak / 3);
    if (bucket !== quoteBucketRef.current) {
      quoteBucketRef.current = bucket;
      setQuote(getQuoteForStreak(state.streak));
    }
  }, [state.streak, state.status]);

  // Shared by the passive ResizeObserver below AND the badge-reveal timeout
  // (see recordBustAndCheckBadges) — the observer keeps --streak-panel-top
  // roughly up to date as chrome collapses/uncollapses, but on some
  // browser/viewport combinations it doesn't fire reliably enough times
  // during that 800ms transition to have caught up to the FINAL settled
  // position by the time the badge toast is about to appear. Calling this
  // again right at that moment (a guaranteed fresh read, not whatever the
  // observer last happened to catch) closes that gap regardless of how the
  // transition actually played out.
  function measureStreakPanelTop() {
    const el = streakPanelRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    document.documentElement.style.setProperty('--streak-panel-top', `${Math.round(top)}px`);
  }

  // Badge toasts line up with the streak panel's own top (see the
  // badge-toast-stack style below) rather than the Admin corner — most of
  // what shifts that top (nav bar wrapping to 2 lines, the header's own
  // height, chrome collapsing mid-run) doesn't resize this wrapper itself,
  // so a plain ResizeObserver on it wouldn't catch those. Observing
  // document.body instead does: its height changes whenever anything above
  // the panel reflows, in this single-column layout.
  useLayoutEffect(() => {
    if (!streakPanelRef.current) return;
    measureStreakPanelTop();
    const ro = new ResizeObserver(measureStreakPanelTop);
    ro.observe(document.body);
    window.addEventListener('resize', measureStreakPanelTop);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measureStreakPanelTop);
    };
  }, [classicCollapsed, state.status, state.streak, state.newBestToday, bestStreak, user]);

  // Tracks the shop panel's true rendered content height (see
  // shopContentRef's declaration above) so the wrapper can animate to it
  // with a real height transition — fires on mount AND on every tab switch
  // inside MoneyShop, since a ResizeObserver reacts to any size change of
  // the observed element, not just window resizes. shopContentRef's own
  // element is never itself height-clamped (only its ancestor
  // .money-shop-wrap is), so its scrollHeight is always the shop's true,
  // unclipped natural size regardless of the wrapper's current collapsed/
  // open state.
  useLayoutEffect(() => {
    if (uiMode !== 'money' || !shopContentRef.current) return;
    const el = shopContentRef.current;
    const measure = () => setShopContentHeight(el.scrollHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [uiMode]);

  // Single trigger for MoneyModeUnlockModal.jsx, covering THREE different
  // players with one mechanism: a brand-new logged-in player crosses
  // authStats.totalPushes 0 -> 1 right after their first-ever push (see
  // applySuccess/bust, both called from pushServer, which fold
  // serverStats into authStats synchronously) — this effect fires
  // straight off that. An EXISTING logged-in player (total_pushes already
  // > 0 from before this modal existed) instead crosses moneyUnlockSeen
  // null -> false once AuthContext's login-time fetch resolves. A GUEST
  // crosses stats.totalPushes 0 -> 1 the same way the logged-in
  // brand-new case does, just off the local `stats` copy instead of
  // authStats, and tracked via lib/moneyUnlock.js's localStorage flag
  // instead of profiles.money_unlock_seen (no row to hold it in — see
  // that file's own comment on why, and AuthContext.jsx's carry-over on
  // signup so a guest who already saw this doesn't see it again).
  // Guests DO get the modal (and can tap "Try Money Mode" from it) even
  // though they can't actually play yet — MoneyMode.jsx shows its own
  // "make an account" prompt in place of the game once they get there,
  // same as clicking the header button directly would.
  //
  // Every path is gated to fire at most once per session by
  // moneyUnlockShownRef, and marks itself seen (via the modal's own
  // onDismiss/onTryMoney handlers below) so it can never fire again for
  // this account/device after that.
  //
  // Flat 1400ms delay (roughly matching OnboardingModal's own 1150ms
  // "let the page settle first" convention) rather than popping the
  // instant the condition's met — covers both "push's own success tick
  // finishing" and "page finished loading in" per the different
  // triggering scenarios. Not specially delayed for the rare case of a
  // brand-new account's literal first push busting (0.1% chance, given
  // the first-push odds) — accepted rather than adding a data.success
  // branch here, since that reveal sequence running a little past this
  // modal's appearance in that edge case isn't worth the extra coupling.
  const moneyUnlockShownRef = useRef(false);
  useEffect(() => {
    // Not strictly needed for a genuine existing player (real gameplay
    // can't produce total_pushes > 0 with onboarding still undismissed —
    // dismissing it is what unlocks the push button in the first place),
    // but a cheap, real guard against ever stacking this on top of
    // OnboardingModal in some inconsistent-data edge case is worth the
    // one extra check. hasSeenOnboardingLocally() covers the guest half —
    // onboardingSeen itself is always null while logged out (see
    // AuthContext.jsx), so it can't be read directly here for a guest.
    const onboardingDone = user ? onboardingSeen === true : hasSeenOnboardingLocally();
    if (!onboardingDone) return;
    const alreadySeenUnlock = user ? moneyUnlockSeen : hasSeenMoneyUnlockLocally();
    if (alreadySeenUnlock !== false) return; // null (still loading) or already true
    if (!hasPlayedClassic) return;
    if (moneyUnlockShownRef.current) return;
    moneyUnlockShownRef.current = true;
    const timer = setTimeout(() => setShowMoneyUnlockModal(true), 1400);
    timers.current.push(timer);
    return () => clearTimeout(timer);
  }, [user, onboardingSeen, moneyUnlockSeen, hasPlayedClassic]);

  // Announces last week's money-mode weekly-leaderboard results (see
  // MoneyWeeklyResultsModal.jsx) the first time a ranked account logs in
  // after the Monday reset. Gated on profiles.money_weekly_results_seen
  // (flipped to false by finalize_money_week ONLY for accounts it
  // actually ranked that week — see that function's own comment in
  // schema.sql) AND authStats.moneyLastWeekRank actually being set (still
  // null means either the login-time fetch hasn't landed yet, or this
  // account has never once ranked — either way, nothing to show). No
  // guest path at all, unlike the money-unlock trigger above — a rank is
  // inherently a registered-account concept.
  const moneyWeeklyResultsShownRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (moneyWeeklyResultsSeen !== false) return; // null (still loading) or already true
    if (authStats?.moneyLastWeekRank == null) return; // not loaded yet, or never ranked
    if (moneyWeeklyResultsShownRef.current) return;
    moneyWeeklyResultsShownRef.current = true;
    const timer = setTimeout(async () => {
      // Same "last completed week" query Leaderboard.jsx's own podium
      // uses, minus its WEEKLY_LEADERBOARD_START_DATE display gate — that
      // gate exists to hide pre-launch bot data from a casual visitor
      // browsing the leaderboard; this modal only ever fires for an
      // account finalize_money_week just genuinely ranked, so there's
      // nothing pre-launch left to hide from it by the time it can fire.
      const { data } = await supabase
        .from('money_weekly_resets')
        .select('top3')
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle();
      setMoneyWeeklyResultsData({
        rank: authStats.moneyLastWeekRank,
        scoreCents: authStats.moneyLastWeekScoreCents ?? 0,
        diamondsAwarded: authStats.moneyLastWeekDiamondsAwarded ?? 0,
        top3: data?.top3 ?? [],
      });
      setShowMoneyWeeklyResultsModal(true);
    }, 1400);
    timers.current.push(timer);
    return () => clearTimeout(timer);
  }, [user, moneyWeeklyResultsSeen, authStats?.moneyLastWeekRank]);

  // Prompts this week's upgrade choice (see MoneyUpgradeChoiceModal.jsx) —
  // gated on actually being in Money Mode (uiMode, not just logged in;
  // unlike the results modal above, which fires regardless of mode), the
  // last-week results modal not currently pending/showing (that one goes
  // first if there's anything to show), authStats.moneyUpgradeChoiceSeen
  // being exactly false (null means still loading; true means already
  // chosen this week or nothing to choose from ever), and owning at least
  // one upgrade — nothing to choose from otherwise, so there's no reason to
  // interrupt a player who's never bought one. moneyUpgradeChoiceShownRef
  // guards it to once per mount, same reasoning moneyWeeklyResultsShownRef
  // uses above (this effect re-runs on every stats refresh mid-session,
  // e.g. after a push — without the ref it would try to reopen the modal
  // the instant it's dismissed, since dismissal itself is what flips
  // moneyUpgradeChoiceSeen true, which is also a dependency here).
  const moneyUpgradeChoiceShownRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (uiMode !== 'money') return;
    if (showMoneyWeeklyResultsModal) return;
    if (authStats?.moneyUpgradeChoiceSeen !== false) return;
    if (!(authStats?.ownsInsurance || authStats?.ownsStreakBonus || authStats?.ownsDaredevil)) return;
    if (moneyUpgradeChoiceShownRef.current) return;
    moneyUpgradeChoiceShownRef.current = true;
    setShowMoneyUpgradeChoiceModal(true);
  }, [user, uiMode, showMoneyWeeklyResultsModal, authStats?.moneyUpgradeChoiceSeen, authStats?.ownsInsurance, authStats?.ownsStreakBonus, authStats?.ownsDaredevil]);

  // One-time "what's new" recap (see ModifierUpdateModal.jsx) — shown to
  // any logged-in account, regardless of mode (like the results modal
  // above, unlike the upgrade-choice one). Defers to every other login/
  // gameplay modal so this never stacks with something more specific —
  // same "check every other show* state" reasoning MoneyUpgradeChoiceModal's
  // own trigger uses just above. The 2s delay (longer than the results
  // modal's own 1400ms) is what makes the showMoneyWeeklyResultsModal check
  // actually meaningful: without it, this could fire before that modal's
  // own delayed trigger has had a chance to decide whether IT's showing at
  // all. If any guard flips true during the wait, React's own effect
  // cleanup cancels this timer before it can fire (see the dependency
  // array) — modifierUpdateShownRef then keeps it from ever rescheduling.
  const modifierUpdateShownRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (modifierUpdateSeen !== false) return;
    if (showMoneyUnlockModal || showPityIntroModal || showMoneyWeeklyResultsModal || showMoneyUpgradeChoiceModal) return;
    if (modifierUpdateShownRef.current) return;
    modifierUpdateShownRef.current = true;
    const timer = setTimeout(() => {
      setShowModifierUpdateModal(true);
    }, 2000);
    timers.current.push(timer);
    return () => clearTimeout(timer);
  }, [user, modifierUpdateSeen, showMoneyUnlockModal, showPityIntroModal, showMoneyWeeklyResultsModal, showMoneyUpgradeChoiceModal]);

  // Once busted, tick every second so the "next run" countdown is live,
  // and re-check the date so the run auto-resets the moment it rolls over.
  useEffect(() => {
    if (state.status !== 'dead') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    const today = pacificDateString();
    if (state.date && state.date !== today) {
      loadRunState();
      resetBustVisuals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, state.date]);

  function persist(next) {
    setState(next);
    // Logged-in users' run is already persisted server-side by the Edge
    // Function response that produced `next` — writing it locally too would
    // leave a stale local run behind for guest mode to pick up after logout.
    if (!user) storage.saveTodayState(next);
  }

  function clearTimers() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  }

  // Dismisses whatever badge toast is currently on screen (from EITHER
  // mode — see the shared state at the top of this component) by playing
  // its exit animation first (badgeSlideOut, see global.css), then
  // actually clearing showBadges/newBadges once that finishes — instead of
  // just wiping the state and having it disappear instantly. Safe to call
  // when nothing's showing (no-op).
  //
  // Also cancels a reveal that's been SCHEDULED but hasn't fired yet (e.g.
  // classic's 8000ms post-bust delay) — without this, switching modes (or
  // starting a new run) during that delay window wouldn't stop it: the
  // pending toast would still pop up later, now in whatever mode you've
  // since moved to, and then just sit there since nothing else would ever
  // dismiss it. The cancelled badges are deliberately NOT folded into
  // earnedAtRunStart here — they'll naturally show up again as "newly
  // earned" next time their own mode actually resolves a run, rather than
  // being lost or force-shown somewhere unrelated.
  function dismissBadgeToast() {
    if (pendingRevealTimerRef.current) {
      clearTimeout(pendingRevealTimerRef.current);
      pendingRevealTimerRef.current = null;
    }
    // showBadgesRef (live value), not showBadges — this can be called from
    // a closure captured well before the toast it's dismissing ever
    // appeared (e.g. the 5s auto-dismiss timer scheduled inside
    // revealBadgeToast's own showNow, itself scheduled from a render where
    // showBadges was still false) — reading the plain state var there would
    // silently no-op on a real, currently-visible toast.
    if (!showBadgesRef.current) return;
    setBadgesLeaving(true);
    timers.current.push(
      setTimeout(() => {
        setShowBadges(false);
        setNewBadges([]);
        setBadgesLeaving(false);
      }, 400)
    );
  }

  function resetBustVisuals() {
    setShowBusted(false);
    setBustedSettled(false);
    setBustedSlid(false);
    setShowRarity(false);
    setBustRevealing(false);
    dismissBadgeToast();
    setInstant(false);
    setShareStatus('');
    setBustQuote(null);
    setShaking(false);
    setShakeAmount(6);
    setPoking(false);
    setPokeQuip(null);
    pokeCountRef.current = 0;
    lastPokeAtRef.current = 0;
    clearTimeout(pokeQuipTimerRef.current);
    // If a pity fill-reveal's own inner unblock timer was cancelled by the
    // clearTimers() call that always precedes this (see runBustSequence/
    // adminResetDay*), nothing else would ever flip this back — the Push
    // button (and the money-mode switch button) would otherwise stay
    // disabled for the rest of this Home mount.
    setPityFillBlocking(false);
  }

  async function handleShare() {
    const text = buildShareText({ streak: state.streak, url: window.location.origin });
    // Native share sheet on mobile when available; clipboard everywhere
    // else. navigator.share can throw/reject on user-cancel — that's not a
    // failure worth surfacing, so it's swallowed rather than falling
    // through to the clipboard path (which would show a misleading "cancel
    // = copied" success).
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        // cancelled — do nothing
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareStatus('Copied to clipboard!');
    } catch {
      setShareStatus('Could not copy — try again.');
    }
    timers.current.push(setTimeout(() => setShareStatus(''), 2500));
  }

  // Always copies, regardless of navigator.share support — sits next to
  // "Share" for people who specifically want the clipboard path (e.g. to
  // paste into a chat) rather than whatever the OS share sheet offers.
  async function handleCopy() {
    const text = buildShareText({ streak: state.streak, url: window.location.origin });
    try {
      await navigator.clipboard.writeText(text);
      setShareStatus('Copied to clipboard!');
    } catch {
      setShareStatus('Could not copy — try again.');
    }
    timers.current.push(setTimeout(() => setShareStatus(''), 2500));
  }

  // The busted button used to just be disabled — clicking it did nothing
  // at all, which read as unresponsive rather than "the run is over."
  // Every click now gets a small physical flinch + spark (so it never
  // feels dead), and every third counted click also swaps in a dry
  // one-liner in place of the bust quote for a couple seconds — not every
  // click, so button-mashing doesn't turn into a wall of repeated text,
  // but often enough it doesn't feel like a rare easter egg either.
  function pokeBustedButton() {
    // A double-click (or just fast mashing) fires two real click events
    // for what reads as one action to the person doing it — without this
    // guard, that silently burns an extra step of the %3 counter, making
    // "every third click" look inconsistent from the user's own
    // perspective even though the math underneath is exact.
    const now = Date.now();
    if (now - lastPokeAtRef.current < 260) return;
    lastPokeAtRef.current = now;

    setPoking(true);
    timers.current.push(setTimeout(() => setPoking(false), 220));
    spawnSpark();
    playPoke();

    pokeCountRef.current += 1;
    if (pokeCountRef.current % 3 === 0) {
      setPokeQuip(getPokeQuip());
      // Replaces any still-pending clear from an earlier quip rather than
      // stacking another one — two pending timeouts would race, and
      // whichever fired first would cut this fresh quip's display short.
      clearTimeout(pokeQuipTimerRef.current);
      pokeQuipTimerRef.current = setTimeout(() => setPokeQuip(null), 2200);
    }
  }

  function push() {
    if (rolling) return;
    // Comeback Boost's fill-reveal (see schedulePityFillReveal) is a
    // deliberately watch-only moment — blocks both a real push and poking
    // the busted button until the meter's done animating.
    if (pityFillBlocking) return;
    if (state.status === 'dead') {
      pokeBustedButton();
      return;
    }
    if (state.status !== 'playing') return;
    setRolling(true);
    // Immediate, before the 450ms suspense delay even resolves — the
    // button should feel like it physically responded to the tap itself,
    // not wait on the outcome to react at all.
    playPush();
    // Streak 0 uniquely identifies "the day's first press" under
    // one-run-per-day, so this fires exactly once per day. Logged-in day
    // streak tracking now happens server-side, inside resolve_push (see
    // pushServer) — this local path is guests only.
    if (state.streak === 0 && !user) {
      storage.recordDailyPlay().then(setStats);
    }
    if (user) pushServer();
    else pushLocal();
  }

  function pushLocal() {
    setTimeout(async () => {
      // A guest's very first-ever run (no prior push, ever) gets every press
      // forced to succeed while streak is still below the guarantee — see
      // FIRST_RUN_GUARANTEE_STREAK's own comment in game.js. Re-derived
      // fresh on every press rather than a persisted flag: on an
      // uninterrupted first-ever run, lifetime totalPushes and this run's
      // streak are always exactly equal (every push so far is a success,
      // both start at 0 and climb together) — the moment that stops being
      // true, either this isn't the first run, or the guarantee window's
      // already closed for this one, both correctly falling back to normal
      // odds with no separate state to keep in sync.
      const firstRunGuaranteed = stats.totalPushes === state.streak && state.streak < FIRST_RUN_GUARANTEE_STREAK;
      const success = firstRunGuaranteed || rollPush(state.streak);
      setRolling(false);
      const updatedStats = await storage.incrementTotalPushes();
      setStats(updatedStats);

      if (success) {
        applySuccess(state.streak + 1);
      } else {
        bust(state.streak);
      }
    }, 450);
  }

  function pushServer() {
    // Kick off the network call immediately so its latency overlaps with
    // the 450ms suspense delay instead of adding to it; only wait on it
    // once that delay is up.
    const invokePromise = supabase.functions.invoke('push');
    setTimeout(async () => {
      const { data, error } = await invokePromise;
      setRolling(false);

      if (error || !data) {
        // Network hiccup or an unexpected server error — bail without
        // corrupting local state; the button just re-enables for a retry.
        console.error('push failed:', error);
        return;
      }

      // resolve_push already updated total_pushes/best_streak/day_streak/
      // bust flags server-side as part of the same atomic call that
      // rolled the push — this response IS the new authoritative stats,
      // no separate storage.js round-trip needed the way guests need.
      const serverStats = {
        bestStreak: data.bestStreak,
        totalPushes: data.totalPushes,
        dayStreak: data.dayStreak,
        bustedAtZero: data.bustedAtZero,
        bustedAtOne: data.bustedAtOne,
        pityCount: data.pityCount,
        boosted: data.boosted,
      };

      if (data.success) {
        applySuccess(data.streak, serverStats);
      } else {
        bust(data.streak, serverStats);
      }
      // Money-mode-unlock modal trigger lives in its own effect below
      // (watching authStats.totalPushes/moneyUnlockSeen), not here — see
      // that effect's comment for why. applySuccess/bust above already
      // fold serverStats.totalPushes into authStats synchronously, so that
      // effect fires right off the back of this same push.
    }, 450);
  }

  function applySuccess(newStreak, serverStats) {
    // Same 0-1 curve as the button heartbeat/background glow (see the
    // intensity effect above) — bigger, faster particle bursts as the
    // streak climbs instead of every push looking identical regardless of
    // how far into the run it is.
    const burstIntensity = Math.min(1, newStreak / 30);
    spawnEffect('var(--neon-green)', Math.round(16 + burstIntensity * 14), 1 + burstIntensity * 0.6);
    playSuccess(newStreak);
    let newBestToday = state.newBestToday;
    if (serverStats) {
      if (serverStats.bestStreak > bestStreak) newBestToday = true;
      setBestStreakState(serverStats.bestStreak);
      setStats((s) => ({ ...s, ...serverStats }));
      setAuthStats((s) => ({ ...s, ...serverStats }));
      // A success can only ever clear the pity meter early (streak >= 7 on
      // a non-armed run — see resolve_push), never add to it — no reveal
      // moment to stage for a clear, the meter just isn't visible mid-run
      // anyway, so this can sync immediately.
      if (typeof serverStats.pityCount === 'number') setDisplayedPityCount(serverStats.pityCount);
    } else if (newStreak > bestStreak) {
      newBestToday = true;
      setBestStreakState(newStreak);
      storage.setBestStreak(newStreak);
    }
    persist({ ...state, streak: newStreak, status: 'playing', newBestToday, boosted: serverStats ? serverStats.boosted : state.boosted });
  }

  // Shared by a real bust and the admin Force Bust dev tool — admin mode is
  // only ever used by the developer, so there's no one to cheese badges
  // against by letting it count toward real stats too.
  //
  // Order matters here: triggerBust (via runBustSequence) calls
  // clearTimers() before registering its own reveal-sequence timers.
  // recordBustAndCheckBadges also registers a timer (the badge toast). When
  // serverStats is provided (logged-in players), recordBustAndCheckBadges
  // has no `await` in its path anymore, so it runs fully synchronously —
  // if it ran first, its timer would get registered and then immediately
  // wiped out by triggerBust's clearTimers() a moment later, and the badge
  // toast would never fire. triggerBust has to go first.
  function bust(streak, serverStats) {
    triggerBust(streak, serverStats);
    recordBustAndCheckBadges(streak, serverStats);
    schedulePityFillReveal(streak, serverStats);
  }

  // Comeback Boost: only a genuine "add" (this bust was unlucky enough to
  // build the meter — see resolve_push's pity logic) gets the special
  // fill-up moment; a reset/consume/no-op just syncs displayedPityCount
  // immediately with nothing to watch (the meter isn't visible mid-run or
  // mid-reveal anyway). Deferred until the panels have fully reset —
  // PITY_FILL_REVEAL_DELAY_MS lines up with runBustSequence's own
  // setBustRevealing(false) mark — rather than updating the moment the
  // bust itself resolves, so the player actually SEES the meter climb
  // instead of just finding it already changed next time they look.
  // Gates PityIntroModal to fire at most once per session — mirrors
  // moneyUnlockShownRef exactly, including its [user] reset effect above.
  const pityIntroShownRef = useRef(false);

  function schedulePityFillReveal(streak, serverStats) {
    const newPity = serverStats?.pityCount;
    if (typeof newPity !== 'number') return;
    if (newPity <= displayedPityCount) {
      setDisplayedPityCount(newPity);
      return;
    }
    const fillFrom = displayedPityCount;
    const delay = streak > 0 ? PITY_FILL_REVEAL_DELAY_MS : PITY_FILL_REVEAL_DELAY_STREAK_0_MS;
    timers.current.push(
      setTimeout(() => {
        // Re-checked against the LIVE uiMode (same uiModeRef pattern
        // revealBadgeToast already uses), not just the mode this bust
        // happened in — the pity meter/spotlight JSX only exists in the
        // classic branch, so if the player switched to Money Mode during
        // this delay (streak-0 busts have a real, if short, window for
        // that — classic chrome never collapses on a streak-0 bust),
        // firing the full blocking ceremony here would disable "Back to
        // classic" for PITY_FILL_ANIM_MS with no visible cause. Apply the
        // real value directly instead, skip the show.
        if (uiModeRef.current !== 'classic') {
          setDisplayedPityCount(newPity);
          return;
        }
        setDisplayedPityCount(fillFrom); // ensure the bar starts from its real pre-bust value
        setPityFillBlocking(true);
        // Next frame, not this one — the width transition (see
        // .pity-meter-fill in global.css) only animates a change from an
        // already-painted starting value, not the same-frame initial one.
        requestAnimationFrame(() => setDisplayedPityCount(newPity));
        timers.current.push(
          setTimeout(() => {
            setPityFillBlocking(false);
            // First-ever activation — explain the mechanic right after the
            // player's actually SEEN it happen, not before (see
            // PityIntroModal.jsx). pityIntroSeen === false (strict, not
            // just falsy) so a still-loading null never triggers this on a
            // technicality — worst case it just doesn't show this one
            // time, same "harmless to occasionally skip, not to spam"
            // posture used elsewhere for these one-time modals.
            if (pityIntroSeen === false && !pityIntroShownRef.current) {
              pityIntroShownRef.current = true;
              setShowPityIntroModal(true);
            }
          }, PITY_FILL_ANIM_MS)
        );
      }, delay)
    );
  }

  // Shared by recordBustAndCheckBadges (classic) and checkMoneyBadges
  // (money) — schedules a badge-toast reveal `delayMs` out for whichever
  // mode ('classic'/'money') earned `newly`, first cancelling any earlier
  // scheduled-but-unfired reveal (pendingRevealTimerRef) so a mode switch
  // or new run that happens before THIS one even fires can't leave two
  // reveals racing.
  //
  // `forMode` is re-checked against the LIVE uiMode (uiModeRef) right when
  // the timer actually fires, not just at schedule time — a bust/cash-out
  // resolution can include a server round trip, so it's possible to
  // schedule this, switch modes while it's still in flight, and only then
  // have it fire — dismissBadgeToast's own pendingRevealTimerRef
  // cancellation only catches reveals that were ALREADY scheduled at the
  // moment of the switch, not ones scheduled after. If the mode's since
  // changed, this bails without showing (and without folding into
  // earnedAtRunStart) — same as a cancelled reveal, it'll naturally
  // resurface next time that mode actually resolves a run.
  //
  // If a toast is still actively showing once this one's turn comes up
  // (showBadgesRef — read live, not the value from whenever this was
  // scheduled), it's dismissed first (the same exit animation
  // dismissBadgeToast plays) and `newly` only shows once that finishes —
  // rather than the cards just being swapped out from under whatever's on
  // screen, which read as a glitchy shove.
  function revealBadgeToast(newly, delayMs, forMode) {
    if (pendingRevealTimerRef.current) clearTimeout(pendingRevealTimerRef.current);
    const showNow = () => {
      measureStreakPanelTop();
      setNewBadges(newly);
      setShowBadges(true);
      setBadgesLeaving(false);
      playBadge();
      // Folded into earnedAtRunStart right as the toast reveals, not just
      // left for the next login to pick up — earnedAtRunStart is otherwise
      // only ever set once per login/guest-session (see the effect that
      // seeds it), so without this, the SAME badge could re-trigger
      // "newly earned" on a later bust within one session (e.g. an admin
      // Force Bust, or now that switching modes makes multiple busts in
      // one sitting normal).
      setEarnedAtRunStart((prev) => new Set([...prev, ...newly.map((b) => b.id)]));
      // Classic mode persists its newly-earned badge IDs (see
      // recordBustAndCheckBadges' saveTodayNewBadges call) so loadRunState
      // can restore an interrupted reveal after a remount/reload — but
      // nothing else ever clears that persisted list once the toast has
      // actually been SHOWN, so without this, navigating away and back (or
      // reloading) any number of times for the rest of that Pacific day
      // replayed the exact same "new badge" toast for badges the player
      // already saw and dismissed. Clearing it right here, the moment it
      // actually reveals, is what stops that — scoped to 'classic' only
      // since money mode (checkMoneyBadges) never writes this list in the
      // first place; clearing it unconditionally here would risk wiping a
      // classic toast that was persisted but hasn't shown yet (e.g. one
      // still-pending when a money-mode toast happens to reveal first).
      if (forMode === 'classic') storage.saveTodayNewBadges([]);
      // Auto-dismiss 5s after the toast actually appears, on top of
      // whatever dismisses it early (mode switch, admin reset, a new run) —
      // dismissBadgeToast is a no-op once showBadges is already false, so
      // this firing after an earlier manual dismiss is harmless.
      timers.current.push(setTimeout(() => dismissBadgeToast(), 5000));
    };
    const id = setTimeout(() => {
      pendingRevealTimerRef.current = null;
      if (uiModeRef.current !== forMode) return;
      if (showBadgesRef.current) {
        setBadgesLeaving(true);
        timers.current.push(setTimeout(showNow, 400));
      } else {
        showNow();
      }
    }, delayMs);
    pendingRevealTimerRef.current = id;
    timers.current.push(id);
  }

  async function recordBustAndCheckBadges(streak, serverStats) {
    let s;
    if (serverStats) {
      s = serverStats;
      setStats((prev) => ({ ...prev, ...s }));
      setBestStreakState(s.bestStreak);
      setAuthStats((prev) => ({ ...prev, ...s }));
    } else {
      s = await storage.getStats();
      if (streak === 0 && !s.bustedAtZero) s = { ...s, bustedAtZero: true };
      if (streak === 1 && !s.bustedAtOne) s = { ...s, bustedAtOne: true };
      await storage.saveStats(s);
      setStats(s);
    }
    const finalBest = serverStats ? serverStats.bestStreak : Math.max(bestStreak, streak);
    const earnedNow = earnedBadges({ bestStreak: finalBest, ...s });
    const newly = earnedNow.filter((b) => !earnedAtRunStart.has(b.id));
    if (newly.length > 0) {
      storage.saveTodayNewBadges(newly.map((b) => b.id));
      // Timed to land after the home page's chrome has FINISHED resetting
      // (streak > 0 — see runBustSequence's setBustRevealing(false) at
      // 6850, which is what un-collapses the nav bar/header back to
      // normal) — or shortly after Busted! itself for a streak-0 bust,
      // which never collapses the chrome in the first place, so there's no
      // "reset" to wait on.
      //
      // The un-collapse itself is an 800ms CSS transition (.header-panel/
      // .nav-bar, see global.css) — this used to fire only 50ms after that
      // transition STARTED (6900), long before it's actually done. The
      // badge toast's own top position is read off the streak panel's live
      // on-screen position (--streak-panel-top), so measuring mid-collapse
      // pinned the toast near the still-collapsed (near the top of the
      // screen) position instead of its normal spot — most visible on
      // small phone screens, where that collapsed-vs-expanded difference
      // is largest. Waiting out the full 800ms (plus a buffer) covers most
      // of it, but the passive ResizeObserver driving --streak-panel-top
      // (see measureStreakPanelTop) still isn't guaranteed to have fired
      // again since the transition finished on every browser/viewport —
      // confirmed still landing wrong on some device-emulated viewports
      // even with the delay. Forcing one more explicit measurement right
      // here, immediately before revealing, closes that gap directly
      // instead of just hoping the passive observer already caught up.
      revealBadgeToast(newly, streak > 0 ? 8000 : 3000, 'classic');
    }
  }

  // Money-mode equivalent of recordBustAndCheckBadges above — passed down
  // as MoneyMode's onMoneyResolved prop, called right after it refreshes
  // its own money-badge-fields slice from the server (see
  // AuthContext.jsx's refreshMoneyStats — MoneyMode's own setStats calls
  // never touch those fields, only wallet/lifetime cents). Diffs against
  // the SAME shared earnedAtRunStart baseline classic mode uses — a badge
  // is a badge regardless of which mode earned it — then reveals on a
  // fixed delay matching MoneyMode's own reveal-sequence timing, rather
  // than classic's variable 8000/3000ms split (every money run, bust or
  // cash-out, runs the same ~7.9s sequence, so there's no streak-0-style
  // short-circuit to account for here).
  function checkMoneyBadges(freshMoneyStats) {
    const earnedNow = earnedBadges({ ...authStats, ...freshMoneyStats });
    const newly = earnedNow.filter((b) => !earnedAtRunStart.has(b.id));
    if (newly.length === 0) return;
    revealBadgeToast(newly, MONEY_BADGE_REVEAL_DELAY_MS, 'money');
  }

  function triggerBust(streak, serverStats) {
    setFlashKey((k) => k + 1);
    playBust();
    // boosted explicitly from serverStats (not just the ...state spread)
    // to cover the rare case where a run's very first press busts — the
    // server decides+persists daily_runs.boosted at that same moment
    // (see resolve_push), before state.boosted (still whatever
    // loadRunState set, i.e. false) has ever had a successful push to
    // update it from.
    persist({ ...state, streak, status: 'dead', boosted: serverStats ? serverStats.boosted : state.boosted });
    // After runBustSequence, not before — it calls resetBustVisuals()
    // internally (clearTimers + a fresh start for this run's reveal
    // sequence), which also clears bustQuote/shaking back to their resting
    // values for the *next* reset. Setting the real ones first would just
    // get wiped right back out by that.
    runBustSequence(streak);
    setBustQuote(getBustQuoteForStreak(streak));

    // Same 0-1 curve as the rest of the intensity system (see the effect
    // above) — scales the shake amplitude and how much debris falls/how
    // far, off how far this run actually got.
    const bustIntensity = Math.min(1, streak / 30);
    setShakeAmount(4 + bustIntensity * 14);
    setShaking(true);
    timers.current.push(setTimeout(() => setShaking(false), 500));

    spawnEffect('var(--neon-red)', 24);
    spawnDebris(bustIntensity);
  }

  function runBustSequence(streak) {
    clearTimers();
    resetBustVisuals();
    // Only a streak > 0 bust has a rarity reveal worth choreographing and
    // protecting from chrome popping back in mid-slide; a first-press bust
    // (streak 0) never collapsed chrome in the first place, so leave it be.
    if (streak > 0) setBustRevealing(true);
    timers.current.push(
      setTimeout(() => {
        setShowBusted(true);
        playReveal();
      }, 1800)
    );
    timers.current.push(setTimeout(() => setBustedSettled(true), 2600));
    if (streak > 0) {
      timers.current.push(setTimeout(() => setBustedSlid(true), 3600));
      // Gap from the slide to the rarity reveal was 1300ms (3600 -> 4900);
      // halved to 650ms so it lands at 4250 instead — keeps the
      // slide-then-reveal order intact, just snappier.
      timers.current.push(
        setTimeout(() => {
          setShowRarity(true);
          playReveal();
        }, 4250)
      );
      timers.current.push(setTimeout(() => setBustRevealing(false), 6850));
    }
  }

  async function resetBestStreak() {
    setBestStreakState(0);
    persist({ ...state, newBestToday: false });
    // Local mirror is cleared either way — for a logged-in user this
    // matters because a later login-time merge only ever raises values, so
    // a stale higher local number would otherwise resurrect the streak
    // this reset is trying to clear.
    await storage.setBestStreak(0);
    if (user) {
      const { data } = await supabase.functions.invoke('admin', { body: { action: 'reset_best_streak' } });
      if (data) setAuthStats((s) => ({ ...s, bestStreak: data.bestStreak }));
    }
  }

  async function adminResetDay() {
    clearTimers();
    resetBustVisuals();
    clearParticles();
    setRolling(false);
    await storage.resetTodayState();
    await storage.saveTodayNewBadges([]);
    const fresh = await storage.getTodayState();
    setState(fresh);
  }

  // Admin, logged in: these hit the admin Edge Function, which re-checks
  // the caller's role server-side (never trusts the client) before
  // mutating the real daily_runs row — see supabase/functions/admin.
  async function adminForceBustServer() {
    // Defense in depth alongside the button's own disabled={... || rolling}
    // — a rapid double-click can still fire before React re-renders that
    // disabled state, so this is the guard that actually always applies.
    if (rolling) return;
    const { data, error } = await supabase.functions.invoke('admin', { body: { action: 'force_bust' } });
    if (error || !data?.success) {
      console.error('force bust failed:', error ?? data);
      return;
    }
    bust(data.streak, {
      bestStreak: data.bestStreak,
      totalPushes: data.totalPushes,
      dayStreak: data.dayStreak,
      bustedAtZero: data.bustedAtZero,
      bustedAtOne: data.bustedAtOne,
      pityCount: data.pityCount,
      boosted: data.boosted,
    });
  }

  async function adminResetDayServer() {
    clearTimers();
    resetBustVisuals();
    clearParticles();
    setRolling(false);
    const { error } = await supabase.functions.invoke('admin', { body: { action: 'reset_day' } });
    if (error) {
      console.error('reset day failed:', error);
      return;
    }
    // Also wipe any local guest run state, not just the server row above —
    // loadRunState's own login-carry-over logic (see its comment) treats
    // "no server row for today" as "maybe this device has a guest run to
    // adopt," and silently resurrects one via sync-stats if it finds it.
    // Without this, any leftover local run (e.g. from testing as a guest
    // earlier the same day, before logging in) would immediately undo this
    // reset the moment loadRunState below re-queries and finds nothing.
    await storage.resetTodayState();
    await storage.saveTodayNewBadges([]);
    await loadRunState();
  }

  // Deletes today's money_runs row server-side, then signals MoneyMode
  // (via moneyResetSignal) to re-fetch — same "wipe, then let the normal
  // load path pick up the fresh state" approach as adminResetDayServer
  // above, just without needing this component to know anything about
  // MoneyMode's internal state shape.
  async function adminResetMoneyDay() {
    const { error } = await supabase.functions.invoke('admin', { body: { action: 'reset_money_day' } });
    if (error) {
      console.error('reset money day failed:', error);
      return;
    }
    dismissBadgeToast();
    setMoneyResetSignal((k) => k + 1);
  }

  // Dev tool — forces the CURRENT (still-filling) combo-bar cycle to pay
  // out a diamond once it fills, instead of waiting on the normal 10%
  // roll (see admin/index.ts's force_money_diamond_next). Bumps its own
  // signal, not moneyResetSignal — that one wipes the whole in-progress
  // run's local state, which would defeat the point of testing this
  // mid-run.
  async function adminForceMoneyDiamond() {
    const { error } = await supabase.functions.invoke('admin', { body: { action: 'force_money_diamond_next' } });
    if (error) {
      console.error('force money diamond failed:', error);
      return;
    }
    setMoneyForceDiamondSignal((k) => k + 1);
  }

  // Shop-testing dev tools — see admin/index.ts's add_diamonds/
  // drain_diamonds for what actually changes server-side. refreshMoneyStats
  // pulls the new balance back into stats.moneyDiamonds so MoneyShop.jsx's
  // Buy buttons reflect it immediately, same as every other money-mode
  // mutation already refreshes after writing.
  async function adminAddDiamonds() {
    const { error } = await supabase.functions.invoke('admin', { body: { action: 'add_diamonds' } });
    if (error) {
      console.error('add diamonds failed:', error);
      return;
    }
    refreshMoneyStats();
  }

  async function adminDrainDiamonds() {
    const { error } = await supabase.functions.invoke('admin', { body: { action: 'drain_diamonds' } });
    if (error) {
      console.error('drain diamonds failed:', error);
      return;
    }
    refreshMoneyStats();
  }

  // Re-arms weekly bust insurance on demand instead of waiting for the
  // real Monday reset (see api/weekly-money-reset.js) — no signal prop
  // needed unlike adminResetMoneyDay/adminForceMoneyDiamond above, since
  // MoneyMode.jsx's own insurance badge reads straight off
  // stats.insuranceUsedThisWeek, which refreshMoneyStats already updates.
  async function adminResetInsurance() {
    const { error } = await supabase.functions.invoke('admin', { body: { action: 'reset_insurance' } });
    if (error) {
      console.error('reset insurance failed:', error);
      return;
    }
    refreshMoneyStats();
  }

  // Forces every already-open tab (anyone's, not just this admin's) to
  // hard-reload right now — see admin/index.ts's force_reload action and
  // pwaUpdate.js's subscribeToForceReload for the other end of this. Fire-
  // and-forget on purpose: this tab is about to reload too the instant its
  // own broadcast comes back around, so there's nothing useful to do with
  // the response even on success.
  async function adminForceReloadAll() {
    const { error } = await supabase.functions.invoke('admin', { body: { action: 'force_reload' } });
    if (error) console.error('force reload failed:', error);
  }

  // Dev tool — adds one Comeback Boost pity charge (capped at 3, armed).
  // Real testing otherwise means 3 genuine early busts, one per day.
  async function adminAddPityCharge() {
    const { data, error } = await supabase.functions.invoke('admin', { body: { action: 'pity_add_charge' } });
    if (error || !data?.success) {
      console.error('add pity charge failed:', error ?? data);
      return;
    }
    setAuthStats((s) => ({ ...s, pityCount: data.pityCount }));
    // authStats alone doesn't drive the visible meter — displayedPityCount
    // does (see schedulePityFillReveal), so without this the bar wouldn't
    // actually move until the next real push/login re-synced it.
    setDisplayedPityCount(data.pityCount);
  }

  // Shares the classic "Force bust" button (see the onClick branch below)
  // rather than a separate button. Deliberately NOT a remount (unlike
  // adminResetMoneyDay above) — a remount would load MoneyMode fresh from
  // an already-'dead' row and take its "already resolved" instant-restore
  // path (see MoneyMode.jsx), skipping the whole animated reveal sequence
  // entirely. A bumped signal prop instead lets MoneyMode handle its own
  // bust the same way a real one from a failed push does — shake/flash/
  // debris, then the full timed reveal — since it already owns all of
  // that logic and this session's real state (pushes/earnings) in memory.

  // Money fields are only meaningful for logged-in accounts (money mode
  // has no guest path at all), so the local guest mirror below only ever
  // gets the classic-mode subset of whatever zeroStatsForAllBadges()/
  // maxStatsForAllBadges() derive — the server call further down gets the
  // FULL derived set (classic + money), since that's the one place money
  // badges actually live.
  async function adminResetBadges() {
    clearTimers();
    resetBustVisuals();
    // Local mirror cleared either way — see resetBestStreak's comment on
    // why that matters for logged-in users (avoids the next login-time
    // merge resurrecting the numbers this just reset).
    await storage.resetBadgeProgress();
    setBestStreakState(0);
    setStats(DEFAULT_STATS);
    setEarnedAtRunStart(new Set());
    if (user) {
      // Derived from BADGES itself (see game.js) — adding a new badge is
      // automatically enough to make "reset all badges" clear it too,
      // nothing here needs updating by hand.
      const zeroed = zeroStatsForAllBadges();
      const fields = { ...camelToSnakeFields(zeroed), last_played_date: null };
      const { data } = await supabase.functions.invoke('admin', { body: { action: 'reset_badges', fields } });
      if (data?.success) {
        setAuthStats((prev) => ({ ...prev, ...zeroed }));
      }
    }
  }

  // Dev-only: maxes out every stat every badge check reads, so all of them
  // (including the two bust-flavor ones, and every money badge) come back
  // earned at once — for testing the badge list/flair UI without actually
  // grinding for them. Sets earnedAtRunStart to match so this doesn't also
  // fire a "new badge" toast on the next bust.
  async function adminClaimAllBadges() {
    clearTimers();
    resetBustVisuals();
    // Derived from BADGES itself (see game.js) — adding a new badge is
    // automatically enough to make "claim all badges" grant it too,
    // nothing here needs updating by hand.
    const maxedAll = maxStatsForAllBadges();
    // Local guest storage only gets written for an actual guest — for a
    // logged-in admin, authStats (below) is the real source of truth, and
    // leaving MAXED values sitting in local storage would risk a future
    // guest-carry-over merge (see loadRunState's own comment on that path)
    // resurrecting them into the real profile later, e.g. after some other
    // future reset-day. resetBestStreak/adminResetBadges avoid this same
    // trap by only ever writing SAFE (zeroed) values to local storage
    // regardless of login state — this is the one tool that used to write
    // real (maxed) values unconditionally instead.
    if (!user) {
      const localMaxed = {
        totalPushes: maxedAll.totalPushes,
        dayStreak: maxedAll.dayStreak,
        lastPlayedDate: pacificDateString(),
        bustedAtZero: maxedAll.bustedAtZero,
        bustedAtOne: maxedAll.bustedAtOne,
      };
      await storage.saveStats(localMaxed);
      await storage.setBestStreak(maxedAll.bestStreak);
      setStats(localMaxed);
    }
    setBestStreakState(maxedAll.bestStreak);
    setEarnedAtRunStart(new Set(earnedBadges(maxedAll).map((b) => b.id)));
    if (user) {
      const fields = { ...camelToSnakeFields(maxedAll), last_played_date: pacificDateString() };
      const { data } = await supabase.functions.invoke('admin', { body: { action: 'claim_all_badges', fields } });
      if (data?.success) {
        setAuthStats((prev) => ({ ...prev, ...maxedAll }));
      }
    }
  }

  // Comeback Boost's guaranteed presses count as free (100%) toward this
  // run's real odds of getting this far — see rarityForStreak's own
  // guaranteedThrough param — so the "TOP X%" reveal only scores whatever
  // streak this run reached BEYOND the guarantee window against genuine
  // 90% odds, same honesty requirement as the boost's visible odds bar.
  const pct =
    state.status === 'dead' && state.streak > 0
      ? rarityForStreak(state.streak, state.boosted ? PITY_GUARANTEE_STREAK : 0)
      : null;
  const buttonLabel = state.status === 'dead' ? 'Busted' : rolling ? '…' : 'Push';
  // Home-screen only — hidden the instant a run goes mid-streak or while
  // the bust reveal is still choreographing itself, same condition that
  // already drives chrome's own collapse (classicCollapsed, declared
  // above) — reappears the moment the board's actually back at rest.
  // (Registered-only gate lives at the JSX mount point below, not here.)
  const pityMeterVisible = (displayedPityCount > 0 || pityFillBlocking) && !classicCollapsed;
  // Shop-unlocked push-button skin (see MoneyShop.jsx/purchase_diamond_button)
  // — classic mode only, guests included (authStats is null while logged
  // out, so this is just false for them, same as any other money-mode
  // field). Gated on active_push_skin (see schema.sql), not just ownership
  // — MoneyShop.jsx's Equip/Unequip toggle is what actually sets this, so
  // owning it is necessary but no longer sufficient for it to render here.
  const diamondButtonActive = authStats?.activePushSkin === 'diamond_button';
  // Hovering stops the idle-pulse animation (rather than just adding an
  // unrelated :hover rule) so the hover feedback actually shows instead of
  // being silently overridden by the running animation — see DECISIONS.md
  // on animations blocking :hover for the same property.
  // Used to be streak === 0 only (the pre-first-press "come push me"
  // invite) — now applies for the whole run, since the animation itself
  // is what carries the mid-run heartbeat (see the intensity effect
  // above): it reads as the same slow invite at streak 0 and speeds up
  // from there, rather than needing a separate mid-run mechanism.
  const idlePulseBase = state.status === 'playing' && !rolling;
  const idlePulseActive = idlePulseBase && !buttonHover;
  // Same reasoning as idlePulseActive above — bustedSmolder is also an
  // infinite box-shadow animation, and an active animation always wins
  // over a plain stylesheet rule for the same property, so a
  // .push-btn--dead:hover rule would otherwise never actually show.
  // Pausing it on hover (buttonHover stays true for the whole time the
  // cursor sits still over the button, including a press-and-hold, since
  // mouseenter/mouseleave don't fire again for that) is what makes the
  // busted button feel responsive to hover at all, not just to a
  // completed click.
  const bustedIdle = state.status === 'dead' && !buttonHover;

  return (
    <div>
      <header
        className={'panel spotlight header-panel' + (chromeCollapsed ? ' header-panel--collapsed' : '')}
        onMouseMove={spotlightMove}
        style={{ textAlign: 'center' }}
      >
        <div
          key={oddsFlashKey}
          className={'mono odds-text' + (uiMode === 'money' ? ' odds-text--money' : ' odds-text--classic')}
          style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', marginBottom: 8 }}
        >
          {/* Comeback Boost's real guaranteed-through-streak-10 window
              (state.boosted) deliberately does NOT change this text or add
              any badge — kept at the same plain 90%/10% for consistency,
              same silent treatment as the first-run guarantee (see
              FIRST_RUN_GUARANTEE_STREAK in game.js). The pity meter below
              is the only visible sign of the mechanic now. */}
          {uiMode === 'money'
            ? `${Math.round(MONEY_SUCCESS_CHANCE * 100)}% you live · ${100 - Math.round(MONEY_SUCCESS_CHANCE * 100)}% you don't`
            : "90% you live · 10% you don't"}
        </div>
        <h1 className="gradient-title" style={{ fontSize: 36 }}>Pushdle</h1>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
          Press your luck. No skill, just nerve.
        </div>
      </header>

      {/* Money-variant mode switch — open to everyone, guests included,
          but HIDDEN entirely (not just disabled) until hasPlayedClassic —
          a new/guest player who's never pushed shouldn't see a locked
          button advertising a mode they can't reach yet, only find out
          once they've earned it. Once true it stays true (a permanent,
          ever-increasing total_pushes threshold), so this can only ever
          go from hidden to shown, never back. Not persisted across
          reloads (see uiMode above). Only collapses alongside the header
          while MONEY mode is the active one (chromeCollapsed && uiMode
          === 'money'), not classic's own chromeCollapsed unconditionally
          — classic collapses the instant a run goes mid-streak
          (state.streak > 0), which is the EXACT same moment a brand-new
          player's unlocking push resolves, so unconditional collapse
          here made the just-unlocked button disappear before they could
          ever click it, with no way back short of busting that run
          (confirmed live: the unlock modal's own "Try Money Mode" button
          still works since it calls startModeSwitch directly, bypassing
          this row entirely — clicking the actual header button was what
          silently failed). Also collapses (not just while MONEY mode is
          active) for as long as classicCollapsed is true — a mid-run
          switch invite competes with the actual run for attention, and
          popping back in mid-reveal (before the rest of the chrome has
          settled back to normal) read as it jumping the gun. Reusing the
          same always-mounted/class-toggled .header-panel--collapsed this
          row already uses for the money-mode case (rather than
          conditionally mounting the row at all) is what gives this a real
          collapse/reveal transition instead of a straight pop-in the
          instant it busts — it only actually reappears once
          classicCollapsed itself goes false, i.e. the same moment the rest
          of the chrome (nav bar/header) finishes un-collapsing. Still
          slides out/in via modeSlotStyle on an actual mode switch, same
          slot-0 timing as the streak/run panel(s) right below it, so this
          row rides along with the rest of the page's own switch transition
          instead of just snapping to its new label/Shop-button state. */}
      {hasPlayedClassic && (
      <div
        className={'header-panel' + ((chromeCollapsed && uiMode === 'money') || (uiMode === 'classic' && classicCollapsed) ? ' header-panel--collapsed' : '')}
        style={{ display: 'flex', justifyContent: 'center', gap: MONEY_PANEL_GAP, marginBottom: 12, ...modeSlotStyle(modeTransition, 0) }}
      >
        {/* A shared literal width on both buttons (not their own natural
            text width) is what lines the gap between them up with the
            gap between MoneyMode's run/wallet panels below — same fix as
            those panels (see MONEY_PANEL_WIDTH in MoneyMode.jsx): "←
            Back to classic" and "🛍 Shop" are very different lengths, so
            without this the gap between them sits wherever the longer
            label happens to push it, not at the row's true center. 140
            comfortably fits "← Back to classic", the longer of the two.
            The gap itself is MONEY_PANEL_GAP (imported from
            MoneyMode.jsx), the same literal value the panels below use,
            so the two gaps match exactly, not just their positions. */}
        <button
          className="btn-ghost btn-money-mode"
          onClick={() => startModeSwitch(uiMode === 'classic' ? 'money' : 'classic')}
          disabled={!!modeTransition || pityFillBlocking}
          title={uiMode === 'classic' ? 'Try money mode' : 'Back to classic'}
          style={{ width: 140, textAlign: 'center' }}
        >
          {uiMode === 'classic' ? '💰 Money mode' : '← Back to classic'}
        </button>
        {/* Guest-gated too, same as the shop panel below — a guest who's
            unlocked Money Mode still can't actually shop (no account to
            spend diamonds from), so this button would just open a panel
            with nothing usable in it. */}
        {uiMode === 'money' && user && (
          <button
            className="btn-ghost btn-shop"
            onClick={() =>
              setShowMoneyShop((s) => {
                (s ? playShopClose : playShopOpen)();
                return !s;
              })
            }
            style={{ width: 140, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
          >
            <img src="/diamond.png" alt="" width={14} height={14} style={{ display: 'block' }} />
            Shop
          </button>
        )}
      </div>
      )}

      {/* Slides down right under the button that opens it, pushing the
          game content below it down rather than overlaying — same "always
          mounted, class-toggled" technique as .header-panel/
          .money-wallet-panel above (see global.css's .money-shop-wrap),
          so both the open AND close directions get a real transition
          instead of just popping in and vanishing on unmount. Mounted for
          the whole time uiMode==='money', not just while showMoneyShop is
          true — the class alone drives opacity/transform; unmounting only
          happens by leaving money mode entirely (see the uiMode check
          here and startModeSwitch's own setShowMoneyShop(false)). Height
          itself is the one part NOT class-driven — it's the live
          shopContentHeight measurement above, so switching tabs inside the
          shop (each a different natural height) animates smoothly to the
          new size instead of snapping, and the open/close reveal always
          targets the shop's real current content instead of a guessed
          worst case. */}
      {uiMode === 'money' && user && (
        <div
          className={'money-shop-wrap' + (showMoneyShop ? '' : ' money-shop-wrap--collapsed')}
          style={{ height: showMoneyShop ? shopContentHeight : 0 }}
        >
          <div ref={shopContentRef} style={{ overflow: 'hidden' }}>
            <MoneyShop onClose={() => setShowMoneyShop(false)} />
          </div>
        </div>
      )}

      {uiMode === 'money' ? (
        <MoneyMode
          forceBustSignal={moneyForceBustSignal}
          resetSignal={moneyResetSignal}
          forceDiamondSignal={moneyForceDiamondSignal}
          modeTransition={modeTransition}
          onMoneyResolved={checkMoneyBadges}
        />
      ) : (
      <div
        className={shaking ? 'screen-shake' : ''}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', '--shake-amount': `${shakeAmount}px` }}
      >
        <div
          ref={streakPanelRef}
          className="spotlight"
          onMouseMove={spotlightMove}
          style={{
            background: '#06060a',
            border: '1px solid rgba(139,92,246,0.4)',
            borderRadius: 12,
            padding: '12px 30px',
            textAlign: 'center',
            marginBottom: 24,
            ...modeSlotStyle(modeTransition, 0),
          }}
        >
          <div className="mono hover-pop" style={{ fontWeight: 700, fontSize: 42, color: 'var(--neon-green)' }}>
            {state.streak}
          </div>
          <div className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
            streak
          </div>
          <div className="mono" style={{ fontSize: 10, color: state.newBestToday ? '#ffd45e' : 'var(--text-dim)', marginTop: 6 }}>
            {state.newBestToday ? 'New personal best!' : `Best: ${bestStreak}`}
          </div>
        </div>

        {/* Comeback Boost pity meter — registered accounts only (see
            profiles.pity_count in schema.sql; guests have no server-tracked
            pity state at all), always mounted once logged in (not
            conditionally on pityMeterVisible) so the collapse/reveal below
            gets a real transition instead of an instant pop — same
            always-mounted, class-toggled .header-panel/.header-panel--
            collapsed technique the money-mode switch row already uses,
            reused as-is. Home-screen only (pityMeterVisible, declared
            above) — hidden mid-run and through the whole bust reveal,
            reappearing once the board's actually back at rest, which is
            also the exact moment a qualifying bust's fill-up animation
            (see schedulePityFillReveal) is timed to start.

            While pityFillBlocking, .pity-meter-spotlight's own huge
            box-shadow (see global.css) dims the ENTIRE rest of the page —
            not a separate overlay element, which would need its own
            z-index fight against every transformed ancestor this row
            already has (modeSlotStyle) — a box-shadow is part of this
            element's own paint, so position:relative + one z-index here is
            enough to guarantee it (and everything the shadow covers) sits
            above the rest of the page regardless of ancestor transforms. */}
        {user && (
          <div
            className={'header-panel' + (!pityMeterVisible ? ' header-panel--collapsed' : '')}
            style={{ marginBottom: 16, ...modeSlotStyle(modeTransition, 0) }}
          >
            <div className={'pity-meter' + (pityFillBlocking ? ' pity-meter-spotlight' : '')}>
              <div className="pity-meter-track">
                <div
                  className={'pity-meter-fill' + (displayedPityCount >= PITY_CHARGES_NEEDED ? ' pity-meter-fill--armed' : '')}
                  style={{ width: `${Math.min(100, (displayedPityCount / PITY_CHARGES_NEEDED) * 100)}%` }}
                />
              </div>
              <div className="mono pity-meter-label">
                {displayedPityCount >= PITY_CHARGES_NEEDED ? 'Comeback Boost armed for this run' : 'Comeback Boost building'}
              </div>
            </div>
          </div>
        )}

        <div className={poking ? 'push-wrap--poke' : ''} style={{ position: 'relative', ...modeSlotStyle(modeTransition, 1) }}>
          {diamondButtonActive ? (
            // Shop-unlocked skin — same handlers/disabled logic as the
            // default button below, just image-based (no border/background
            // box to draw a CSS ring on, see .push-btn-diamond's own
            // comment). The label needs .push-btn-label's dark halo
            // treatment — a plain <span> reads fine against the default
            // button's flat near-black background, but not against this
            // busier image.
            <button
              onClick={push}
              onMouseEnter={() => setButtonHover(true)}
              onMouseLeave={() => setButtonHover(false)}
              disabled={rolling || pityFillBlocking}
              className={
                'push-btn-diamond' +
                (state.status === 'dead' ? ' push-btn-diamond--dead' : ' push-btn-diamond--playing') +
                (idlePulseActive ? ' push-btn-diamond--idle-pulse' : '') +
                (bustedIdle ? ' push-btn-diamond--busted-idle' : '')
              }
              style={{ width: 190, height: 190 }}
            >
              <img src="/diamond-button.png" alt="" width={190} height={190} style={{ display: 'block', pointerEvents: 'none' }} />
              <span className="push-btn-label">{buttonLabel}</span>
            </button>
          ) : (
            <button
              onClick={push}
              onMouseEnter={() => setButtonHover(true)}
              onMouseLeave={() => setButtonHover(false)}
              // Not disabled once busted anymore — see pokeBustedButton, push
              // now routes dead-state clicks there instead of the real push
              // logic, rather than the button just doing nothing.
              disabled={rolling || pityFillBlocking}
              className={
                'push-btn' +
                (state.status === 'dead' ? ' push-btn--dead' : ' push-btn--playing') +
                (idlePulseActive ? ' push-btn--idle-pulse' : '') +
                (bustedIdle ? ' push-btn--busted-idle' : '')
              }
              style={{
                width: 190,
                height: 190,
                borderRadius: '50%',
                background: 'var(--panel)',
                color: 'var(--text)',
                fontWeight: 700,
                fontSize: 16,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              {buttonLabel}
            </button>
          )}
          <div className="particle-field">
            {rings.map((r) => (
              <div key={r.id} className="pulse-ring" style={{ '--ring-color': r.color }} />
            ))}
            {particles.map((p) => (
              <div key={p.id} className={'particle' + (p.debris ? ' particle--debris' : '')} style={p.style} />
            ))}
          </div>
        </div>

        <div className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)', ...modeSlotStyle(modeTransition, 2) }}>
          {state.status === 'dead'
            ? pokeQuip ?? bustQuote ?? 'Run over. Come back tomorrow.'
            : state.streak === 0
            ? 'Tap to take your first push.'
            : quote ?? '1 in 10 chance this ends it.'}
        </div>

        {state.status === 'dead' && (
          <div style={{ marginTop: 24, textAlign: 'center', ...modeSlotStyle(modeTransition, 3) }}>
            <div className="bust-reveal-row">
              {showBusted && (
                <div
                  className={'bust-busted' + (bustedSettled ? ' settled' : '') + (bustedSlid ? ' slid' : '')}
                >
                  Busted!
                </div>
              )}
              {showRarity && pct !== null && (
                <div className={'bust-rarity' + (instant ? ' instant' : '')}>
                  <span className="gradient-title">TOP {formatRarity(pct)}</span>
                </div>
              )}
            </div>
            <div className="mono" style={{ marginTop: 20, fontSize: 11, color: 'var(--text-dim)' }}>
              Next run in {formatCountdown(msUntilNextPacificMidnight())}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 16 }}>
              <button className="btn-ghost" onClick={handleShare}>
                📤 Share this run
              </button>
              <button className="btn-ghost" onClick={handleCopy}>
                📋 Copy result
              </button>
            </div>
            {shareStatus && (
              <div className="mono" style={{ marginTop: 8, fontSize: 10, color: 'var(--neon-cyan)' }}>
                {shareStatus}
              </div>
            )}
          </div>
        )}

      </div>
      )}

      {flashKey > 0 && <div key={flashKey} className="screen-flash" />}

      {/* Portaled straight to <body> — this is global overlay chrome, not
          page content, so it must escape .page-transition's transformed
          subtree. While that wrapper's enter animation is running, its
          active `transform` makes it the containing block for any
          position:fixed descendant, which made the admin button and badge
          toast render at the wrong offset for the ~400ms of every route
          change and then visibly snap into place — this was the real cause
          of the "glitch for a split second" bug, not a scrollbar issue. */}
      {createPortal(
        <>
          <OnboardingModal
            forceOpen={forceShowOnboarding}
            onForceOpenConsumed={() => setForceShowOnboarding(false)}
          />

          {showMoneyUnlockModal && (
            <MoneyModeUnlockModal
              onTryMoney={() => {
                setShowMoneyUnlockModal(false);
                // A preview dismissal never marks it seen — see
                // moneyUnlockPreview's own declaration comment. Real
                // dismissals mark it server-side for a logged-in account,
                // or locally for a guest (see lib/moneyUnlock.js).
                if (moneyUnlockPreview) setMoneyUnlockPreview(false);
                else if (user) markMoneyUnlockSeen();
                else markMoneyUnlockSeenLocally();
                startModeSwitch('money');
              }}
              onDismiss={() => {
                setShowMoneyUnlockModal(false);
                if (moneyUnlockPreview) setMoneyUnlockPreview(false);
                else if (user) markMoneyUnlockSeen();
                else markMoneyUnlockSeenLocally();
              }}
            />
          )}

          {showPityIntroModal && (
            <PityIntroModal
              onDismiss={() => {
                setShowPityIntroModal(false);
                // A preview dismissal never marks it seen — see
                // pityIntroPreview's own declaration comment. Registered
                // accounts only (see PityIntroModal.jsx), so no guest-local
                // fallback branch needed the way MoneyModeUnlockModal has.
                if (pityIntroPreview) setPityIntroPreview(false);
                else markPityIntroSeen();
              }}
            />
          )}

          {showMoneyWeeklyResultsModal && moneyWeeklyResultsData && (
            <MoneyWeeklyResultsModal
              rank={moneyWeeklyResultsData.rank}
              scoreCents={moneyWeeklyResultsData.scoreCents}
              diamondsAwarded={moneyWeeklyResultsData.diamondsAwarded}
              top3={moneyWeeklyResultsData.top3}
              onDismiss={() => {
                setShowMoneyWeeklyResultsModal(false);
                // A preview dismissal never marks it seen — see
                // moneyWeeklyResultsPreview's own declaration comment.
                if (moneyWeeklyResultsPreview) setMoneyWeeklyResultsPreview(false);
                else markMoneyWeeklyResultsSeen();
              }}
            />
          )}

          {showMoneyUpgradeChoiceModal && (
            <MoneyUpgradeChoiceModal
              ownsInsurance={!!authStats?.ownsInsurance}
              ownsStreakBonus={!!authStats?.ownsStreakBonus}
              ownsDaredevil={!!authStats?.ownsDaredevil}
              currentActive={authStats?.activeMoneyUpgrade ?? null}
              onConfirm={async (upgrade) => {
                // set_active_money_upgrade (see schema.sql) is the real
                // enforcement point AND what actually flips
                // money_upgrade_choice_seen true — same RPC MoneyShop.jsx's
                // own Activate button calls, so a choice made here and one
                // made directly in the shop (while still unlocked) go
                // through the exact same path.
                try {
                  const { error } = await supabase.functions.invoke('set-active-money-upgrade', { body: { upgrade } });
                  if (error) console.error('set active money upgrade failed:', error);
                } catch (err) {
                  console.error('set active money upgrade failed:', err);
                }
                await refreshMoneyStats();
                setShowMoneyUpgradeChoiceModal(false);
              }}
            />
          )}

          {showModifierUpdateModal && (
            <ModifierUpdateModal
              onDismiss={() => {
                setShowModifierUpdateModal(false);
                // A preview dismissal never marks it seen — see
                // modifierUpdatePreview's own declaration comment.
                if (modifierUpdatePreview) setModifierUpdatePreview(false);
                else markModifierUpdateSeen();
              }}
            />
          )}

          {/* Gated strictly by role now the site is actually public — this
              used to also show for guests (no account = no role to check),
              since that was the only way to dev-test the local/guest game
              loop at all. That let any real visitor reach Force Bust/Reset
              Day/Claim All Badges, which is fine for a local dev build but
              not for a deployed one anyone can hit. To dev-test the guest
              flow now, log in as an admin account first (isAdmin gates this
              regardless of which flow — guest or logged-in — is actually
              being exercised on screen).
              Pinned to the literal screen corner (flat right:12px), not
              aligned to .nav-bar's content edge — top uses --admin-top,
              which is flush (0) on wider viewports where there's side
              margin beside the bar to sit in, or ducks below it
              (--nav-bar-clearance) on narrow ones where the bar spans full
              width instead (see global.css). Height matches
              --nav-bar-height for visual weight even when it's not
              literally attached to the bar. */}
          {isAdmin && (
            <button
              className="btn-ghost"
              onClick={() => setShowAdmin((s) => !s)}
              style={{
                position: 'fixed',
                top: 'var(--admin-top)',
                right: 12,
                height: 'var(--nav-bar-height)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                padding: '0 14px',
                zIndex: 56,
              }}
            >
              🛠 Admin
            </button>
          )}

          {isAdmin && showAdmin && (
            <div
              className="panel spotlight"
              onMouseMove={spotlightMove}
              style={{
                position: 'fixed',
                top: 'calc(var(--admin-top) + var(--nav-bar-height) + 6px)',
                right: 12,
                width: 190,
                padding: 14,
                border: '1px dashed rgba(255,212,94,0.5)',
                zIndex: 56,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                // This list only ever grows as more dev tools get added —
                // without a cap it runs off the bottom of the viewport
                // with no way to reach whatever's below the fold. Caps at
                // the remaining space below this panel's own (dynamic,
                // scroll-position-dependent) top offset instead of a flat
                // number, so it still uses the full available height on a
                // tall viewport rather than clipping early.
                maxHeight: 'calc(100vh - var(--admin-top) - var(--nav-bar-height) - 20px)',
                overflowY: 'auto',
              }}
            >
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: '#ffd45e', textTransform: 'uppercase' }}>
                Dev tools
              </div>
              <button
                className="btn-ghost"
                // Classic's own "already playing?" disabled-check doesn't
                // apply in money mode — MoneyMode owns its run state
                // internally, not exposed here, so the server-side
                // "no active run" 409 in adminForceBustMoney is what
                // actually guards that case instead.
                //
                // `|| rolling` closes a real race: a push's own response
                // takes 450ms+network to land (see pushServer), and until
                // it does, state.status is still 'playing' — clicking
                // Force Bust in that window used to fire a second,
                // independent bust that could land before or after the
                // in-flight push's own callback, with whichever one
                // resolved LAST on the client winning the displayed state
                // regardless of what the server actually did first.
                disabled={uiMode === 'classic' && (state.status !== 'playing' || rolling)}
                onClick={() => (uiMode === 'money' ? setMoneyForceBustSignal((k) => k + 1) : user ? adminForceBustServer() : bust(state.streak))}
              >
                💥 Force bust
              </button>
              <button className="btn-ghost" onClick={user ? adminResetDayServer : adminResetDay}>
                ⏱ Reset day timer
              </button>
              <button className="btn-ghost" onClick={adminResetMoneyDay}>⏱ Reset money timer</button>
              <button className="btn-ghost" onClick={adminForceMoneyDiamond}>💎 Force diamond next</button>
              <button className="btn-ghost" onClick={adminAddDiamonds}>💎 +1000 diamonds</button>
              <button className="btn-ghost" onClick={adminDrainDiamonds}>💎 Drain diamonds</button>
              <button className="btn-ghost" onClick={adminResetInsurance}>
                <img src="/shield.png" alt="" width={12} height={12} style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 4 }} /> Reset insurance timer
              </button>
              <button className="btn-ghost" onClick={adminAddPityCharge}>🍀 Add pity charge</button>
              <button className="btn-ghost" onClick={adminForceReloadAll}>🚨 Force reload all tabs</button>
              <button className="btn-ghost" onClick={resetBestStreak}>↺ Reset best streak</button>
              <button className="btn-ghost" onClick={adminResetBadges}>🏅 Reset all badges</button>
              <button className="btn-ghost" onClick={adminClaimAllBadges}>🏆 Claim all badges</button>
              <button className="btn-ghost" onClick={() => setForceShowOnboarding(true)}>👋 Show onboarding</button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setMoneyUnlockPreview(true);
                  setShowMoneyUnlockModal(true);
                }}
              >
                🎉 Preview money unlock
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  setPityIntroPreview(true);
                  setShowPityIntroModal(true);
                }}
              >
                🍀 Preview pity intro
              </button>
              <button
                className="btn-ghost"
                onClick={async () => {
                  // Uses this account's own real last-week snapshot if it
                  // has one, same numbers a real trigger would show —
                  // falls back to a fixed demo (2nd place, so the Golden
                  // Goose banner and a real diamond count both render)
                  // for an admin account that's never actually ranked, so
                  // this stays useful for testing on a fresh/never-played
                  // admin login too. All three fields come from the SAME
                  // branch, never mixed — moneyLastWeekScoreCents/
                  // moneyLastWeekDiamondsAwarded both default to a real 0
                  // (not null) on an unranked account, so falling back
                  // field-by-field with `??` used to pair a demo rank
                  // with real (zeroed) score/diamonds and show a
                  // self-contradictory "Rank #2, $0, outside the top 10".
                  const hasRealRank = authStats?.moneyLastWeekRank != null;
                  const rank = hasRealRank ? authStats.moneyLastWeekRank : 2;
                  const { data } = await supabase
                    .from('money_weekly_resets')
                    .select('top3')
                    .order('week_start', { ascending: false })
                    .limit(1)
                    .maybeSingle();
                  setMoneyWeeklyResultsData({
                    rank,
                    scoreCents: hasRealRank ? authStats.moneyLastWeekScoreCents : 15000,
                    diamondsAwarded: hasRealRank ? authStats.moneyLastWeekDiamondsAwarded : diamondsForWeeklyRank(rank),
                    top3: data?.top3 ?? [],
                  });
                  setMoneyWeeklyResultsPreview(true);
                  setShowMoneyWeeklyResultsModal(true);
                }}
              >
                🪿 Preview weekly results
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  // Unlike the results preview above, there's no fake data
                  // to fabricate here — this account's own real owned/active
                  // upgrades always exist and are safe to show regardless of
                  // whether the real trigger conditions (uiMode==='money',
                  // moneyUpgradeChoiceSeen===false, owns at least one) are
                  // actually met right now. Setting the shown-ref too keeps
                  // this consistent with a real trigger that happens to fire
                  // while this is already open, same reasoning as every
                  // other preview button's own ref-guard interaction.
                  moneyUpgradeChoiceShownRef.current = true;
                  setShowMoneyUpgradeChoiceModal(true);
                }}
              >
                🎰 Preview weekly upgrade choice
              </button>
              <button
                className="btn-ghost"
                onClick={() => {
                  // No fake data to fabricate here either — this modal's
                  // content is static, hand-written copy, not derived from
                  // this account's own stats. Same shown-ref/preview-flag
                  // treatment as every other preview button above.
                  modifierUpdateShownRef.current = true;
                  setModifierUpdatePreview(true);
                  setShowModifierUpdateModal(true);
                }}
              >
                📣 Preview modifier update
              </button>
            </div>
          )}

          <BadgeToastStack
            show={showBadges}
            newBadges={newBadges}
            instant={instant}
            leaving={badgesLeaving}
            // Lines up with the streak panel's own top (--streak-panel-top,
            // measured off the actual panel — see the useLayoutEffect
            // above), not the Admin corner. Wrapped in max() with the
            // dev-panel clearance so it still can't land on top of an
            // open panel on the rare screens narrow/short enough for
            // that to actually reach this far down.
            topStyle={{
              top: showAdmin
                ? 'max(var(--streak-panel-top), calc(var(--admin-top) + var(--nav-bar-height) + 300px))'
                : 'var(--streak-panel-top)',
            }}
          />
        </>,
        document.body
      )}
    </div>
  );
}
