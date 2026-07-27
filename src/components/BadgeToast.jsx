import { useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RARITY_META } from '../lib/game.js';
import { playNav } from '../lib/sound.js';

// Shared by both game modes (see Home.jsx, which owns the underlying
// newBadges/showBadges/leaving state for classic AND money-mode badges —
// one toast system, since a badge is a badge regardless of which mode
// earned it). Portaled straight to <body> by the caller's own
// createPortal — see Home.jsx's comment on why (escaping
// .page-transition's transformed subtree).
export default function BadgeToastStack({ show, newBadges, instant, leaving, topStyle }) {
  if (!show || !newBadges || newBadges.length === 0) return null;
  return (
    <div className={'badge-toast-stack' + (leaving ? ' leaving' : '')} style={topStyle}>
      <div className={'badge-toast-banner' + (instant ? ' instant' : '')}>
        {newBadges.length === 1 ? 'New Badge' : 'New Badges'}
      </div>
      {newBadges.map((b, i) => (
        <BadgeToastCard key={b.id} badge={b} index={i} instant={instant} leaving={leaving} />
      ))}
    </div>
  );
}

// Icon sized to match its own card's text column (pill row + "Badge
// earned" row) instead of a static font-size — a fixed size would either
// undershoot on cards where the pill wraps to its own line (RARE/EPIC
// etc. can push the column taller) or overshoot on plain one-line cards.
// Measured per-card (not a shared CSS var, unlike --nav-bar-clearance/
// --streak-panel-top) because multiple badges can be earned in the same
// bust and each card's column can end up a different height.
function BadgeToastCard({ badge, index, instant, leaving }) {
  const columnRef = useRef(null);
  const [iconSize, setIconSize] = useState(18);
  const navigate = useNavigate();

  useLayoutEffect(() => {
    const el = columnRef.current;
    if (!el) return;
    const measure = () => setIconSize(el.getBoundingClientRect().height);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      className={'badge-toast' + (instant ? ' instant' : '')}
      onClick={() => {
        playNav();
        navigate('/profile', { state: { scrollToBadges: true } });
      }}
      title="View your badges"
      style={{
        // Zeroed while leaving so every card exits together instead of
        // replaying its entrance stagger in reverse (see global.css's
        // .badge-toast-stack.leaving comment).
        animationDelay: instant || leaving ? '0s' : `${index * 0.15}s`,
        '--rarity-color': RARITY_META[badge.rarity].color,
        cursor: 'pointer',
      }}
    >
      <div className="badge-toast-icon" style={{ fontSize: iconSize, lineHeight: `${iconSize}px` }}>
        🏅
      </div>
      <div className="badge-toast-col" ref={columnRef}>
        <div className="badge-toast-pill-row">
          <span className="badge-rarity">{RARITY_META[badge.rarity].label}</span>
        </div>
        <div className="badge-toast-sub">Badge earned</div>
      </div>
    </div>
  );
}
