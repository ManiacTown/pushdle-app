import { spotlightMove } from '../lib/spotlight.js';

// Shared by Profile.jsx (your own stats) and PublicProfile.jsx (someone
// else's, read-only) — identical panel either way, just fed a different
// `tiles` array (streak vs money, picked by the caller's own achievement
// tab). `loading` is Profile.jsx-only (guest/local stats never have a
// loading window; PublicProfile.jsx has its own page-level loading state
// instead of a partial one here).
export default function StatTilesPanel({ tiles, loading }) {
  return (
    <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginBottom: 20 }}>
      <h3 style={{ fontSize: 15, marginBottom: 14 }}>Stats</h3>
      {loading && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
          Loading…
        </div>
      )}
      {/* auto-fit, not a fixed column count — the money tab has 5 tiles,
          the streak tab has 4, same flexible sizing either page needs. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 10 }}>
        {tiles.map((s) => (
          <div
            key={s.label}
            style={{
              textAlign: 'center',
              background: '#06060a',
              border: '1px solid var(--line)',
              borderRadius: 10,
              padding: '10px 6px',
            }}
          >
            <div className="mono" style={{ fontWeight: 700, fontSize: 20, color: 'var(--neon-green)' }}>
              {s.value}
            </div>
            <div className="mono" style={{ fontSize: 8, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 4 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
