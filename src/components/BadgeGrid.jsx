import { BADGES, RARITY_META, BADGE_EMOJI, badgeConditions } from '../lib/game.js';
import { formatCents } from '../lib/money.js';
import { spotlightMove } from '../lib/spotlight.js';

// Shared by Profile.jsx (your own badges — clickable, sets/clears flair)
// and PublicProfile.jsx (someone else's — read-only display). `interactive`
// is what switches between the two: false renders plain static cards (no
// role/tabIndex/onClick at all, same as before), true adds full keyboard
// operability (role="button", tabIndex, Enter/Space activation, a real
// :focus-visible ring — see .badge-card:focus-visible in global.css) on
// top of the existing click/hover behavior, which previously had no
// keyboard path whatsoever.
//
// `stats` (camelCase, keyed the same way earnedBadges() expects — see
// either caller's own statsForBadges) drives the progress hint on locked
// numeric badges: "342/500" for a plain count, "$12/$25" for a cents field
// (detected by the field name's own "Cents" suffix, not a hardcoded list —
// same mechanical-derivation preference maxStatsForAllBadges already
// uses). Boolean badges (`min: true`) have no meaningful progress to show,
// same as already-earned ones.
export default function BadgeGrid({
  categories,
  earnedIds,
  currentEmoji,
  stats,
  interactive = false,
  onBadgeClick,
  expandedBadgeId,
  onToggleExpand,
  gridRef,
}) {
  return (
    // alignItems:'start' — grid items default to stretch, which forces
    // every panel in a row to match the tallest one (Streak's 7 badges vs
    // Bust's 2, sharing a row, both rendering at Streak's height). This
    // sizes each panel to just its own content instead.
    //
    // auto-fit/minmax instead of a flat '1fr 1fr' — two fixed columns left
    // labels touching edge-to-edge with zero breathing room on a narrow
    // phone (same bug About.jsx's own badge-category grid had, and fixed,
    // separately — this grid never got the same fix, which is exactly why
    // it regressed back). 200px, not About.jsx's 130px — these panels hold
    // a full stacked badge list, not a single-line count tile, so they
    // need more room before a second column is worth reflowing into.
    <div
      ref={gridRef}
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, alignItems: 'start' }}
    >
      {categories.map((cat) => (
        <div key={cat.id} className="panel spotlight" onMouseMove={spotlightMove}>
          {/* Secret's own label is a description, not a proper category
              name the way every other tab's is (see SECRET_CATEGORY in
              game.js) — plain/dim text instead of the bold heading look
              those get, so it reads as quieter flavor text, not a title. */}
          {cat.id === 'secret' ? (
            <div className="mono" style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-dim)', marginBottom: 12 }}>
              {cat.label}
            </div>
          ) : (
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>{cat.label}</h3>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {BADGES.filter((b) => b.category === cat.id).map((b) => {
              const has = earnedIds.has(b.id);
              const rarity = RARITY_META[b.rarity];
              const emoji = BADGE_EMOJI[b.id];
              const clickable = interactive && has && !!emoji;
              const selected = clickable && currentEmoji === emoji;
              const expanded = interactive && !clickable && expandedBadgeId === b.id;

              // Multi-field badges (see badgeConditions/game.js) have no
              // single b.field/b.min to show a linear "X/Y" progress bar
              // for in the first place — a "2/3 conditions met" bar would
              // need its own bespoke logic per badge, so these just skip
              // progress entirely, same treatment boolean badges already get.
              const isMultiField = badgeConditions(b).length > 1;
              // "Secret" badges (see SECRET_CATEGORY/game.js) hide their
              // hint as "???" until earned — showing a numeric progress bar
              // for one would leak exactly the info the mystery is hiding,
              // so those are suppressed here too, not just the hint text.
              const isSecret = b.category === 'secret';
              const isCents = !isMultiField && b.field.endsWith('Cents');
              const current = !isMultiField ? stats?.[b.field] ?? 0 : 0;
              const showProgress = !has && !isMultiField && !isSecret && b.min !== true;
              const progressText = showProgress
                ? isCents
                  ? `${formatCents(current)}/${formatCents(b.min)}`
                  : `${current}/${b.min}`
                : null;
              // b.min is always > 0 for every real numeric badge (the
              // smallest thresholds start at 1), so this can't divide by
              // zero — clamped to 100 regardless, defensively.
              const progressPct = showProgress ? Math.min(100, (current / b.min) * 100) : 0;
              const hintText = !has && isSecret ? '???' : b.hint;

              const activate = clickable ? () => onBadgeClick(b) : () => onToggleExpand(b.id);

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
                  onClick={interactive ? activate : undefined}
                  role={interactive ? 'button' : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  onKeyDown={
                    interactive
                      ? (e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return;
                          e.preventDefault(); // stop Space from also scrolling the page
                          activate();
                        }
                      : undefined
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
                    // Every card is tappable in some sense when interactive
                    // (set/clear flair, or just reveal its hint) — pointer
                    // throughout; read-only cards (PublicProfile) stay
                    // default, nothing happens on click there.
                    cursor: interactive ? 'pointer' : 'default',
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
                  {/* Always visible (unlike .badge-card-hint below, which
                      stays collapsed until hover/expand) — the whole point
                      is to make locked-badge progress visible at a glance,
                      not buried behind another interaction. title gives a
                      plain-text fallback (tooltip) for anything that reads
                      the fill width but not the overlaid label. */}
                  {progressText && (
                    <div className="badge-progress-track" title={progressText}>
                      <div className="badge-progress-fill" style={{ width: `${progressPct}%` }} />
                      <div className="mono badge-progress-label">{progressText}</div>
                    </div>
                  )}
                  <div className="mono badge-card-hint" style={{ fontSize: 9 }}>
                    {hintText}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
