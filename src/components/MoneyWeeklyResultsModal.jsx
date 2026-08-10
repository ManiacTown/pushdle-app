import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatCents, diamondsForWeeklyRank } from '../lib/money.js';
import { playNav } from '../lib/sound.js';
import WeeklyPodium from './WeeklyPodium.jsx';

// Matches OnboardingModal/MoneyModeUnlockModal/PityIntroModal's own
// exit-animation duration — reuses the exact same .onboarding-backdrop/
// .onboarding-modal/.onboarding-exiting CSS (see global.css), same
// "centered panel, glides in, glides back out on dismiss" shape as all
// three.
const EXIT_DURATION_MS = 500;

// 4th-10th all share one row in the infographic (same prize, same
// diamondsForWeeklyRank tier) — everything else gets its own row. Diamond
// counts are derived from diamondsForWeeklyRank (money.js), not
// hand-typed again here, so this table can't silently drift from the
// tiers that function documents.
const PRIZE_TIERS = [
  { minRank: 1, maxRank: 1, label: '🥇 1st place' },
  { minRank: 2, maxRank: 2, label: '🥈 2nd place' },
  { minRank: 3, maxRank: 3, label: '🥉 3rd place' },
  { minRank: 4, maxRank: 10, label: '4th – 10th' },
].map((tier) => ({ ...tier, diamonds: diamondsForWeeklyRank(tier.minRank) }));

function PrizeTierRow({ label, diamonds, highlighted }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '7px 10px',
        borderRadius: 8,
        background: highlighted ? 'rgba(255,212,94,0.12)' : 'rgba(255,255,255,0.02)',
        border: highlighted ? '1px solid rgba(255,212,94,0.5)' : '1px solid var(--line)',
      }}
    >
      <span className="mono" style={{ fontSize: 11, color: highlighted ? '#ffd45e' : 'var(--text-dim)', fontWeight: highlighted ? 700 : 400 }}>
        {label}
      </span>
      <span className="mono" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: highlighted ? '#ffd45e' : 'var(--text)' }}>
        {diamonds}
        <img src="/diamond.png" alt="" width={12} height={12} style={{ display: 'block' }} />
      </span>
    </div>
  );
}

// Announces last week's money-mode weekly-leaderboard results the first
// time a ranked account logs in after the Monday reset — see
// finalize_money_week's own comment in schema.sql for what actually
// computed rank/scoreCents/diamondsAwarded, and Home.jsx's trigger effect
// for the gating (moneyWeeklyResultsSeen === false AND this account
// actually has a rank). Silent resets were the whole problem this exists
// to fix: the reset itself has run every Monday since launch, but nobody
// was ever told what happened to them in it.
export default function MoneyWeeklyResultsModal({ rank, scoreCents, diamondsAwarded, top3, onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const pendingRef = useRef(false);
  const navigate = useNavigate();

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

  const madeTop3 = rank != null && rank <= 3;
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null;
  // diamondsAwarded is passed straight through from what
  // finalize_money_week actually credited (schema.sql) — never
  // re-derived here, so this always matches what really landed in the
  // account's wallet even if the tiers below ever change in some future
  // week. diamondsForWeeklyRank is only used for the infographic's own
  // display tiers, not this number.
  const wonDiamonds = diamondsAwarded > 0;

  return (
    <div
      className={'onboarding-backdrop' + (exiting ? ' onboarding-exiting' : '')}
      role="dialog"
      aria-modal="true"
      aria-label="Weekly money mode results"
      onClick={handleBackdropClick}
    >
      <div className={'panel onboarding-modal' + (exiting ? ' onboarding-exiting' : '')}>
        <div style={{ textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            Last week's money mode
          </p>
          <h2 className="gradient-title" style={{ fontSize: 28, marginBottom: 6 }}>
            🏆 Weekly Results
          </h2>
          <p className="mono" style={{ fontSize: 20, fontWeight: 700, color: medal ? '#ffd45e' : 'var(--neon-cyan)', marginBottom: 4 }}>
            {medal ? `${medal} #${rank}` : `#${rank}`}
          </p>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 8 }}>
            You banked <strong style={{ color: 'var(--text)' }}>{formatCents(scoreCents)}</strong> this week
          </p>
        </div>

        {madeTop3 && (
          <div
            className="mono"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              fontSize: 12,
              fontWeight: 700,
              color: '#ffd45e',
              border: '1px solid rgba(255,212,94,0.5)',
              background: 'rgba(255,212,94,0.1)',
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 16,
              textAlign: 'center',
            }}
          >
            🐔 Golden Goose achievement unlocked!
          </div>
        )}

        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 16, textAlign: 'center' }}>
          {wonDiamonds ? (
            <p>
              You earned{' '}
              <strong style={{ color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {diamondsAwarded}
                <img src="/diamond.png" alt="" width={13} height={13} style={{ display: 'inline-block' }} />
              </strong>{' '}
              for finishing in the top 10 — already in your shop balance.
            </p>
          ) : (
            <p>Outside the top 10 this week — climb into it next week to start earning diamonds.</p>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div
            className="mono"
            style={{ fontSize: 8, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, textAlign: 'center' }}
          >
            Last week's champions
          </div>
          <div style={{ display: 'flex', justifyContent: 'center' }}>
            <WeeklyPodium top3={top3} />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <div
            className="mono"
            style={{ fontSize: 8, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, textAlign: 'center' }}
          >
            Weekly prizes
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {PRIZE_TIERS.map((tier) => (
              <PrizeTierRow
                key={tier.label}
                label={tier.label}
                diamonds={tier.diamonds}
                highlighted={rank != null && rank >= tier.minRank && rank <= tier.maxRank}
              />
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <button className="btn-ghost onboarding-cta" onClick={beginClose}>
            Got it →
          </button>
          <button
            className="mono onboarding-link"
            onClick={() => {
              playNav();
              navigate('/leaderboard');
              beginClose();
            }}
          >
            View full leaderboard →
          </button>
        </div>
      </div>
    </div>
  );
}
