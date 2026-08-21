import { useState } from 'react';

// Small trophy indicator shown below the username on both Profile.jsx (own
// profile) and PublicProfile.jsx (viewing someone else) whenever that
// account has finished #1 in the weekly Money Mode leaderboard at least
// once (see schema.sql's money_weekly_wins, incremented by
// finalize_money_week) — same shared-component/hover-or-tap-tooltip
// pattern as ActiveMoneyUpgradeBadge.jsx, sitting alongside it.
export default function MoneyWinsBadge({ wins }) {
  const [showLabel, setShowLabel] = useState(false);
  if (!wins) return null;
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
      <span>🥇 x{wins}</span>
      {showLabel && <span>Money wins</span>}
    </div>
  );
}
