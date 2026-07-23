import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import * as storage from '../lib/storage.js';
import { rollPush, rarityForStreak, formatRarity, earnedBadges, buildShareText, BADGES, RARITY_META } from '../lib/game.js';
import { getQuoteForStreak, getBustQuoteForStreak, getPokeQuip } from '../lib/quotes.js';
import { playPush, playSuccess, playBust, playBadge, playNav, playReveal, playPoke } from '../lib/sound.js';
import { spotlightMove } from '../lib/spotlight.js';
import { useChrome } from '../lib/ChromeContext.jsx';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';

const DEFAULT_STATS = { totalPushes: 0, dayStreak: 0, lastPlayedDate: null, bustedAtZero: false, bustedAtOne: false };
// The "intensity" system (button heartbeat + background glow, see the
// effect below) doesn't start ramping until the streak passes this —
// early pushes stay at the calm resting baseline the whole way through.
const INTENSITY_START_STREAK = 15;
// Off for now (see showCracks below) — parked rather than removed. All of
// buildCrackGrowth and the crack-overlay/label JSX are still fully intact;
// flipping this back to true is the only change needed to bring the
// cracked-button effect back.
const CRACKS_ENABLED = false;

function msUntilNextDay() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next - now;
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const BUTTON_RADIUS = 95; // matches the 190px push button

// The button's crack pattern is now a LIVE, ongoing thing tied directly to
// the current streak (see buildCrackGrowth) — not something only revealed
// once you bust. Nothing shows below streak 15 (same floor as the other
// intensity effects, see INTENSITY_START_STREAK); from there, every 5
// pushes is a new "milestone": the cracks already on screen each pick up
// one more branch, and a couple of new small nicks appear at the edge.
// Busting just freezes state.streak at its final value, which freezes this
// too, automatically — no separate bust-time computation needed. Uses its
// own tiny seeded PRNG (not Math.random) so the SAME streak always grows
// the SAME pattern, rather than reshuffling on every render.
function crackRng(seed) {
  let a = seed;
  return () => {
    a = (a * 1103515245 + 12345) & 0x7fffffff;
    return a / 0x7fffffff;
  };
}

const CRACK_CENTER = 95;
const CRACK_EDGE_R = 92;
// Hard ceiling on how far any INTERIOR crack point can sit from center —
// the button's own visible edge is 95 (its 190px diameter / 2), so this
// stays a couple px inside that. Without it, jitter could push a point
// past 95 and the line would visibly poke outside the circular button onto
// the page background. Belt-and-suspenders with the CSS clip on
// .crack-overlay itself (see global.css) — this keeps the math honest,
// that keeps it foolproof even if the math isn't.
const CRACK_MAX_R = 93;
// Where every line's very first point (its origin, right at the button's
// rim) gets placed — deliberately PAST the true edge rather than aimed at
// landing on it, because jitter aimed at 95 sometimes fell short and the
// crack visibly didn't quite reach the edge. Placing it out here instead
// and letting the CSS clip-path trim it flush guarantees contact every
// time, rather than hoping the jitter rolls close enough.
const CRACK_START_R = 99;

function pathFromPoints(points) {
  return 'M' + points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' L');
}

function pointsToSegments(points) {
  const segs = [];
  for (let i = 0; i < points.length - 1; i++) segs.push([points[i], points[i + 1]]);
  return segs;
}

// Standard orientation-based segment intersection test (ignores the
// degenerate collinear/touching-endpoint cases — fine here, this is only
// ever used to keep decorative crack lines from visibly crossing, not
// anything that needs to be mathematically airtight).
function crossProduct(o, a, b) {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}
function segmentsIntersect(a1, a2, b1, b2) {
  const d1 = crossProduct(b1, b2, a1);
  const d2 = crossProduct(b1, b2, a2);
  const d3 = crossProduct(a1, a2, b1);
  const d4 = crossProduct(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function conflictsWithCommitted(points, committed) {
  return pointsToSegments(points).some((s) => committed.some((c) => segmentsIntersect(s[0], s[1], c[0], c[1])));
}

// One jagged line's points, walking from the edge inward to `endR` from
// center. Each step's radius AND angle both get real jitter (not a gentle
// taper), so it reads as a lightning-bolt zigzag — sharp direction changes
// are the whole point of a fracture line, a smooth curve reads as a seam,
// not a crack. Returns the raw points (not yet a path string) — branches
// fork off real points on this line, and callers use the points to check
// for intersections against everything already placed.
function jaggedRadialPoints(rng, angle, endR, segments) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const r =
      i === 0
        ? CRACK_START_R + (rng() - 0.5) * 4
        : Math.min(CRACK_MAX_R, CRACK_EDGE_R + (endR - CRACK_EDGE_R) * t + (rng() - 0.5) * 16);
    const a = angle + (i === 0 || i === segments ? 0 : (rng() - 0.5) * 0.7);
    points.push([CRACK_CENTER + r * Math.cos(a), CRACK_CENTER + r * Math.sin(a)]);
  }
  return points;
}

