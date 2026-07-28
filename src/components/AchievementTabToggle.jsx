// Shared by Profile.jsx and PublicProfile.jsx — both render this
// identically (cyan for Normal Mode, gold for Money Mode, same as every
// other money-themed accent in the app) above their own badge grid.
// TEMP admin-gated at each CALL SITE, not in here — that's a page-level
// business rule (money mode isn't ready for real players yet), not a
// rendering concern of the toggle itself.
export default function AchievementTabToggle({ tab, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
      <button
        className="btn-ghost"
        style={tab === 'streak' ? { borderColor: 'var(--neon-cyan)', color: 'var(--neon-cyan)' } : undefined}
        onClick={() => onChange('streak')}
      >
        Normal Mode
      </button>
      <button
        className="btn-ghost"
        style={tab === 'money' ? { borderColor: '#ffd45e', color: '#ffd45e' } : undefined}
        onClick={() => onChange('money')}
      >
        💰 Money Mode
      </button>
    </div>
  );
}
