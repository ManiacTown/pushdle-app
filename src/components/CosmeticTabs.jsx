// Generic tab row shared by MoneyShop.jsx (buy) and Profile.jsx's
// Cosmetics section (equip) — both split their content into the same
// kind of category tabs, just with a different tab list (the shop adds
// "Upgrades", Profile prepends "Flair" — see src/lib/cosmetics.js's
// COSMETIC_CATEGORIES for the three tabs they DO share). One shared
// component so both surfaces look/behave identically rather than two
// hand-rolled tab rows drifting apart. `flexWrap` since four-plus tabs at
// the shop's own panel width (460px) don't reliably fit one line, unlike
// AchievementTabToggle's fixed two tabs.
export default function CosmeticTabs({ tabs, active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className="btn-ghost"
          style={{
            fontSize: 11,
            padding: '5px 10px',
            ...(active === tab.id ? { borderColor: 'var(--neon-cyan)', color: 'var(--neon-cyan)' } : undefined),
          }}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
