import { useState } from 'react';

// Small indicator shown below the username on both Profile.jsx (own
// profile) and PublicProfile.jsx (viewing someone else) for whichever
// money-mode upgrade (if any) this account currently has ACTIVE — see
// active_money_upgrade's own comment in schema.sql. Replaces the old
// InsuranceBadge, which showed based on ownership alone; now that
// Insurance/Streak Bonus/Daredevil are mutually exclusive (only one active
// per week, see money_upgrade_choice_seen), showing more than one at a
// time here would misrepresent that — this only ever renders the ONE
// that's actually running, same "one tag, not a collection" shape as
// MoneyMode.jsx's own live pill. Just the icon by default; hovering
// (desktop) or tapping (touch, no hover event to rely on there) reveals
// the label rather than using a native `title` tooltip, which doesn't
// reliably show on tap at all — same "reveal on tap" reasoning Profile.jsx's
// own badge-hint pattern already uses elsewhere on that page.
const UPGRADE_INFO = {
  insurance: { icon: <img src="/shield.png" alt="" width={14} height={14} style={{ display: 'block' }} />, label: 'Weekly Bust Insurance' },
  streak_bonus: { icon: <span style={{ fontSize: 13 }}>💲</span>, label: 'Streak Bonus' },
  daredevil: { icon: <span style={{ fontSize: 13 }}>😈</span>, label: 'Daredevil' },
};

export default function ActiveMoneyUpgradeBadge({ activeMoneyUpgrade }) {
  const [showLabel, setShowLabel] = useState(false);
  const info = UPGRADE_INFO[activeMoneyUpgrade];
  if (!info) return null;
  return (
    <div
      className="mono"
      onMouseEnter={() => setShowLabel(true)}
      onMouseLeave={() => setShowLabel(false)}
      onClick={() => setShowLabel((s) => !s)}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        marginTop: 4,
        cursor: 'pointer',
        fontSize: 10,
        color: 'var(--text-dim)',
      }}
    >
      {info.icon}
      {showLabel && <span>{info.label}</span>}
    </div>
  );
}
