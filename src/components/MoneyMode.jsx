import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { useParticles } from '../lib/useParticles.js';
import { pacificDateString, msUntilNextPacificMidnight } from '../lib/pacificDate.js';
import { MONEY_SUCCESS_CHANCE, MONEY_BONUS_EVERY, formatCents } from '../lib/money.js';
import { playPush, playSuccess, playBust } from '../lib/sound.js';

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
// regressing it. v1's reveal is intentionally simple (an immediate result,
// not a timed multi-stage sequence like classic's runBustSequence) — can
// be upgraded later once the mechanic itself is validated.
function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

const DEFAULT_RUN = { status: 'loading', pushes: 0, earningsCents: 0 };

export default function MoneyMode() {
  const { user, stats, setStats } = useAuth();
  const { particles, rings, spawnEffect } = useParticles();
  const [run, setRun] = useState(DEFAULT_RUN);
  const [rolling, setRolling] = useState(false);
  const [tick, setTick] = useState(0);

  // Gold idle-pulse while this mode is mounted — reuses .push-btn--idle-pulse
  // and the shared idlePulseGlow keyframe unchanged (both already read
  // color from these vars); reset on unmount so switching back to classic
  // doesn't leave its own pulse gold-tinted.
  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--pulse-color-dim', 'rgba(255,212,94,0.45)');
    root.setProperty('--pulse-color-bright', 'rgba(255,212,94,1)');
    root.setProperty('--pulse-accent-color', 'rgba(57,255,143,0.35)');
    return () => {
      root.removeProperty('--pulse-color-dim');
      root.removeProperty('--pulse-color-bright');
      root.removeProperty('--pulse-accent-color');
    };
  }, []);

  // Ticks once a second purely to force a re-render, so the "next run in
  // HH:MM:SS" countdown below (which reads the live clock fresh every
  // render, not from this state) stays current — same pattern as Home.jsx.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Loads today's existing run, if any — a fresh day (or a first-ever
  // push) has no row yet, which reads as a normal not-yet-started
  // 'playing' state rather than an error.
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
        setRun(
          data
            ? { status: data.status, pushes: data.pushes, earningsCents: data.earnings_cents }
            : { status: 'playing', pushes: 0, earningsCents: 0 }
        );
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function push() {
    if (!user || rolling || run.status !== 'playing') return;
    setRolling(true);
    playPush();
    try {
      const { data, error } = await supabase.functions.invoke('money-push');
      if (error || !data) throw error ?? new Error('no response');
      setRun({ status: data.status, pushes: data.pushes, earningsCents: data.earningsCents });
      if (data.success) {
        spawnEffect('#ffd45e', 16, 1);
        playSuccess(data.pushes);
      } else {
        playBust();
      }
    } catch (err) {
      console.error('money push failed:', err);
    } finally {
      setRolling(false);
    }
  }

  async function cashOut() {
    if (!user || rolling || run.status !== 'playing' || run.pushes === 0) return;
    setRolling(true);
    try {
      const { data, error } = await supabase.functions.invoke('money-cashout');
      if (error || !data) throw error ?? new Error('no response');
      setRun({ status: data.status, pushes: run.pushes, earningsCents: data.earningsCents });
      setStats((prev) => ({ ...prev, moneyWalletCents: data.walletCents, moneyLifetimeCents: data.lifetimeCents }));
    } catch (err) {
      console.error('money cash-out failed:', err);
    } finally {
      setRolling(false);
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div
        className="spotlight"
        style={{
          background: '#06060a',
          border: '1px solid rgba(255,212,94,0.4)',
          borderRadius: 12,
          padding: '12px 30px',
          textAlign: 'center',
          marginBottom: 24,
        }}
      >
        <div className="mono hover-pop" style={{ fontWeight: 700, fontSize: 42, color: '#ffd45e' }}>
          {formatCents(run.earningsCents)}
        </div>
        <div className="mono" style={{ fontSize: 9, letterSpacing: '0.2em', textTransform: 'uppercase', color: 'var(--text-dim)' }}>
          {run.status === 'cashed_out' ? 'banked' : "today's run"}
        </div>
        <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
          Wallet: {formatCents(stats?.moneyWalletCents)} · Lifetime: {formatCents(stats?.moneyLifetimeCents)}
        </div>
      </div>

      <div style={{ position: 'relative' }}>
        <button
          onClick={push}
          disabled={rolling || run.status !== 'playing'}
          className={
            'push-btn' +
            (run.status === 'dead'
              ? ' push-btn--dead'
              : run.status === 'cashed_out'
              ? ' push-btn--money-cashed'
              : ' push-btn--money-playing push-btn--idle-pulse')
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
          {/* Placeholder emoji — swap for the real money-bag art
              (public/money-bag.png, same convention as NavBar.jsx's
              question-mark.png) once it's supplied. */}
          {run.status === 'playing' ? '💰' : run.status === 'cashed_out' ? '✅' : '💥'}
        </button>
        <div className="particle-field">
          {rings.map((r) => (
            <div key={r.id} className="pulse-ring" style={{ '--ring-color': r.color }} />
          ))}
          {particles.map((p) => (
            <div key={p.id} className={'particle' + (p.debris ? ' particle--debris' : '')} style={p.style} />
          ))}
        </div>
      </div>

      <div className="mono" style={{ marginTop: 16, fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
        {run.status === 'dead'
          ? 'Busted — this run’s earnings are gone. Cashed-out money is always safe.'
          : run.status === 'cashed_out'
          ? `Cashed out ${formatCents(run.earningsCents)}!`
          : run.pushes === 0
          ? `Tap to take your first push. ${Math.round(MONEY_SUCCESS_CHANCE * 100)}% survive after that.`
          : `$1 a push, +$3 every ${MONEY_BONUS_EVERY}th. Cash out any time.`}
      </div>

      {run.status === 'playing' && run.pushes > 0 && (
        <button className="btn-ghost" style={{ marginTop: 16 }} onClick={cashOut} disabled={rolling}>
          💵 Cash out {formatCents(run.earningsCents)}
        </button>
      )}

      {resolved && (
        <div className="mono" style={{ marginTop: 20, fontSize: 11, color: 'var(--text-dim)' }}>
          Next run in {formatCountdown(msUntilNextPacificMidnight())}
        </div>
      )}
    </div>
  );
}
