import { SUCCESS_CHANCE } from '../lib/game.js';

// Shared by About.jsx and OnboardingModal.jsx — a literal proportional bar
// (not just "90%" as text) so the risk is felt at a glance before reading
// a word. `caption`, if given, renders as a small line underneath. Every
// prop besides `caption` defaults to classic mode's own numbers/colors, so
// every existing caller's behavior is unchanged — About.jsx's Money Mode
// tab is the only caller that overrides them (green tint, MONEY_SUCCESS_
// CHANCE, "you keep it" instead of "you live", matching how that mode's
// own in-game odds text/palette differ from classic's).
export default function OddsBar({
  caption,
  chance = SUCCESS_CHANCE,
  liveLabel = 'you live',
  liveColor = 'var(--neon-cyan)',
  liveBg = 'rgba(34,229,255,0.18)',
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          height: 34,
          borderRadius: 8,
          overflow: 'hidden',
          border: '1px solid var(--line)',
        }}
      >
        <div
          className="mono"
          style={{
            flex: chance,
            background: liveBg,
            color: liveColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          {Math.round(chance * 100)}% {liveLabel}
        </div>
        <div
          className="mono"
          style={{
            flex: 1 - chance,
            background: 'rgba(255,59,92,0.18)',
            color: '#ff3b5c',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          {Math.round((1 - chance) * 100)}%
        </div>
      </div>
      {caption && (
        <p className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 8 }}>
          {caption}
        </p>
      )}
    </>
  );
}
