import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { pacificDateString, msUntilNextPacificWeekStart, formatCountdown } from '../lib/pacificDate.js';
import { spotlightMove } from '../lib/spotlight.js';
import { playNav } from '../lib/sound.js';
import { formatCents } from '../lib/money.js';
import { ROW_STYLE_COLORS, auraStyle } from '../lib/cosmetics.js';

// Gold / silver / bronze accents for the top 3 ranks.
const RANK_COLORS = ['#ffd45e', '#c9d3e0', '#e8935a'];
// Rows per page — once the merged real+bot list exceeds this, pagination
// controls appear below the board.
const PAGE_SIZE = 50;

// The weekly money leaderboard's real, ongoing life starts here — not at
// whatever moment this shipped to production. Everything before this
// date is admin/bot testing (all-zero rows post-grand-reset, a bot-name
// podium snapshot in money_weekly_resets) that a real visitor has no
// reason to see. Deliberately a Monday — the existing weekly reset cron
// (api/weekly-money-reset.js) already fires every Monday, so this lines
// up with the very first REAL reset with zero schedule changes needed.
// Once this date arrives, the "This Week" view and podium just render
// normally with whatever's real in the database — no code changes
// required at that point, this gate simply stops applying. The first
// week's podium will naturally show WeeklyPodium's own "No champions
// yet" empty state (there's no completed week to snapshot from yet) —
// same code path a genuinely quiet week would already hit, nothing
// special-cased for "first week" specifically. By the Monday after
// that (once a real week has actually completed and the cron has run),
// real champions start showing up there too.
const WEEKLY_LEADERBOARD_START_DATE = '2026-08-03';

