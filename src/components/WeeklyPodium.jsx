import { useNavigate } from 'react-router-dom';
import { formatCents } from '../lib/money.js';
import { playNav } from '../lib/sound.js';

// Gold / silver / bronze accents for the top 3 ranks — shared with
// Leaderboard.jsx's own row list (medal-rank rows use the same colors),
// which is why this is exported rather than kept private to this file.
export const RANK_COLORS = ['#ffd45e', '#c9d3e0', '#e8935a'];

// Last week's top 3 by money_weekly_cents (see api/weekly-money-reset.js /
// schema.sql's finalize_money_week, which snapshots this into
// money_weekly_resets.top3 right before each Monday reset) — rendered
// 2nd/1st/3rd left-to-right, classic podium order, with block height
// tracking rank. Shared by Leaderboard.jsx's "last week's champions" panel
// AND MoneyWeeklyResultsModal.jsx's own podium graphic — one component, so
// both places render literally the same graphic rather than two versions
// that can drift apart.
//
// `size="sm"` (default) is Leaderboard.jsx's own tight sidebar spot —
// fixed 50px columns, username truncates with an ellipsis if it doesn't
// fit. `size="lg"` is MoneyWeeklyResultsModal.jsx's roomier centered
// spot — columns flex/shrink instead of a fixed width, and the username
// wraps onto a second line instead of ever truncating, so a full-length
// (up to 20-char) username always shows completely regardless of how
// long it is.
export default function WeeklyPodium({ top3, size = 'sm' }) {
  const navigate = useNavigate();
  const large = size === 'lg';
  if (!top3 || top3.length === 0) {
    return (
      <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', alignSelf: 'center', maxWidth: 140 }}>
        No champions yet — check back after the first weekly reset.
      </div>
    );
  }
  const order = [1, 0, 2];
  const heights = large ? [76, 56, 42] : [64, 46, 34];
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: large ? 10 : 6, width: large ? '100%' : undefined, justifyContent: large ? 'center' : undefined }}>
      {order.map((rankIdx) => {
        const entry = top3[rankIdx];
        if (!entry) return <div key={rankIdx} style={large ? { flex: '0 1 110px', minWidth: 0 } : { width: 50 }} />;
        // Same navigation as the regular row list below (playNav + push to
        // the read-only PublicProfile route) — entry.userId is a real
        // profiles.id either way, bot or real account, so this always
        // resolves. Snapshotted username/emoji still display even if
        // that account has since renamed/changed flair; only the
        // navigation itself uses the live id.
        const goToProfile = () => {
          playNav();
          navigate(`/player/${entry.userId}`);
        };
        return (
          <div
            key={rankIdx}
            className="mono podium-entry"
            onClick={goToProfile}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              goToProfile();
            }}
            style={
              large
                ? { flex: '0 1 110px', minWidth: 0, textAlign: 'center', cursor: 'pointer' }
                : { width: 50, textAlign: 'center', cursor: 'pointer' }
            }
          >
            <div style={{ fontSize: large ? 18 : 15, marginBottom: 2 }}>{entry.emoji || ''}</div>
            <div
              style={
                large
                  ? { fontSize: 10, color: 'var(--text)', whiteSpace: 'normal', overflowWrap: 'break-word', lineHeight: 1.3, padding: '0 2px' }
                  : { fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }
              }
            >
              {entry.username}
            </div>
            <div
              style={{
                marginTop: 4,
                height: heights[rankIdx],
                borderRadius: '6px 6px 0 0',
                background: `${RANK_COLORS[rankIdx]}22`,
                border: `1px solid ${RANK_COLORS[rankIdx]}66`,
                borderBottom: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 2,
              }}
            >
              <div style={{ fontSize: large ? 15 : 13 }}>{medals[rankIdx]}</div>
              <div style={{ fontSize: large ? 10 : 9, fontWeight: 700, color: RANK_COLORS[rankIdx] }}>{formatCents(entry.scoreCents)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
