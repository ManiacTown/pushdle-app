import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import * as storage from '../lib/storage.js';
import { BADGES, BADGE_CATEGORIES, BADGE_EMOJI, RARITY_META, earnedBadges } from '../lib/game.js';
import { spotlightMove } from '../lib/spotlight.js';
import { playBadgeSelect } from '../lib/sound.js';

// Username's own natural (unshrunk) size and the floor it can shrink to
// before the streak badge and Log out button start crowding it — see the
// measurement effect below.
const USERNAME_BASE_FONT_SIZE = 22;
const USERNAME_MIN_FONT_SIZE = 12;

export default function Profile() {
  const { user, logout, selectedEmoji, updateSelectedEmoji, stats: authStats } = useAuth();
  const location = useLocation();
  const [guestBestStreak, setGuestBestStreak] = useState(0);
  const [guestStats, setGuestStats] = useState({ totalPushes: 0, dayStreak: 0, bustedAtZero: false, bustedAtOne: false });
  const [guestEmoji, setGuestEmoji] = useState(null);
  const [flairError, setFlairError] = useState('');
  // Non-clickable badges (not earned, or earned with no flair emoji) reveal
  // their hint text on hover — which doesn't exist on a touch device, so a
  // phone had no way to see why a badge isn't selectable at all. Tapping
  // one now toggles it into this instead, mimicking the hover-expanded
  // look via CSS rather than a real :hover. Only one at a time — tapping a
  // different card (or the same one again) replaces/clears it, so tapping
  // around the grid doesn't leave a trail of stuck-open hints.
  const [expandedBadgeId, setExpandedBadgeId] = useState(null);
  // 'click'/'tap' in the instructional copy below — (pointer: coarse) is
  // the standard way to ask "is the primary input a touch surface," more
  // reliable than 'ontouchstart' in window (which also fires true on
  // touch-capable laptops that are really being driven with a mouse).
  // Checked once at mount rather than kept reactive to input changes
  // mid-session (a real hybrid-device edge case, but not worth the extra
  // complexity here).
  const [isTouch] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches);
  const [usernameFontSize, setUsernameFontSize] = useState(USERNAME_BASE_FONT_SIZE);
  const headerRowRef = useRef(null);
  const nameRef = useRef(null);
  const emojiRef = useRef(null);
  const logoutBtnRef = useRef(null);
  const badgeGridRef = useRef(null);

  // Arriving via a badge-toast click (see Home.jsx's BadgeToastCard) wants
  // a specific sequence: land at the top instantly (not smooth — App.jsx's
  // generic scroll-to-top skips itself for exactly this case so it doesn't
  // fight this one), then glide down to the actual badge grid. rAF instead
  // of running the scrollIntoView immediately — the grid's real position
  // isn't reliable until the browser has laid out this render's DOM.
  useEffect(() => {
    if (!location.state?.scrollToBadges) return;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      badgeGridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [location.state]);

  useEffect(() => {
    if (!user) {
      storage.getBestStreak().then(setGuestBestStreak);
      storage.getStats().then(setGuestStats);
      storage.getSelectedEmoji().then(setGuestEmoji);
    }
  }, [user]);

  // AuthContext merges/holds the server-authoritative copy for logged-in
  // players (see its login-time merge and Home.jsx, which keeps it fresh
  // after every push/admin action) — stats is null only for the brief
  // window right after login while that merge is still in flight.
  const bestStreak = user ? authStats?.bestStreak ?? 0 : guestBestStreak;
  const stats = user ? authStats ?? { totalPushes: 0, dayStreak: 0, bustedAtZero: false, bustedAtOne: false } : guestStats;
  const statsLoading = user && !authStats;

  const earned = earnedBadges({ bestStreak, ...stats });
  const earnedIds = new Set(earned.map((b) => b.id));
  // Guests never appear on the real leaderboard (see lib/storage.js's note),
  // so their flair is purely a local preview — logged-in players' flair is
  // the one that actually shows up for other people.
  const currentEmoji = user ? selectedEmoji : guestEmoji;

  // Shrinks the username's font-size (never the Log out button, which has
  // flex-shrink:0 below) if the header row is too narrow to fit both at
  // once. Drives the size through React state (applied via the h2's style
  // prop below) rather than writing name.style.fontSize directly — a
  // purely imperative write fights the JSX's own style prop on every
  // unrelated re-render (anything that re-renders Profile for a reason
  // outside this effect's deps re-applies the JSX's font-size and silently
  // undoes the shrink). The ref is only used as a transient probe to read
  // the natural (unshrunk) width, then immediately restored, so there's
  // exactly one owner of the persisted value: state.
  useLayoutEffect(() => {
    const row = headerRowRef.current;
    const name = nameRef.current;
    if (!row || !name) return;

    const measure = () => {
      const priorSize = name.style.fontSize;
      name.style.fontSize = `${USERNAME_BASE_FONT_SIZE}px`;
      const rowWidth = row.getBoundingClientRect().width;
      const btnWidth = logoutBtnRef.current ? logoutBtnRef.current.getBoundingClientRect().width : 0;
      // The flair emoji (see currentEmoji below) sits in the same inner
      // flex wrapper as the name, sharing its own 10px gap — without
      // subtracting this too, the calculation overestimates how much room
      // the NAME actually has whenever a flair is selected, since it only
      // ever accounted for the outer row's gap/button before flair could
      // show here at all.
      const emojiWidth = emojiRef.current ? emojiRef.current.getBoundingClientRect().width + 10 : 0;
      const outerGap = 12; // matches the row's own gap
      // text-overflow:ellipsis is a threshold effect, not a gradual one —
      // even a fraction of a px of shortfall (sub-pixel rounding between
      // this measurement and the browser's actual glyph layout) is enough
      // to truncate a couple of characters, not just clip a sliver. A
      // small fixed safety margin absorbs that rounding instead of
      // computing right up to the exact edge.
      const safetyMargin = 4;
      const nameNaturalWidth = name.scrollWidth;
      name.style.fontSize = priorSize; // just a probe — state (below) owns the real value

      const availableForName = rowWidth - btnWidth - emojiWidth - outerGap - safetyMargin;
      let next = USERNAME_BASE_FONT_SIZE;
      if (availableForName > 0 && availableForName < nameNaturalWidth) {
        const scale = Math.max(availableForName / nameNaturalWidth, USERNAME_MIN_FONT_SIZE / USERNAME_BASE_FONT_SIZE);
        next = USERNAME_BASE_FONT_SIZE * scale;
      }
      setUsernameFontSize(next);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(row);
    return () => ro.disconnect();
    // currentEmoji: re-measure when flair is set/cleared — its own width
    // needs to be re-subtracted from the name's available space either way.
  }, [user, currentEmoji]);

  // Shared by both ways to change flair — the quick-pick row above the
  // badge grid (including its "no flair" option) and clicking a badge card
  // directly in the grid below. Both just need "make this the new value,"
  // so there's one place that actually talks to the server/local storage.
  async function setFlair(next) {
    playBadgeSelect();
    setFlairError('');
    if (user) {
      try {
        await updateSelectedEmoji(next);
      } catch (err) {
        setFlairError(err.message);
      }
    } else {
      await storage.setSelectedEmoji(next);
      setGuestEmoji(next);
    }
  }

  async function handleBadgeClick(badge) {
    const emoji = BADGE_EMOJI[badge.id];
    if (!emoji || !earnedIds.has(badge.id)) return;
    await setFlair(currentEmoji === emoji ? null : emoji);
  }

  const statTiles = [
    { label: 'Best Streak', value: bestStreak },
    { label: 'Total Pushes', value: stats.totalPushes },
    { label: 'Day Streak', value: stats.dayStreak },
  ];

  // Every emoji an earned badge could show as flair, deduped — a quick-pick
  // row of all of them (see the flair panel below) beats making someone
  // hunt through the categorized badge grid further down just to change
  // which one they're using, or to find the one they currently have
  // selected again in order to clear it.
  const unlockedFlairs = [...new Set(BADGES.filter((b) => earnedIds.has(b.id) && BADGE_EMOJI[b.id]).map((b) => BADGE_EMOJI[b.id]))];

  return (
    <div>
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginBottom: 20 }}>
        <div ref={headerRowRef} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {/* No streak badge here anymore — it's redundant with the nav
                bar (always visible there regardless of page), and removing
                it buys back exactly the width that was causing a max-length
                username to hit the shrink floor and still need to truncate
                on the narrowest phones. */}
            <h2
              ref={nameRef}
              className="gradient-title"
              style={{ fontSize: usernameFontSize, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              {user ? user.user_metadata?.username || user.email : 'Guest'}
            </h2>
            {/* Same treatment PublicProfile.jsx gives everyone else's name —
                your own header showed the username alone with no visual
                confirmation of which flair (if any) is actually selected,
                the one place on the whole site that couldn't show it. */}
            {currentEmoji && <span ref={emojiRef} style={{ fontSize: 20, flexShrink: 0 }}>{currentEmoji}</span>}
          </div>
          {user && (
            <button
              ref={logoutBtnRef}
              className="btn-ghost"
              onClick={logout}
              // flex-shrink:0 + nowrap is the actual guarantee against
              // wrapping to two lines — the responsive padding/font-size
              // just keeps its overall footprint proportionate to the
              // screen instead of staying full desktop-size on a phone.
              style={{
                flexShrink: 0,
                whiteSpace: 'nowrap',
                fontSize: 'clamp(11px, 2.5vw, 13px)',
                padding: 'clamp(6px, 1.5vw, 8px) clamp(10px, 3vw, 14px)',
              }}
            >
              Log out
            </button>
          )}
        </div>
        {!user && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
            Not logged in — stats and badges below are still tracked locally on this device.
          </div>
        )}
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 14 }}>Stats</h3>
        {statsLoading && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 10 }}>
            Loading…
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {statTiles.map((s) => (
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

      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 14 }}>Flair</h3>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {unlockedFlairs.length > 0
            ? 'Pick which badge shows next to your name on the leaderboard, or choose no flair:'
            : `Earn a rare-or-better badge to unlock a flair emoji — ${isTouch ? 'tap' : 'click'} it to show it next to your name on the leaderboard.`}
        </div>
        {/* Quick-pick row of every unlocked flair, plus an explicit "no
            flair" option (🚫) — the badge grid below still supports
            click-to-set/clear too (same setFlair underneath), this is just
            a faster path that doesn't need scrolling to find the specific
            badge card, and is the only place a straightforward "I want
            none of these" choice existed before now. */}
        {unlockedFlairs.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <button
              className="btn-ghost"
              onClick={() => setFlair(null)}
              title="No flair"
              style={{
                fontSize: 15,
                lineHeight: 1,
                padding: '8px 12px',
                border: !currentEmoji ? '1px solid rgba(255,212,94,0.7)' : undefined,
                background: !currentEmoji ? 'rgba(255,212,94,0.12)' : undefined,
                boxShadow: !currentEmoji ? '0 0 10px rgba(255,212,94,0.25)' : undefined,
              }}
            >
              🚫
            </button>
            {unlockedFlairs.map((emoji) => (
              <button
                key={emoji}
                className="btn-ghost"
                onClick={() => setFlair(emoji)}
                title={currentEmoji === emoji ? 'Currently selected' : 'Set as your leaderboard flair'}
                style={{
                  fontSize: 15,
                  lineHeight: 1,
                  padding: '8px 12px',
                  border: currentEmoji === emoji ? '1px solid rgba(255,212,94,0.7)' : undefined,
                  background: currentEmoji === emoji ? 'rgba(255,212,94,0.12)' : undefined,
                  boxShadow: currentEmoji === emoji ? '0 0 10px rgba(255,212,94,0.25)' : undefined,
                }}
              >
                {emoji}
              </button>
            ))}
          </div>
        )}
        {flairError && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--neon-red)', marginTop: 8 }}>
            {flairError}
          </div>
        )}
      </div>

      {/* alignItems:'start' — grid items default to stretch, which forces
          every panel in a row to match the tallest one (Streak's 7 badges
          vs Bust's 2, sharing a row, both rendering at Streak's height).
          This sizes each panel to just its own content instead. */}
      <div ref={badgeGridRef} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {BADGE_CATEGORIES.map((cat) => (
          <div key={cat.id} className="panel spotlight" onMouseMove={spotlightMove}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>{cat.label}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {BADGES.filter((b) => b.category === cat.id).map((b) => {
                const has = earnedIds.has(b.id);
                const rarity = RARITY_META[b.rarity];
                const emoji = BADGE_EMOJI[b.id];
                const clickable = has && !!emoji;
                const selected = clickable && currentEmoji === emoji;
                const expanded = !clickable && expandedBadgeId === b.id;
                return (
                  <div
                    key={b.id}
                    className={'badge-card' + (expanded ? ' badge-card--expanded' : '')}
                    // Clickable badges set/clear flair as before. Everything
                    // else (not earned, or earned with no emoji to set) has
                    // no real action to take, but still needs SOME tap
                    // response — on a touch device there's no hover to ever
                    // reveal .badge-card-hint otherwise, so tapping toggles
                    // it into view manually instead.
                    onClick={
                      clickable
                        ? () => handleBadgeClick(b)
                        : () => setExpandedBadgeId((prev) => (prev === b.id ? null : b.id))
                    }
                    title={clickable ? (selected ? 'Click to clear this flair' : 'Click to set as your leaderboard flair') : undefined}
                    style={{
                      // A soft outline shows on every card, earned or not, so
                      // there's always a clear frame for the rarity chip to
                      // sit in — earned badges get a stronger violet accent
                      // layered on top instead of being the only bordered ones.
                      // The currently-selected flair badge gets a gold
                      // accent on top of that, same treatment as newBestToday
                      // elsewhere in the app.
                      border: selected
                        ? '1px solid rgba(255,212,94,0.7)'
                        : has
                        ? '1px solid rgba(139,92,246,0.6)'
                        : '1px solid rgba(255,255,255,0.16)',
                      borderRadius: 10,
                      // Was 18px/10px (top/bottom) — that gap was sized for
                      // clearance under the corner rarity pill, but left the
                      // name sitting visibly below the card's true vertical
                      // center whenever the hint text is collapsed (not
                      // hovering, the common state). Closer to symmetric now
                      // — still enough clearance for the pill above, but the
                      // name reads as centered at rest instead of low.
                      padding: '14px 8px 14px',
                      textAlign: 'center',
                      background: selected ? 'rgba(255,212,94,0.1)' : has ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.02)',
                      boxShadow: selected ? '0 0 14px rgba(255,212,94,0.3)' : has ? '0 0 14px rgba(139,92,246,0.22)' : 'none',
                      // Every card is now tappable in some sense (set/clear
                      // flair, or just reveal its hint) — pointer throughout.
                      cursor: 'pointer',
                      '--rarity-color': rarity.color,
                    }}
                  >
                    <div className="badge-rarity-corner">
                      <div className="badge-rarity">{rarity.label}</div>
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 700, opacity: has ? 1 : 0.45 }}>
                      {b.label}
                      {emoji && <span style={{ marginLeft: 6, opacity: has ? 1 : 0.35 }}>{emoji}</span>}
                    </div>
                    <div className="mono badge-card-hint" style={{ fontSize: 9 }}>
                      {b.hint}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