// A short offshoot growing from an existing point on a main crack's own
// line (not the button's edge) — this is what makes the whole thing read
// as a tree (small branches splitting off bigger ones). Anchored to a real
// point already on the parent line — a branch computed with fully
// independent jitter could land somewhere that doesn't actually touch the
// line it's supposed to be forking off.
function growBranch(rng, originPoint, originR, angle, endR, segments) {
  const points = [originPoint];
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const r = Math.min(CRACK_MAX_R, originR + (endR - originR) * t + (rng() - 0.5) * 10);
    const a = angle + (rng() - 0.5) * 0.6;
    points.push([CRACK_CENTER + r * Math.cos(a), CRACK_CENTER + r * Math.sin(a)]);
  }
  return points;
}

// No cracking at all below streak 15 — same floor as the rest of the
// intensity system. From there, every 5 pushes is a new milestone; capped
// at 9 (streak ~55) so a very long run doesn't keep piling on more and
// more branches/nicks forever — roughly matches the background glow's own
// ramp, which tops out around streak 60.
function milestoneForStreak(streak) {
  if (streak < 15) return 0;
  return Math.min(9, Math.floor((streak - 15) / 5) + 1);
}

const CRACK_GROWTH_SEED = 7;
const MAX_BRANCHES_PER_MAIN = 4;

// Builds the button's whole crack pattern for a given streak, from
// scratch, milestone by milestone — not incrementally mutated state, a
// pure function of streak alone, so the same streak always regrows the
// exact same pattern (live while playing, or frozen once busted — both
// just call this with whatever state.streak currently is).
//
// Milestone 1 (streak 15): two main cracks appear, roughly opposite each
// other, plus one small edge nick. Every milestone after that, each main
// crack still under the branch cap picks up one more branch, and two new
// small standalone nicks appear at the edge — "a bunch of small cracks
// branching off some longer ones," per the brief, rather than the earlier
// spiderweb-of-rings design.
//
// Every new line is placed via `place`, which retries with fresh jitter
// (up to a few times) if the candidate would visibly cross something
// already on the button, so the pattern stays (almost always) free of
// self-intersections without needing a perfect geometric guarantee.
function buildCrackGrowth(streak) {
  const milestone = milestoneForStreak(streak);
  if (milestone === 0) return [];

  const rng = crackRng(CRACK_GROWTH_SEED);
  const committed = [];
  const mains = [];
  const paths = [];

  function place(genFn, maxAttempts = 14) {
    let candidate = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      candidate = genFn();
      if (!conflictsWithCommitted(candidate, committed)) break;
    }
    committed.push(...pointsToSegments(candidate));
    return candidate;
  }

  const rotationOffset = rng() * Math.PI * 2;
  for (let i = 0; i < 2; i++) {
    const baseAngle = rotationOffset + i * Math.PI;
    const points = place(() => jaggedRadialPoints(rng, baseAngle + (rng() - 0.5) * 0.6, 48, 4));
    mains.push({ points, branches: 0 });
    paths.push(pathFromPoints(points));
  }
  paths.push(
    pathFromPoints(place(() => jaggedRadialPoints(rng, rng() * Math.PI * 2, CRACK_EDGE_R - (8 + rng() * 14), 2)))
  );

  for (let m = 2; m <= milestone; m++) {
    for (const main of mains) {
      if (main.branches >= MAX_BRANCHES_PER_MAIN) continue;
      const points = place(() => {
        const idx = 1 + Math.floor(rng() * (main.points.length - 2));
        const origin = main.points[idx];
        const originR = Math.hypot(origin[0] - CRACK_CENTER, origin[1] - CRACK_CENTER);
        const originAngle = Math.atan2(origin[1] - CRACK_CENTER, origin[0] - CRACK_CENTER);
        const branchAngle = originAngle + (rng() - 0.5) * 1.6;
        const branchEndR = Math.max(10, originR - (14 + rng() * 20));
        return growBranch(rng, origin, originR, branchAngle, branchEndR, 2);
      });
      main.branches += 1;
      paths.push(pathFromPoints(points));
    }
    for (let i = 0; i < 2; i++) {
      const points = place(() => jaggedRadialPoints(rng, rng() * Math.PI * 2, CRACK_EDGE_R - (8 + rng() * 14), 2));
      paths.push(pathFromPoints(points));
    }
  }

  return paths;
}

