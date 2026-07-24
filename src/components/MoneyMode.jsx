import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { useChrome } from '../lib/ChromeContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useParticles } from '../lib/useParticles.js';
import { pacificDateString, msUntilNextPacificMidnight } from '../lib/pacificDate.js';
import { MONEY_SUCCESS_CHANCE, formatCents } from '../lib/money.js';
import { playPush, playSuccess, playBust, playReveal, playCoinCollect, playCoinBank } from '../lib/sound.js';
import { modeSlotStyle } from '../lib/modeTransition.js';

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

export default function MoneyMode({ forceBustSignal, modeTransition }) {
  const { user, stats, setStats } = useAuth();
  const { setCollapsed } = useChrome();
  const { particles, rings, spawnEffect, popCoin, spawnDebris } = useParticles();
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
  const amountRef = useRef(null);
  const walletPanelRef = useRef(null);
  const cashOutBtnRef = useRef(null);
  const sparkleId = useRef(0);
  const timers = useRef([]);
  // A separate bucket from `timers` above, specifically for self-contained
  // click-feedback timers (button bounce reset, cash-out lingering clear)
  // — those need to survive runRevealSequence()'s own clearTimers() call,
  // which wipes `timers` the instant a reveal starts (it's guarding against
  // a double-click starting overlapping reveal sequences, not meant to
  // touch unrelated click feedback that was just queued a moment earlier).
  const clickFxTimers = useRef([]);

  useEffect(() => {
    return () => clickFxTimers.current.forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (flyingCoin) return; // hold the pre-cashout value until it actually lands
    setDisplayedWalletCents(stats?.moneyWalletCents ?? 0);
  }, [stats?.moneyWalletCents, flyingCoin]);

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
    supabase
      .from('money_runs')
      .select('pushes, earnings_cents, status')
      .eq('user_id', user.id)
      .eq('date', pacificDateString())
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
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
        } else if (next.status === 'playing' && next.pushes > 0) {
          // Mounting straight into a run already mid-play (e.g. navigated
          // away after pushing once, then back) — the wallet panel should
          // already be in its "exited" state here too, not defaulting back
          // to visible just because this is a fresh mount.
          setShowWalletPanel(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

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
      } else {
        triggerMoneyBust(data.pushes);
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
    // Immediate click feedback — no sound here anymore (see launchCoinToWallet
    // for the actual "money hits the bank" cue, played once the coin visually
    // lands, not at the click). Sparkles trace the button's own outline
    // (spawnBankBorderSparkles) rather than radiating from its center —
    // reads as the border itself lighting up, not a burst blowing past it.
    // The button also gets a quick expand-then-settle bounce
    // (bankBtnAnim/.btn-cash-out--pop) timed to roughly the same ~450ms.
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
      // Deliberately NOT updating stats/displayedWalletCents here — that
      // happens once the coin visually lands (see launchCoinToWallet), so
      // the wallet panel keeps showing the pre-cashout balance for the
      // whole reveal instead of jumping ahead of the animation.
      runRevealSequence();
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

        <div style={{ position: 'relative', ...modeSlotStyle(modeTransition, 1) }}>
          {/* Mirrors push-btn--idle-pulse's own condition exactly (playing,
              not mid-press/bounce) — same "still here, tap again" invite as
              classic's glowing border, just as a small glowing label since
              this button has no border/box to glow (see .money-bag-btn's
              own comment on why it's borderless). */}
          {run.status === 'playing' && !bagAnim && <div className="money-tap-aura">tap</div>}
          <button
            onClick={push}
            disabled={rolling || run.status !== 'playing'}
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

        <div className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center', ...modeSlotStyle(modeTransition, 2) }}>
          {run.status === 'dead'
            ? 'Cashed-out money is always safe.'
            : run.status === 'cashed_out'
            ? 'Nice take.'
            : run.pushes === 0
            ? `Tap to take your first push. ${Math.round(MONEY_SUCCESS_CHANCE * 100)}% survive after that.`
            : 'Cash out any time.'}
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
