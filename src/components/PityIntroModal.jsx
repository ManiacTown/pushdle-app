import { useEffect, useRef, useState } from 'react';
import { PITY_BUST_THRESHOLD, PITY_CHARGES_NEEDED } from '../lib/game.js';

// Matches OnboardingModal/MoneyModeUnlockModal's own exit-animation
// duration — reuses the exact same .onboarding-backdrop/.onboarding-modal/
// .onboarding-exiting CSS (see global.css), same "centered panel, glides
// in, glides back out on dismiss" shape as both.
const EXIT_DURATION_MS = 500;

// Explainer shown the first time a registered player's Comeback Boost
// meter actually plays its fill-up animation — see Home.jsx's
// schedulePityFillReveal for the real trigger (right after the meter
// finishes filling, not before — the player's already seen SOMETHING
// happen by the time this explains what it meant) and
// profiles.pity_intro_seen for what makes it one-time-ever. No "try it"
// action to offer (unlike MoneyModeUnlockModal) — this is purely
// explaining a mechanic already running in the background, so just the
// one acknowledgment button.
export default function PityIntroModal({ onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => onDismiss(), EXIT_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  function beginClose() {
    if (pendingRef.current) return; // ignore a second click mid-exit
    pendingRef.current = true;
    setExiting(true);
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) beginClose();
  }

  return (
    <div
      className={'onboarding-backdrop' + (exiting ? ' onboarding-exiting' : '')}
      role="dialog"
      aria-modal="true"
      aria-label="Comeback Boost"
      onClick={handleBackdropClick}
    >
      <div className={'panel onboarding-modal' + (exiting ? ' onboarding-exiting' : '')}>
        <div style={{ textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            New feature
          </p>
          <h2 className="gradient-title" style={{ fontSize: 28, marginBottom: 6 }}>
            🍀 Comeback Boost
          </h2>
          <p className="mono" style={{ fontSize: 12, color: 'var(--neon-green)', marginBottom: 20 }}>
            A little help when luck isn't on your side.
          </p>
        </div>

        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 18 }}>
          <p style={{ marginBottom: 10 }}>
            Bust at streak <strong style={{ color: 'var(--text)' }}>{PITY_BUST_THRESHOLD} or under</strong>,{' '}
            {PITY_CHARGES_NEEDED} times in a row, and the meter that just filled builds up a{' '}
            <strong style={{ color: 'var(--text)' }}>Comeback Boost</strong> for your next run.
          </p>
          <p>
            Once it's full, that next run gets a{' '}
            <strong style={{ color: 'var(--text)' }}>boost in luck</strong> to help you get back on
            track — just play it out.
          </p>
        </div>

        {/* The real meter component, shown armed/glowing — same classes
            Home.jsx's actual meter uses, so this is a preview of exactly
            what it looks like, not a separate illustration style. */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <div className="pity-meter">
            <div className="pity-meter-track">
              <div className="pity-meter-fill pity-meter-fill--armed" style={{ width: '100%' }} />
            </div>
            <div className="mono pity-meter-label">Comeback Boost armed for this run</div>
          </div>
        </div>

        <div className="mono onboarding-note" style={{ marginBottom: 22 }}>
          🔁 It only fires once, then resets on its own — nothing to manage, just keep playing.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <button className="btn-ghost onboarding-cta" onClick={beginClose}>
            Got it →
          </button>
        </div>
      </div>
    </div>
  );
}
