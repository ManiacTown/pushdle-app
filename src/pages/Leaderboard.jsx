import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { pacificDateString } from '../lib/pacificDate.js';
import { spotlightMove } from '../lib/spotlight.js';
import { playNav } from '../lib/sound.js';
import { formatCents } from '../lib/money.js';

// Gold / silver / bronze accents for the top 3 ranks.
const RANK_COLORS = ['#ffd45e', '#c9d3e0', '#e8935a'];
// Rows per page — once the merged real+bot list exceeds this, pagination
// controls appear below the board.
const PAGE_SIZE = 50;

export default function Leaderboard() {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [allRows, setAllRows] = useState([]);
  const [page, setPage] = useState(0);
  // Money-variant tab — TEMP admin-gated (see the button below), same
  // rollout plan as the rest of the money variant. Falls back to 'streak'
  // even if somehow set to 'money' while logged out/non-admin, since the
  // fetch effect below only ever queries the money branch when isAdmin.
  const [tab, setTab] = useState('streak');

  useEffect(() => {
    setPage(0);

    if (!isSupabaseConfigured) {
      setAllRows([]);
      return;
    }

    if (tab === 'money') {
      if (!isAdmin) {
        setAllRows([]);
        return;
      }
      // Lifetime total, not a per-day score — reads straight from profiles
      // rather than joining through money_runs (which only holds TODAY's
      // in-progress run, and isn't publicly readable anyway — see schema.sql).
      supabase
        .from('profiles')
        .select('id, username, selected_emoji, money_lifetime_cents')
        .order('money_lifetime_cents', { ascending: false })
        .limit(1000)
        .then(({ data, error }) => {
          const rows =
            !error && data
              ? data.map((row) => ({
                  userId: row.id,
                  name: row.username ?? 'Unknown',
                  emoji: row.selected_emoji ?? null,
                  score: row.money_lifetime_cents,
                  me: user ? row.id === user.id : false,
                }))
              : [];
          setAllRows(rows);
        });
      return;
    }

    const today = pacificDateString();
    // Bots are real accounts with real daily_runs rows now (see
    // scripts/simulate-bot-day.mjs) — indistinguishable from a real
    // player's row in this same query, no separate merge needed.
    supabase
      .from('daily_runs')
      .select('user_id, streak, profiles(username, selected_emoji)')
      .eq('date', today)
      .order('streak', { ascending: false })
      .limit(1000)
      .then(({ data, error }) => {
        const rows =
          !error && data
            ? data.map((row) => ({
                userId: row.user_id,
                name: row.profiles?.username ?? 'Unknown',
                emoji: row.profiles?.selected_emoji ?? null,
                score: row.streak,
                me: user ? row.user_id === user.id : false,
              }))
            : [];
        setAllRows(rows);
      });
  }, [user, tab, isAdmin]);

  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const rows = allRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  // Rank across the WHOLE board, not just whatever page you're looking at
  // — a guest is never in allRows at all (see the "guest runs stay local"
  // note below), so this naturally stays hidden for them without any
  // extra guarding.
  const myRank = allRows.findIndex((r) => r.me);

  return (
    // Capped at its own width (matching the old flat --content-max-width
    // floor) rather than stretching to fill the now much wider app-shell —
    // a long list of name/score rows doesn't get more readable by getting
    // wider, it just gets sparser.
    <div className="panel spotlight" onMouseMove={spotlightMove} style={{ maxWidth: 460, margin: '0 auto' }}>
      <h3 style={{ fontSize: 15, marginBottom: 14 }}>
        {tab === 'money' ? 'Lifetime money leaderboard' : "Today's leaderboard"}
      </h3>
      {/* TEMP admin gate — the money variant isn't ready for real players
          yet, so this tab is hidden rather than showing everyone a
          permanently-empty board for a mode they can't play. Remove this
          isAdmin check once it's ready for everyone. */}
      {isAdmin && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
          <button
            className="btn-ghost"
            style={tab === 'streak' ? { borderColor: 'var(--neon-cyan)', color: 'var(--neon-cyan)' } : undefined}
            onClick={() => setTab('streak')}
          >
            Streak
          </button>
          <button
            className="btn-ghost"
            style={tab === 'money' ? { borderColor: '#ffd45e', color: '#ffd45e' } : undefined}
            onClick={() => setTab('money')}
          >
            💰 Money
          </button>
        </div>
      )}
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 14 }}>
        {!isSupabaseConfigured
          ? 'Accounts aren’t configured on this deployment yet.'
          : tab === 'money'
          ? 'Total money ever cashed out — spending in the shop never lowers this.'
          : 'Real runs from logged-in players — guest runs stay local and never appear here.'}
      </div>
      {myRank >= 0 && (
        <div
          className="mono"
          style={{
            fontSize: 13,
            fontWeight: 700,
            color: 'var(--neon-cyan)',
            textShadow: '0 0 10px rgba(34,229,255,0.5)',
            marginBottom: 14,
            padding: '8px 12px',
            borderRadius: 8,
            border: '1px solid rgba(34,229,255,0.35)',
            background: 'rgba(34,229,255,0.06)',
          }}
        >
          You are rank #{myRank + 1}
        </div>
      )}
      {rows.map((row, i) => {
        // Global rank across all pages, not just this page's index — only
        // the very top 3 overall ever get a medal.
        const rank = page * PAGE_SIZE + i;
        const medal = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : rank + 1;
        const rankColor = RANK_COLORS[rank];
        return (
          <div
            key={`${row.name}-${i}`}
            className="mono leaderboard-row"
            // Bots have no userId (see lib/bots.js — they're a fixed
            // client-side list, not real accounts, nothing to navigate
            // to), so only real rows are clickable. Clicking your own row
            // goes to the same read-only view everyone else sees when they
            // click you, not your private editable /profile.
            onClick={row.userId ? () => { playNav(); navigate(`/player/${row.userId}`); } : undefined}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              padding: '9px 12px',
              borderRadius: 8,
              marginBottom: 4,
              cursor: row.userId ? 'pointer' : 'default',
              // Rank tier (gold/silver/bronze) always wins the row's base
              // look, even when it's the player's own row — "you" is layered
              // on top via the cyan inset ring + tag below instead of
              // overriding the medal color outright.
              color: rankColor ? '#e8e8f0' : row.me ? 'var(--neon-cyan)' : 'var(--text-dim)',
              background: rankColor
                ? `${rankColor}1a`
                : row.me
                ? 'rgba(139,92,246,0.14)'
                : 'rgba(255,255,255,0.02)',
              border: rankColor ? `1px solid ${rankColor}55` : row.me ? '1px solid rgba(139,92,246,0.4)' : 'none',
              borderLeft: rankColor ? `3px solid ${rankColor}` : undefined,
              boxShadow: row.me && rankColor ? 'inset 0 0 0 1px rgba(34,229,255,0.65)' : undefined,
              fontWeight: row.me || rankColor ? 700 : 400,
            }}
          >
            <div style={{ width: 28, color: rankColor || 'var(--neon-violet)' }}>{medal}</div>
            <div
              style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                textAlign: 'left',
                paddingLeft: 6,
                color: row.me ? 'var(--neon-cyan)' : undefined,
              }}
            >
              {/* Username length/characters are enforced at signup (see
                  Login.jsx's sanitizeUsername) and the profiles table's own
                  CHECK constraint, but this is a backstop regardless — an
                  old account from before that validation existed, or a bot
                  name (which isn't stored/validated at all, just a fixed
                  client-side list), could still in principle be long enough
                  to break this row's layout. Truncates gracefully instead
                  of wrapping or pushing the score column around. */}
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {row.name}
              </span>
              {row.emoji && <span>{row.emoji}</span>}
              {row.me && rankColor && (
                <span className="mono" style={{ fontSize: 9, color: 'var(--neon-cyan)', letterSpacing: '0.05em', flexShrink: 0 }}>
                  YOU
                </span>
              )}
            </div>
            <div style={{ flexShrink: 0 }}>{tab === 'money' ? formatCents(row.score) : row.score}</div>
          </div>
        );
      })}
      {pageCount > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <button className="btn-ghost" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            ← Prev
          </button>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
            Page {page + 1} / {pageCount}
          </span>
          <button className="btn-ghost" disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
