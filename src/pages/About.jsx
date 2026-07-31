import { spotlightMove } from '../lib/spotlight.js';
import OddsBar from '../components/OddsBar.jsx';
import {
  SUCCESS_CHANCE,
  FIRST_PRESS_SUCCESS_CHANCE,
  rarityForStreak,
  formatRarity,
  RARITY_META,
  BADGE_CATEGORIES,
  BADGES,
} from '../lib/game.js';

// A few representative milestones rather than every possible streak — just
// enough to make "the odds get brutal fast" concrete without turning this
// into a spreadsheet. Pulled from the real rarityForStreak formula, not
// hand-typed, so this can never drift out of sync with actual gameplay.
const EXAMPLE_STREAKS = [5, 10, 20, 30, 50, 100];

function SectionHeader({ icon, title }) {
  return (
    <h3 style={{ fontSize: 16, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 20 }}>{icon}</span> {title}
    </h3>
  );
}

export default function About() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ textAlign: 'center' }}>
        <h2 className="gradient-title" style={{ fontSize: 26, marginBottom: 8 }}>About Pushdle</h2>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 18 }}>
          A daily push-your-luck game. Tap the button, keep your streak alive, don't get greedy.
        </p>

        {/* Same OddsBar component the first-visit onboarding modal uses
            (src/components/OnboardingModal.jsx) — a literal proportional
            bar instead of just text, so the risk is felt at a glance
            before reading a word. */}
        <OddsBar caption="Every push after your first rolls these odds — survive one more, or bust and start over tomorrow." />
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="🎯" title="How to play" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          <p style={{ marginBottom: 12 }}>
            Tap <strong style={{ color: 'var(--text)' }}>Push</strong>. Each press has a{' '}
            {Math.round(SUCCESS_CHANCE * 100)}% chance to keep your streak alive — until it
            doesn't. Your very first push of the day is guaranteed, so nobody busts immediately.
          </p>
          <p style={{ marginBottom: 12 }}>
            Your <strong style={{ color: 'var(--text)' }}>score</strong> is how many presses you
            survive in a row before you bust. The longer you go, the more you have to lose.
          </p>
          <p>
            <strong style={{ color: 'var(--text)' }}>One run per day.</strong> Once you bust (or
            choose to walk away), that's it until the next day resets.
          </p>
        </div>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="🏆" title="Leaderboard" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          <p style={{ marginBottom: 12 }}>
            Every logged-in run's streak is ranked against everyone else's for that day — top 3
            get a medal, and your own row is highlighted so you can always find yourself. It
            resets daily along with everyone's runs.
          </p>
          <p>
            Guest runs (no account) are tracked locally on your device only and never appear on
            the leaderboard — create an account to have your runs count.
          </p>
        </div>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="🏅" title="Badges & flair" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 16 }}>
          <p>
            Badges track your progress across four categories — clear a milestone once and it's
            yours for good:
          </p>
        </div>
        {/* auto-fit/minmax instead of a flat '1fr 1fr' — on a narrow enough
            phone, two fixed columns leaves the label and count touching
            edge-to-edge with zero breathing room (space-between has no
            slack left to distribute). This reflows to a single column
            once there isn't enough width for two, rather than squeezing. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 18 }}>
          {BADGE_CATEGORIES.map((cat) => {
            const count = BADGES.filter((b) => b.category === cat.id).length;
            return (
              <div
                key={cat.id}
                style={{
                  background: '#06060a',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{cat.label}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{count} badges</span>
              </div>
            );
          })}
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 12 }}>
          Every badge has a rarity tier, shown as a colored pill right on the badge:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {Object.entries(RARITY_META).map(([key, meta]) => (
            <span
              key={key}
              className="badge-rarity"
              style={{ '--rarity-color': meta.color, fontSize: 10, padding: '4px 10px' }}
            >
              {meta.label}
            </span>
          ))}
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          Earn a <span style={{ color: RARITY_META.rare.color }}>rare</span>-or-better badge and
          you unlock its emoji as leaderboard flair — set it from your Profile page and it'll show
          up next to your name for everyone else to see.
        </div>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ textAlign: 'center' }}>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
          Stay tuned for more updates!
        </p>
      </div>
    </div>
  );
}
