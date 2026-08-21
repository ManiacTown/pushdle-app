import { useState } from 'react';

// Matches OnboardingModal/MoneyModeUnlockModal/PityIntroModal/
// MoneyWeeklyResultsModal's own exit-animation duration — reuses the exact
// same .onboarding-backdrop/.onboarding-modal/.onboarding-exiting CSS (see
// global.css), same "centered panel, glides in, glides back out" shape as
// all four. Unlike those, though, this one has no backdrop-click-to-dismiss
// and no free "skip" — see the component's own comment below for why.
const EXIT_DURATION_MS = 500;

const UPGRADES = [
  {
    id: 'insurance',
    icon: '🛡️',
    label: 'Weekly Bust Insurance',
    description: 'Once a week, a bust banks half your run instead of losing it all.',
    color: '#39ff8f',
  },
  {
    id: 'streak_bonus',
    icon: '💲',
    label: 'Streak Bonus',
    description: 'Every combo-bar fill pays an extra $1, cash or diamond either way.',
    color: '#ffd45e',
  },
  {
    id: 'daredevil',
    icon: '😈',
    label: 'Daredevil',
    description: 'Shorter guarantee, worse odds after it — but double money.',
    color: '#ff2d6d',
  },
];

function UpgradeOption({ id, icon, label, description, color, selected, onSelect }) {
  return (
    <button
      className="mono"
      onClick={() => onSelect(id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        textAlign: 'left',
        padding: '10px 12px',
        borderRadius: 10,
        background: selected ? `${color}1a` : '#06060a',
        border: `1px solid ${selected ? color : 'var(--line)'}`,
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 20, flexShrink: 0 }}>{icon}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: selected ? color : 'var(--text)', marginBottom: 2 }}>
          {label}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-dim)', lineHeight: 1.5 }}>{description}</div>
      </span>
      {selected && (
        <span style={{ fontSize: 14, color, flexShrink: 0 }}>✓</span>
      )}
    </button>
  );
}

// Pops once per money week — the first time an account with at least one
// owned upgrade actually enters Money Mode after money_upgrade_choice_seen
// resets false (see Home.jsx's trigger effect and money_upgrade_choice_seen's
// own comment in schema.sql). Deliberately has no backdrop-click/skip the
// way every other onboarding-style modal here does: "choose one, including
// None" IS the action this modal exists for, not something to dismiss past
// — Confirm always submits whatever's currently selected (defaulting to
// current active_money_upgrade, or None if there isn't one), so declining
// to change anything is still a real, explicit choice that locks in the
// same way switching would.
export default function MoneyUpgradeChoiceModal({ ownsInsurance, ownsStreakBonus, ownsDaredevil, currentActive, onConfirm }) {
  const [exiting, setExiting] = useState(false);
  const [selected, setSelected] = useState(currentActive ?? null);
  const [busy, setBusy] = useState(false);

  const owned = UPGRADES.filter(
    (u) => (u.id === 'insurance' && ownsInsurance) || (u.id === 'streak_bonus' && ownsStreakBonus) || (u.id === 'daredevil' && ownsDaredevil)
  );

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    await onConfirm(selected);
    setExiting(true);
    setTimeout(() => setBusy(false), EXIT_DURATION_MS);
  }

  return (
    <div
      className={'onboarding-backdrop' + (exiting ? ' onboarding-exiting' : '')}
      role="dialog"
      aria-modal="true"
      aria-label="Choose this week's money mode upgrade"
    >
      <div className={'panel onboarding-modal' + (exiting ? ' onboarding-exiting' : '')}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            New money week
          </p>
          <h2 className="gradient-title" style={{ fontSize: 24, marginBottom: 8 }}>
            Choose Your Upgrade
          </h2>
          <p className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.6 }}>
            Only one of your owned upgrades can be active at a time. Pick one for this money week —
            you can't change it again until the next weekly reset.
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
          {owned.map((u) => (
            <UpgradeOption key={u.id} {...u} selected={selected === u.id} onSelect={setSelected} />
          ))}
          <UpgradeOption
            id={null}
            icon="🚫"
            label="None"
            description="Play this week with no upgrade active."
            color="var(--text-dim)"
            selected={selected == null}
            onSelect={setSelected}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button className="btn-ghost onboarding-cta" disabled={busy} onClick={handleConfirm}>
            {busy ? 'Confirming…' : 'Confirm →'}
          </button>
        </div>
      </div>
    </div>
  );
}