// Last week's top 3 by money_weekly_cents (see api/weekly-money-reset.js,
// which snapshots this into money_weekly_resets.top3 right before each
// Monday reset) — rendered 2nd/1st/3rd left-to-right, classic podium
// order, with block height tracking rank. Real graphics can swap in for
// these plain CSS blocks later; the data/layout underneath won't change.
function WeeklyPodium({ top3 }) {
  // Its own useNavigate(), not a prop drilled down from Leaderboard — this
  // is rendered as a real component (<WeeklyPodium .../>), so it's free to
  // call hooks directly, same as any other component in this file.
  const navigate = useNavigate();
  if (!top3 || top3.length === 0) {
    return (
      <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', alignSelf: 'center', maxWidth: 140 }}>
        No champions yet — check back after the first weekly reset.
      </div>
    );
  }
  const order = [1, 0, 2];
  const heights = [64, 46, 34];
  const medals = ['🥇', '🥈', '🥉'];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6 }}>
      {order.map((rankIdx) => {
        const entry = top3[rankIdx];
        if (!entry) return <div key={rankIdx} style={{ width: 50 }} />;
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
            style={{ width: 50, textAlign: 'center', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 15, marginBottom: 2 }}>{entry.emoji || ''}</div>
            <div style={{ fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
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
              <div style={{ fontSize: 13 }}>{medals[rankIdx]}</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: RANK_COLORS[rankIdx] }}>{formatCents(entry.scoreCents)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Leaderboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [allRows, setAllRows] = useState([]);
  const [page, setPage] = useState(0);
  const [tab, setTab] = useState('streak');
  // Sub-toggle within the money tab only (not a third top-level tab) —
  // 'lifetime' reads money_lifetime_cents (never goes down), 'weekly'
  // reads money_weekly_cents (reset by api/weekly-money-reset.js every
  // Monday — see that file and game.js's "Golden Goose" badge, which
  // snapshots the top 3 here into something permanent right before the
  // reset happens).
  const [moneyPeriod, setMoneyPeriod] = useState('weekly');
  // Last week's champions (see WeeklyPodium above) — fetched once per
  // visit to the money tab, independent of moneyPeriod (it's always "last
  // week," regardless of which period you're currently browsing).
  const [lastWeekTop3, setLastWeekTop3] = useState([]);
  // Ticks once a second purely to force a re-render, so the weekly
  // countdown below (which reads the live clock fresh every render, not
  // from this state) stays current — same pattern as MoneyMode.jsx/
  // Home.jsx's own countdown timers.
  const [tick, setTick] = useState(0);
  // Distinct from "allRows is just empty" (a real, quiet day/tab with
  // nobody on it) — a failed fetch used to render identically to that,
  // with no way to tell the two apart. Reset at the start of every fetch,
  // not just on success, so switching tabs after a failure clears the
  // banner instead of leaving a stale error up.
  const [fetchError, setFetchError] = useState(false);
  // See WEEKLY_LEADERBOARD_START_DATE's own comment — plain string
  // comparison works here since pacificDateString() and the constant are
  // both YYYY-MM-DD, which sorts identically to a real date compare.
  const weeklyLeaderboardLive = pacificDateString() >= WEEKLY_LEADERBOARD_START_DATE;

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || tab !== 'money' || !weeklyLeaderboardLive) return;
    supabase
      .from('money_weekly_resets')
      .select('top3')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        setLastWeekTop3(data?.top3 ?? []);
      });
  }, [tab, weeklyLeaderboardLive]);

  useEffect(() => {
    setPage(0);
    setFetchError(false);

    if (!isSupabaseConfigured) {
      setAllRows([]);
      return;
    }

    if (tab === 'money') {
      // Weekly hasn't actually started yet (see WEEKLY_LEADERBOARD_START_DATE)
      // — skip the fetch entirely rather than pull a meaningless
      // all-zero-post-reset row list nobody should see. Lifetime is
      // unaffected, fetches normally either way.
      if (moneyPeriod === 'weekly' && !weeklyLeaderboardLive) {
        setAllRows([]);
        return;
      }
      // Both columns live on profiles, not money_runs (which only holds
      // TODAY's in-progress run, and isn't publicly readable anyway — see
      // schema.sql) — money_lifetime_cents never goes down,
      // money_weekly_cents resets every Monday (see moneyPeriod's comment
      // above). Same query shape either way, just a different column.
      const scoreColumn = moneyPeriod === 'weekly' ? 'money_weekly_cents' : 'money_lifetime_cents';
      supabase
        .from('profiles')
        .select(`id, username, selected_emoji, active_aura, active_row_style, ${scoreColumn}`)
        .order(scoreColumn, { ascending: false })
        .limit(1000)
        .then(({ data, error }) => {
          if (error) {
            console.error('leaderboard money fetch failed:', error);
            setFetchError(true);
            setAllRows([]);
            return;
          }
          setAllRows(
            (data ?? []).map((row) => ({
              userId: row.id,
              name: row.username ?? 'Unknown',
              emoji: row.selected_emoji ?? null,
              aura: row.active_aura ?? null,
              rowStyle: row.active_row_style ?? null,
              score: row[scoreColumn],
              me: user ? row.id === user.id : false,
            }))
          );
        });
      return;
    }

    const today = pacificDateString();
    // Bots are real accounts with real daily_runs rows now (see
    // scripts/simulate-bot-day.mjs) — indistinguishable from a real
    // player's row in this same query, no separate merge needed.
    supabase
      .from('daily_runs')
      .select('user_id, streak, profiles(username, selected_emoji, active_aura, active_row_style)')
      .eq('date', today)
      .order('streak', { ascending: false })
      .limit(1000)
      .then(({ data, error }) => {
        if (error) {
          console.error('leaderboard streak fetch failed:', error);
          setFetchError(true);
          setAllRows([]);
          return;
        }
        setAllRows(
          (data ?? []).map((row) => ({
            userId: row.user_id,
            name: row.profiles?.username ?? 'Unknown',
            emoji: row.profiles?.selected_emoji ?? null,
            aura: row.profiles?.active_aura ?? null,
            rowStyle: row.profiles?.active_row_style ?? null,
            score: row.streak,
            me: user ? row.user_id === user.id : false,
          }))
        );
      });
  }, [user, tab, moneyPeriod, weeklyLeaderboardLive]);

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
        {tab === 'money'
          ? moneyPeriod === 'weekly'
            ? "This week's money leaderboard"
            : 'Lifetime money leaderboard'
          : "Today's leaderboard"}
      </h3>
      {/* Tab row + sub-toggle live in a column on the left; the podium
          (only in the money tab) sits beside them on the right, not below
          — that's the "red circled" space from the screenshot. */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
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
            {/* Sub-toggle, only within the money tab — same button pattern
                one level down, cyan/gold swapped for a plain violet accent
                so it doesn't visually compete with the tab row above it.
                This Week first (was Lifetime) — the more actionable/live
                view of the two now leads. */}
            {tab === 'money' && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn-ghost"
                  style={
                    moneyPeriod === 'weekly'
                      ? { borderColor: 'rgba(139,92,246,0.7)', color: 'var(--text)', fontSize: 11 }
                      : { fontSize: 11 }
                  }
                  onClick={() => setMoneyPeriod('weekly')}
                >
                  This Week
                </button>
                <button
                  className="btn-ghost"
                  style={
                    moneyPeriod === 'lifetime'
                      ? { borderColor: 'rgba(139,92,246,0.7)', color: 'var(--text)', fontSize: 11 }
                      : { fontSize: 11 }
                  }
                  onClick={() => setMoneyPeriod('lifetime')}
                >
                  Lifetime
                </button>
              </div>
            )}
          </div>
          {tab === 'money' && weeklyLeaderboardLive && (
            <div>
              <div
                className="mono"
                style={{ fontSize: 8, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6, textAlign: 'center' }}
              >
                Last week
              </div>
              <WeeklyPodium top3={lastWeekTop3} />
            </div>
          )}
        </div>
      <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginBottom: 14 }}>
        {!isSupabaseConfigured
          ? 'Accounts aren’t configured on this deployment yet.'
          : tab === 'money' && moneyPeriod === 'weekly' && !weeklyLeaderboardLive
          ? 'Starts August 3rd — check back then!'
          : tab === 'money' && moneyPeriod === 'weekly'
          ? 'Resets every Monday — top 3 here earn the Golden Goose badge right before the reset.'
          : tab === 'money'
          ? 'Total money ever cashed out — spending in the shop never lowers this.'
          : 'Real runs from logged-in players — guest runs stay local and never appear here.'}
      </div>
      {/* Weekly hasn't started yet — see WEEKLY_LEADERBOARD_START_DATE.
          Replaces the row list/countdown/rank banner entirely (all of
          which would otherwise just be empty/zero anyway, now that
          allRows is deliberately never fetched for this case) with a
          single, unambiguous placeholder instead of a board that LOOKS
          live but has nothing real in it yet. */}
      {tab === 'money' && moneyPeriod === 'weekly' && !weeklyLeaderboardLive && (
        <div
          className="mono"
          style={{ fontSize: 12, color: 'var(--text-dim)', textAlign: 'center', padding: '28px 12px' }}
        >
          🏆 Weekly leaderboards start <strong style={{ color: 'var(--text)' }}>August 3rd</strong>.
          <br />
          Come back then to see who's on top.
        </div>
      )}
      {/* Distinct from an empty board — a failed fetch used to render as
          an indistinguishable blank list, with no way to tell "nobody's
          played" from "this broke." */}
      {fetchError && (
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--neon-red)', marginBottom: 14, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,90,90,0.35)', background: 'rgba(255,90,90,0.06)' }}
        >
          Couldn't load the leaderboard right now. Try refreshing the page.
        </div>
      )}
      {/* Live countdown to next Monday midnight (Pacific) — see
          msUntilNextPacificWeekStart. Sits between the "resets every
          Monday" description above and the rank banner below, per the
          ask. tick (see the effect above) is what keeps this re-rendering
          every second even though it's never read directly here — same
          "force a re-render, recompute the real value fresh" pattern
          MoneyMode.jsx's own countdown uses. */}
      {tab === 'money' && moneyPeriod === 'weekly' && weeklyLeaderboardLive && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 14 }}>
          Resets in <span style={{ color: 'var(--neon-cyan)', fontWeight: 700 }}>{formatCountdown(msUntilNextPacificWeekStart())}</span>
        </div>
      )}
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
        // Shop-purchased personalization (see MoneyShop.jsx/cosmetics.js)
        // for the row's OWN owner, whoever that is — every row can show
        // its owner's equipped row style, not just your own. Medal ranks
        // still always win (see the row's own style block below), same
        // "rank tier beats personalization" precedence row.me's default
        // violet tint already followed before this existed.
        const rowStyleColor = row.rowStyle ? ROW_STYLE_COLORS[row.rowStyle] : null;
        // Bots have no userId (see lib/bots.js — they're a fixed
        // client-side list, not real accounts, nothing to navigate to),
        // so only real rows are clickable/focusable at all.
        const goToRowProfile = row.userId ? () => { playNav(); navigate(`/player/${row.userId}`); } : undefined;
        return (
          <div
            key={`${row.name}-${i}`}
            className="mono leaderboard-row"
            // Clicking your own row goes to the same read-only view
            // everyone else sees when they click you, not your private
            // editable /profile.
            onClick={goToRowProfile}
            role={goToRowProfile ? 'button' : undefined}
            tabIndex={goToRowProfile ? 0 : undefined}
            onKeyDown={
              goToRowProfile
                ? (e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    goToRowProfile();
                  }
                : undefined
            }
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 12,
              padding: '9px 12px',
              borderRadius: 8,
              marginBottom: 4,
              cursor: row.userId ? 'pointer' : 'default',
              // Rank tier (gold/silver/bronze) always wins the row's base
              // look, even for a personalized/own row — "you" is layered on
              // top via the cyan inset ring + tag below instead of
              // overriding the medal color outright. A purchased row style
              // (see MoneyShop.jsx) is a background tint PLUS a matching
              // border (the border exists purely to emphasize/delineate the
              // tint against neighboring rows, not to signal "selected" —
              // it never touches text color or font-weight, which stay
              // rank/me-driven only, so it can't be confused with the real
              // is-this-me treatment).
              color: rankColor ? '#e8e8f0' : row.me ? 'var(--neon-cyan)' : 'var(--text-dim)',
              // A purchased row style wins over the plain "is this me"
              // violet default (it's a deliberate choice, made BY that
              // row's own owner, whether that's you or someone else) — for
              // both background and border; text color/font-weight above
              // still come from rank/me alone, so the row style never reads
              // as "selected," just tinted-and-outlined.
              background: rankColor
                ? `${rankColor}1a`
                : rowStyleColor
                ? `${rowStyleColor}1a`
                : row.me
                ? 'rgba(139,92,246,0.14)'
                : 'rgba(255,255,255,0.02)',
              border: rankColor
                ? `1px solid ${rankColor}55`
                : rowStyleColor
                ? `1px solid ${rowStyleColor}66`
                : row.me
                ? '1px solid rgba(139,92,246,0.4)'
                : 'none',
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
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  ...(row.aura ? auraStyle(row.aura) : undefined),
                }}
              >
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
