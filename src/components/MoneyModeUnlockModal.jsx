import { useEffect, useRef, useState } from 'react';
import { MONEY_SUCCESS_CHANCE } from '../lib/money.js';

// Matches OnboardingModal's own exit-animation duration — reuses the exact
// same .onboarding-backdrop/.onboarding-modal/.onboarding-exiting CSS (see
// global.css), since the "centered panel, glides in, glides back out on
// dismiss" shape is identical; only the copy and the CTA's destination
// differ, so a second parallel set of keyframes would just be duplication.
const EXIT_DURATION_MS = 500;

// Celebratory modal shown once an account both (a) has played classic at
// least once and (b) hasn't seen this yet — see Home.jsx's single
// effect watching authStats.totalPushes/moneyUnlockSeen for the actual
// trigger. That covers two different players with one mechanism: a
// brand-new player sees it right after their first-ever push, and an
// EXISTING player (total_pushes already > 0 from before this modal
// existed) sees it the next time they log in, as an announcement of a
// new feature rather than a first-push reward. profiles.money_unlock_seen
// (see schema.sql/AuthContext.jsx) is what makes it one-time-ever for
// either case — mirrors onboarding_seen's own column exactly.
export default function MoneyModeUnlockModal({ onTryMoney, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const pendingActionRef = useRef(null);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => {
      if (pendingActionRef.current === 'try') onTryMoney();
      else onDismiss();
    }, EXIT_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  function beginClose(action) {
    if (exiting) return;
    pendingActionRef.current = action;
    setExiting(true);
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) beginClose('dismiss');
  }

  return (
    <div
      className={'onboarding-backdrop' + (exiting ? ' onboarding-exiting' : '')}
      role="dialog"
      aria-modal="true"
      aria-label="Money Mode unlocked"
      onClick={handleBackdropClick}
    >
      <div className={'panel onboarding-modal' + (exiting ? ' onboarding-exiting' : '')}>
        <div style={{ textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            You just unlocked
          </p>
          <h2 className="gradient-title" style={{ fontSize: 28, marginBottom: 6 }}>
            💰 Money Mode
          </h2>
          <p className="mono" style={{ fontSize: 12, color: '#ffd45e', marginBottom: 8 }}>
            Same nerve. Real stakes.
          </p>
          <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 20 }}>
            <strong style={{ color: 'var(--text)' }}>
              {Math.round(MONEY_SUCCESS_CHANCE * 100)}% you keep it · {Math.round((1 - MONEY_SUCCESS_CHANCE) * 100)}% you don't
            </strong>
          </p>
        </div>

        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 18 }}>
          <p style={{ marginBottom: 10 }}>
            Same push-your-luck pressure as classic — except every push is worth{' '}
            <strong style={{ color: 'var(--text)' }}>$1</strong>, and you can{' '}
            <strong style={{ color: 'var(--text)' }}>cash out any time</strong> to bank it for good.
          </p>
          <p>
            Bust and you only lose what THIS run hasn't banked yet — every dollar you've already
            cashed out stays yours no matter what.
          </p>
        </div>

        <div className="mono onboarding-note" style={{ marginBottom: 10 }}>
          💎 Fill the combo bar for a cash bonus — or a diamond to spend in the shop.
        </div>
        <div className="mono onboarding-note" style={{ marginBottom: 22 }}>
          🏆 Bank runs all week to climb the weekly leaderboard — top 3 win prizes.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <button
            className="btn-ghost onboarding-cta"
            style={{ color: '#ffd45e', borderColor: 'rgba(255,212,94,0.5)' }}
            onClick={() => beginClose('try')}
          >
            Try Money Mode →
          </button>
          <button className="mono onboarding-link" onClick={() => beginClose('dismiss')}>
            Maybe later
          </button>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, textAlign: 'center' }}>
          <p className="mono onboarding-note" style={{ marginBottom: 6 }}>
            We've also got a <strong style={{ color: 'var(--text)' }}>Discord server</strong> — come hang out with other players.
          </p>
          <a
            href="https://discord.gg/6mXxFXM42"
            target="_blank"
            rel="noopener noreferrer"
            className="mono onboarding-link"
            style={{ display: 'inline-block' }}
          >
            Join the Discord →
          </a>
        </div>
      </div>
    </div>
  );
}