export default function Home() {
  const [state, setState] = useState({ streak: 0, status: 'playing', newBestToday: false });
  const [bestStreak, setBestStreakState] = useState(0);
  const [rolling, setRolling] = useState(false);
  const [showBusted, setShowBusted] = useState(false);
  const [bustedSettled, setBustedSettled] = useState(false);
  const [bustedSlid, setBustedSlid] = useState(false);
  const [showRarity, setShowRarity] = useState(false);
  const [bustRevealing, setBustRevealing] = useState(false);
  const [particles, setParticles] = useState([]);
  const [rings, setRings] = useState([]);
  const [flashKey, setFlashKey] = useState(0);
  // Bust impact effects — see triggerBust. shaking gates whether the
  // .screen-shake class/animation is applied at all; shakeAmount is its
  // amplitude in px (read via the --shake-amount CSS var). The crack
  // pattern itself isn't separate bust-only state anymore — see crackPaths
  // below, derived straight from state.streak.
  const [shaking, setShaking] = useState(false);
  const [shakeAmount, setShakeAmount] = useState(6);
  const [tick, setTick] = useState(0);
  const [showAdmin, setShowAdmin] = useState(false);
  const [buttonHover, setButtonHover] = useState(false);
  const [stats, setStats] = useState(DEFAULT_STATS);
  const [earnedAtRunStart, setEarnedAtRunStart] = useState(new Set());
  const [newBadges, setNewBadges] = useState([]);
  const [showBadges, setShowBadges] = useState(false);
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
  // Separate from `timers` on purpose: clearTimers() (called at the start
  // of every new bust sequence) used to also wipe these — if a bust
  // happened while a push's particle burst was still mid-flight (its own
  // 900ms/700ms cleanup timers hadn't fired yet), that cleanup got
  // cancelled and the particles/rings were orphaned in state forever,
  // permanently stuck on screen. Kept isolated so a bust's own timer reset
  // can never cancel an unrelated particle burst's cleanup.
  const particleTimers = useRef([]);
  const particleId = useRef(0);
  const statsInitialized = useRef(false);
  const streakPanelRef = useRef(null);
  const { setCollapsed } = useChrome();
  const { user, isAdmin, stats: authStats, setStats: setAuthStats } = useAuth();

  // Logged-in users' today's run lives server-side (daily_runs), and so do
  // their lifetime stats now (profiles.best_streak/total_pushes/day_streak/
  // busted_at_zero/busted_at_one) — AuthContext merges any pre-existing
  // local progress into the server row on login and holds the
  // authoritative copy as `authStats`. Guests have no server row, so they
  // keep using storage.js exactly as before.
  async function loadRunState() {
    const today = new Date().toISOString().slice(0, 10);
    let s;
    if (user) {
      const { data } = await supabase
        .from('daily_runs')
        .select('streak, status')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle();
      s = data
        ? { date: today, streak: data.streak, status: data.status, newBestToday: false }
        : { date: today, streak: 0, status: 'playing', newBestToday: false };
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
      // No separate crack restoration needed — crackPaths (below) derives
      // straight from state.streak, which setState(s) just set to the
      // run's final value, so it's already showing the right pattern.
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

  useEffect(() => {
    if (user === undefined) return;
    if (statsInitialized.current) return;

    async function loadStats() {
      if (user) {
        // authStats starts null right after login while AuthContext's
        // merge is still in flight — wait for it rather than flashing
        // zeroed stats (which would also poison earnedAtRunStart).
        if (!authStats) return null;
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
      // Snapshot of what's already earned before this run's pushes count,
      // so a bust can later diff against it to find what's newly earned.
      setEarnedAtRunStart(new Set(earnedBadges({ bestStreak: best, ...s }).map((b) => b.id)));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authStats]);

  useEffect(() => {
    return () => {
      timers.current.forEach(clearTimeout);
      particleTimers.current.forEach(clearTimeout);
      clearTimeout(pokeQuipTimerRef.current);
    };
  }, []);

  // Header + nav bar collapse (see ChromeContext) whenever there's an
  // active streak in progress, or while the bust reveal is still
  // choreographing itself — both cases want the board to feel focused,
  // uninterrupted by chrome. Falls back to collapsed=false on unmount so
  // navigating away never leaves the nav bar stuck hidden.
  const midRun = state.status === 'playing' && state.streak > 0;
  const collapsed = midRun || bustRevealing;
  useEffect(() => {
    setCollapsed(collapsed);
  }, [collapsed, setCollapsed]);
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
  }, [collapsed, state.status, state.streak, state.newBestToday, bestStreak, user]);

  // Once busted, tick every second so the "next run" countdown is live,
  // and re-check the date so the run auto-resets the moment it rolls over.
  useEffect(() => {
    if (state.status !== 'dead') return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
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

  function resetBustVisuals() {
    setShowBusted(false);
    setBustedSettled(false);
    setBustedSlid(false);
    setShowRarity(false);
    setBustRevealing(false);
    setShowBadges(false);
    setNewBadges([]);
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

  // speedScale > 1 (see the intensity system, applySuccess below) makes
  // particles travel further and complete sooner — a bigger, snappier
  // burst rather than just a proportionally-slower-looking bigger one.
  // Part of the same "escalates with streak" system as the button
  // heartbeat/background glow (see the intensity effect above), just
  // computed per-call here instead of read from a :root var, since it
  // only ever affects a fire-and-forget burst rather than something
  // continuously on-screen.
  function spawnEffect(color, count = 16, speedScale = 1) {
    // Particles start on the button's own edge (BUTTON_RADIUS out from
    // center), spread evenly around the ring with a little jitter, so the
    // burst reads as coming off the button rather than its middle.
    const angleJitter = Math.random() * Math.PI * 2;
    const newOnes = Array.from({ length: count }).map((_, i) => {
      const angle = angleJitter + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const dist = (70 + Math.random() * 90) * speedScale;
      const sx = Math.cos(angle) * BUTTON_RADIUS;
      const sy = Math.sin(angle) * BUTTON_RADIUS;
      return {
        id: particleId.current++,
        style: {
          '--sx': `${sx}px`,
          '--sy': `${sy}px`,
          '--dx': `${Math.cos(angle) * (BUTTON_RADIUS + dist)}px`,
          '--dy': `${Math.sin(angle) * (BUTTON_RADIUS + dist)}px`,
          '--dur': `${(0.45 + Math.random() * 0.3) / speedScale}s`,
          background: color,
          boxShadow: `0 0 10px ${color}, 0 0 3px #fff`,
        },
      };
    });
    const ringId = particleId.current++;
    setParticles((p) => [...p, ...newOnes]);
    setRings((r) => [...r, { id: ringId, color }]);
    const ids = newOnes.map((p) => p.id);
    particleTimers.current.push(
      setTimeout(() => setParticles((p) => p.filter((x) => !ids.includes(x.id))), 900)
    );
    particleTimers.current.push(
      setTimeout(() => setRings((r) => r.filter((x) => x.id !== ringId)), 700)
    );
  }

  // Bust-only companion to spawnEffect, fired alongside it (see
  // triggerBust) rather than instead of it — the red burst reads as the
  // impact spark, this reads as the wreckage falling afterward. Angles are
  // constrained to a downward cone (roughly ±50° off straight down)
  // instead of spawnEffect's full 360°, and rendered with the
  // .particle--debris modifier (ease-in timing — see global.css — instead
  // of ease-out), so the same --sx/--sy/--dx/--dy trajectory math reads as
  // gravity pulling something down instead of an outward blast. intensity
  // (0-1, see triggerBust) scales both how much debris there is and how
  // far it falls.
  function spawnDebris(intensity) {
    const count = Math.round(6 + intensity * 14);
    const newOnes = Array.from({ length: count }).map(() => {
      const angle = Math.PI / 2 + (Math.random() - 0.5) * 1.75; // ~±50° around straight down
      const dist = (50 + Math.random() * 70) * (1 + intensity * 0.6);
      const sx = Math.cos(angle) * BUTTON_RADIUS * 0.6;
      const sy = Math.sin(angle) * BUTTON_RADIUS * 0.6;
      const size = 4 + Math.random() * 5;
      return {
        id: particleId.current++,
        debris: true,
        style: {
          '--sx': `${sx}px`,
          '--sy': `${sy}px`,
          '--dx': `${Math.cos(angle) * dist}px`,
          // extra downward pull on top of the angled distance, so it reads
          // as falling rather than just a lower-angled burst.
          '--dy': `${Math.sin(angle) * dist + 30 + intensity * 30}px`,
          '--dur': `${0.7 + Math.random() * 0.4}s`,
          width: `${size}px`,
          height: `${size}px`,
          background: '#4a3838',
          boxShadow: '0 0 6px rgba(0,0,0,0.5)',
        },
      };
    });
    setParticles((p) => [...p, ...newOnes]);
    const ids = newOnes.map((p) => p.id);
    particleTimers.current.push(
      setTimeout(() => setParticles((p) => p.filter((x) => !ids.includes(x.id))), 1300)
    );
  }

  // A spark or two flaking off the crack when the busted button gets
  // poked (see pokeBustedButton) — much smaller/quicker than spawnDebris's
  // pile of falling wreckage, since this isn't a second impact, just
  // catching the light as an already-broken surface gets jostled. Reuses
  // the same .particle burst mechanics (--sx/--sy/--dx/--dy, ease-out) at
  // a fraction of the scale, colored like the crack's own glow rather than
  // debris's dark chips, so it reads as coming off the fracture itself.
  function spawnSpark() {
    const count = 1 + Math.floor(Math.random() * 3);
    const newOnes = Array.from({ length: count }).map(() => {
      const angle = Math.random() * Math.PI * 2;
      const startR = BUTTON_RADIUS * 0.55;
      const dist = 14 + Math.random() * 22;
      return {
        id: particleId.current++,
        style: {
          '--sx': `${Math.cos(angle) * startR}px`,
          '--sy': `${Math.sin(angle) * startR}px`,
          '--dx': `${Math.cos(angle) * (startR + dist)}px`,
          '--dy': `${Math.sin(angle) * (startR + dist)}px`,
          '--dur': `${0.3 + Math.random() * 0.2}s`,
          width: '4px',
          height: '4px',
          background: '#fff3ea',
          boxShadow: '0 0 6px rgba(255,60,60,0.9), 0 0 3px #fff',
        },
      };
    });
    setParticles((p) => [...p, ...newOnes]);
    const ids = newOnes.map((p) => p.id);
    particleTimers.current.push(
      setTimeout(() => setParticles((p) => p.filter((x) => !ids.includes(x.id))), 550)
    );
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
      const success = rollPush(state.streak);
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
      };

      if (data.success) {
        applySuccess(data.streak, serverStats);
      } else {
        bust(data.streak, serverStats);
      }
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
    } else if (newStreak > bestStreak) {
      newBestToday = true;
      setBestStreakState(newStreak);
      storage.setBestStreak(newStreak);
    }
    persist({ ...state, streak: newStreak, status: 'playing', newBestToday });
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
    triggerBust(streak);
    recordBustAndCheckBadges(streak, serverStats);
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
      setNewBadges(newly);
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
      timers.current.push(
        setTimeout(() => {
          measureStreakPanelTop();
          setShowBadges(true);
          playBadge();
        }, streak > 0 ? 8000 : 3000)
      );
    }
  }

  function triggerBust(streak) {
    setFlashKey((k) => k + 1);
    playBust();
    persist({ ...state, streak, status: 'dead' });
    // After runBustSequence, not before — it calls resetBustVisuals()
    // internally (clearTimers + a fresh start for this run's reveal
    // sequence), which also clears bustQuote/shaking back to their resting
    // values for the *next* reset. Setting the real ones first would just
    // get wiped right back out by that.
    runBustSequence(streak);
    setBustQuote(getBustQuoteForStreak(streak));

    // Same 0-1 curve as the rest of the intensity system (see the effect
    // above) — scales the shake amplitude and how much debris falls/how
    // far, off how far this run actually got. The crack pattern itself
    // isn't set here anymore — it's already been growing live throughout
    // the run (see crackPaths, derived from state.streak) and just stays
    // exactly as it was at the moment of busting.
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
    setParticles([]);
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
    });
  }

  async function adminResetDayServer() {
    clearTimers();
    resetBustVisuals();
    setParticles([]);
    setRolling(false);
    const { error } = await supabase.functions.invoke('admin', { body: { action: 'reset_day' } });
    if (error) {
      console.error('reset day failed:', error);
      return;
    }
    await storage.saveTodayNewBadges([]);
    await loadRunState();
  }

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
      const { data } = await supabase.functions.invoke('admin', { body: { action: 'reset_badges' } });
      if (data) {
        const { success, ...serverStats } = data;
        setAuthStats(serverStats);
      }
    }
  }

  // Dev-only: maxes out every stat every badge check reads, so all of them
  // (including the two bust-flavor ones) come back earned at once — for
  // testing the badge list/flair UI without actually grinding for them.
  // Sets earnedAtRunStart to match so this doesn't also fire a "new badge"
  // toast on the next bust.
  async function adminClaimAllBadges() {
    clearTimers();
    resetBustVisuals();
    const maxed = {
      totalPushes: 1000,
      dayStreak: 100,
      lastPlayedDate: new Date().toISOString().slice(0, 10),
      bustedAtZero: true,
      bustedAtOne: true,
    };
    await storage.saveStats(maxed);
    await storage.setBestStreak(100);
    setStats(maxed);
    setBestStreakState(100);
    setEarnedAtRunStart(new Set(earnedBadges({ bestStreak: 100, ...maxed }).map((b) => b.id)));
    if (user) {
      const { data } = await supabase.functions.invoke('admin', { body: { action: 'claim_all_badges' } });
      if (data) {
        const { success, ...serverStats } = data;
        setAuthStats(serverStats);
      }
    }
  }

  const pct = state.status === 'dead' && state.streak > 0 ? rarityForStreak(state.streak) : null;
  // The crack pattern grows the whole time in the background once the
  // streak passes 15 (see buildCrackGrowth) — computed off state.streak,
  // same as the rest of the intensity system — but stays hidden from the
  // player until the run actually ends, a bust reveal rather than a
  // visible countdown to one. Memoized since recomputing this is cheap
  // either way, but it's still a small pile of work (segment-intersection
  // checks against everything already placed) that doesn't need to redo
  // itself on renders unrelated to the streak.
  const crackPaths = useMemo(() => buildCrackGrowth(state.streak), [state.streak]);
  const showCracks = CRACKS_ENABLED && state.status === 'dead' && crackPaths.length > 0;
  const buttonLabel = state.status === 'dead' ? 'Busted' : rolling ? '…' : 'Push';
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
        className={'panel spotlight header-panel' + (collapsed ? ' header-panel--collapsed' : '')}
        onMouseMove={spotlightMove}
        style={{ textAlign: 'center' }}
      >
        <div className="mono" style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--neon-cyan)', marginBottom: 8 }}>
          90% you live · 10% you don't
        </div>
        <h1 className="gradient-title" style={{ fontSize: 36 }}>Pushdle</h1>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
          Press your luck. No skill, just nerve.
        </div>
      </header>

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

        {/* The poke bounce (see pokeBustedButton) lives on THIS wrapper, not
            just the <button> — it needs to move the button, the crack
            overlay, and the label all together as one rigid piece. Putting
            the transform on the button alone left the crack lines (drawn in
            a separate sibling SVG) sitting still while the button's own
            edge shrank/rotated under them, so for that ~220ms the cracks
            visibly detached from the button's edge instead of looking like
            part of the same cracked surface flinching. */}
        <div className={poking ? 'push-wrap--poke' : ''} style={{ position: 'relative' }}>
          <button
            onClick={push}
            onMouseEnter={() => setButtonHover(true)}
            onMouseLeave={() => setButtonHover(false)}
            // Not disabled once busted anymore — see pokeBustedButton, push
            // now routes dead-state clicks there instead of the real push
            // logic, rather than the button just doing nothing.
            disabled={rolling}
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
            {/* Invisible (not removed — a real button still needs real text
                for accessibility/click semantics) whenever the crack overlay
                is showing. positioned elements always paint above
                non-positioned in-flow content in the same stacking context
                regardless of DOM order, so crack-overlay (position:absolute)
                was rendering on top of this text even though it comes first
                in the markup — at high severity the cracks could visually
                cross right over the label. The visible label lives in a
                separate topmost element below instead. */}
            <span style={{ visibility: showCracks ? 'hidden' : 'visible' }}>{buttonLabel}</span>
          </button>
          {showCracks && (
            <>
              <svg className="crack-overlay" viewBox="0 0 190 190">
                {crackPaths.map((d, i) => (
                  <path key={i} d={d} />
                ))}
              </svg>
              {/* Sits above the crack overlay (later in the DOM, same
                  positioned-stacking rules that put the cracks above the
                  button put this above them) with a soft dark halo behind
                  it — keeps the label readable no matter how dense the
                  crack pattern gets. pointer-events:none so it's purely
                  visual, doesn't block clicks meant for the button under it. */}
              <div className="push-btn-label">{buttonLabel}</div>
            </>
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

        <div className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)' }}>
          {state.status === 'dead'
            ? pokeQuip ?? bustQuote ?? 'Run over. Come back tomorrow.'
            : state.streak === 0
            ? 'Tap to take your first push.'
            : quote ?? '1 in 10 chance this ends it.'}
        </div>

        {state.status === 'dead' && (
          <div style={{ marginTop: 24, textAlign: 'center' }}>
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
              Next run in {formatCountdown(msUntilNextDay())}
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
              }}
            >
              <div className="mono" style={{ fontSize: 10, letterSpacing: '0.15em', color: '#ffd45e', textTransform: 'uppercase' }}>
                Dev tools
              </div>
              <button
                className="btn-ghost"
                disabled={state.status !== 'playing'}
                onClick={() => (user ? adminForceBustServer() : bust(state.streak))}
              >
                💥 Force bust
              </button>
              <button className="btn-ghost" onClick={user ? adminResetDayServer : adminResetDay}>
                ⏱ Reset day timer
              </button>
              <button className="btn-ghost" onClick={resetBestStreak}>↺ Reset best streak</button>
              <button className="btn-ghost" onClick={adminResetBadges}>🏅 Reset all badges</button>
              <button className="btn-ghost" onClick={adminClaimAllBadges}>🏆 Claim all badges</button>
            </div>
          )}

          {showBadges && newBadges.length > 0 && (
            <div
              className="badge-toast-stack"
              // Lines up with the streak panel's own top (--streak-panel-top,
              // measured off the actual panel — see the useLayoutEffect
              // above), not the Admin corner. Wrapped in max() with the
              // dev-panel clearance so it still can't land on top of an
              // open panel on the rare screens narrow/short enough for
              // that to actually reach this far down.
              style={{
                top: showAdmin
                  ? 'max(var(--streak-panel-top), calc(var(--admin-top) + var(--nav-bar-height) + 300px))'
                  : 'var(--streak-panel-top)',
              }}
            >
              <div className={'badge-toast-banner' + (instant ? ' instant' : '')}>
                {newBadges.length === 1 ? 'New Badge' : 'New Badges'}
              </div>
              {newBadges.map((b, i) => (
                <BadgeToastCard key={b.id} badge={b} index={i} instant={instant} />
              ))}
            </div>
          )}
        </>,
        document.body
      )}
    </div>
  );
}

