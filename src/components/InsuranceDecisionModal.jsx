import { formatCents } from '../lib/money.js';

// Shown the moment a bust roll lands on an insurance-eligible run (see
// resolve_money_push's 'bust_pending_insurance' status in schema.sql) —
// the bust itself already happened server-side; this is purely "what do
// you want to do about it," same reasoning as a cash-out confirmation,
// not a re-roll of anything. Reuses the exact .onboarding-backdrop/
// .onboarding-modal shell every other centered modal here does (see
// MoneyUpgradeChoiceModal.jsx), and is dismiss-proof the same way that
// one is — declining is still a real, explicit choice (and doesn't burn
// insurance; it just leaves it armed for a bigger bust later this week),
// not something to skip past without picking.
export default function InsuranceDecisionModal({ earningsCents, busy, onDecide }) {
  const insuredCents = Math.floor((earningsCents ?? 0) / 2);

  return (
    <div
      className="onboarding-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Use your weekly bust insurance?"
    >
      <div className="panel onboarding-modal" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🛡️</div>
        <h2 className="gradient-title" style={{ fontSize: 22, marginBottom: 8 }}>
          You Busted
        </h2>
        <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6, marginBottom: 20 }}>
          You have weekly bust insurance armed. Spend it now to bank half of this
          run, or save it — it stays armed for a bigger bust later this week.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            className="btn-ghost onboarding-cta"
            disabled={busy}
            onClick={() => onDecide(true)}
            style={{ color: 'var(--neon-green)', borderColor: 'rgba(57,255,143,0.5)' }}
          >
            {busy ? 'Working…' : `Use Insurance — Bank ${formatCents(insuredCents)}`}
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => onDecide(false)}>
            No, save it for next time
          </button>
        </div>
      </div>
    </div>
  );
}
