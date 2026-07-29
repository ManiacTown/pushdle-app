import { useState } from 'react';

// Small shield indicator shown below the username on both Profile.jsx (own
// profile) and PublicProfile.jsx (viewing someone else) whenever that
// account owns weekly bust insurance (see schema.sql's owns_insurance) —
// shared here so both places render it identically rather than two
// hand-copied versions drifting apart. Just the icon by default; hovering
// (desktop) or tapping (touch, no hover event to rely on there) reveals
// the "Insurance Upgrade" label rather than using a native `title`
// tooltip, which doesn't reliably show on tap at all — same "reveal on
// tap" reasoning Profile.jsx's own badge-hint pattern already uses
// elsewhere on this page. Click also toggles it (not just hover) so a
// touch tap that lands without a hover event still works, and a second
// tap can dismiss it again.
export default function InsuranceBadge({ owns }) {
  const [showLabel, setShowLabel] = useState(false);
  if (!owns) return null;
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
      <span style={{ fontSize: 14, lineHeight: 1 }}>🛡️</span>
      {showLabel && <span>Insurance Upgrade</span>}
    </div>
  );
}