// Icon sized to match its own card's text column (pill row + "Badge
// earned" row) instead of a static font-size — a fixed size would either
// undershoot on cards where the pill wraps to its own line (RARE/EPIC
// etc. can push the column taller) or overshoot on plain one-line cards.
// Measured per-card (not a shared CSS var, unlike --nav-bar-clearance/
// --streak-panel-top) because multiple badges can be earned in the same
// bust and each card's column can end up a different height.
function BadgeToastCard({ badge, index, instant }) {
  const columnRef = useRef(null);
  const [iconSize, setIconSize] = useState(18);
  const navigate = useNavigate();

  useLayoutEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const measure = () => setIconSize(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={'badge-toast' + (instant ? ' instant' : '')}
      onClick={() => {
        playNav();
        navigate('/profile', { state: { scrollToBadges: true } });
      }}
      title="View your badges"
      style={{
        animationDelay: instant ? '0s' : `${index * 0.15}s`,
        '--rarity-color': RARITY_META[badge.rarity].color,
        cursor: 'pointer',
      }}
    >
      <div className="badge-toast-icon" style={{ fontSize: iconSize, lineHeight: `${iconSize}px` }}>
        🏅
      </div>
      <div className="badge-toast-col" ref={columnRef}>
        <div className="badge-toast-pill-row">
          <span className="badge-rarity">{RARITY_META[badge.rarity].label}</span>
        </div>
        <div className="badge-toast-sub">Badge earned</div>
      </div>
    </div>
  );
}
