import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { pacificDateString } from '../lib/pacificDate.js';
import { BADGES, BADGE_CATEGORIES, BADGE_EMOJI, RARITY_META, earnedBadges } from '../lib/game.js';
import { formatCents } from '../lib/money.js';
import { spotlightMove } from '../lib/spotlight.js';
import { playNav } from '../lib/sound.js';
import { useAuth } from '../lib/AuthContext.jsx';

// Read-only counterpart to Profile.jsx — same stats/badge-grid look, but
// for viewing *someone else's* profile from the leaderboard (see the
// row-click in Leaderboard.jsx). No Log out button, no click-to-set-flair
// on badges — and this now also renders for your *own* id (clicking your
// own leaderboard row shows this same read-only view, the same thing
// everyone else sees when they click you, rather than jumping to your
// private editable /profile). Lifetime stats/badges come from `profiles`
// by id — public-read (see schema.sql's RLS policies; the same access the
// leaderboard query itself already relies on), so this needs no new
// backend work. "Today's streak" comes from `daily_runs`, same query path
// for everyone — bots have real rows there too now (see
// scripts/simulate-bot-day.mjs), no special-casing needed.
export default function PublicProfile() {
  const { userId } = useParams();
  // The VIEWER's own isAdmin, not the profile owner's — gates the money
  // stat tile below the same way Leaderboard.jsx gates its money tab,
  // so a regular player doesn't see a stray "Lifetime $" tile pointing at
  // a mode they can't play yet.
  const { isAdmin } = useAuth();
  const [profile, setProfile] = useState(null);
  const [todayRun, setTodayRun] = useState(null);
  const [moneyLifetimeCents, setMoneyLifetimeCents] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('username, selected_emoji, best_streak, total_pushes, day_streak, busted_at_zero, busted_at_one')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setNotFound(true);
        setLoading(false);
        return;
      }
      setProfile(data);
      const today = pacificDateString();
      const { data: run } = await supabase
        .from('daily_runs')
        .select('streak, status')
        .eq('user_id', userId)
        .eq('date', today)
        .maybeSingle();
      if (!cancelled) setTodayRun(run ?? null);

      // Deliberately its own query, not folded into the main profile
      // select above — same reasoning as AuthContext.jsx's onboarding_seen
      // fetch: Postgrest fails a select() as a whole if any requested
      // column doesn't exist yet, and this page has no fallback for a
      // failed main query (it reads as "player not found"). Only bothers
      // fetching for an admin viewer, since it's the only one who'd ever
      // see it (see the isAdmin-gated tile below).
      if (isAdmin) {
        const { data: moneyData, error: moneyError } = await supabase
          .from('profiles')
          .select('money_lifetime_cents')
          .eq('id', userId)
          .maybeSingle();
        if (!cancelled && !moneyError) setMoneyLifetimeCents(moneyData?.money_lifetime_cents ?? 0);
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, isAdmin]);

  if (loading) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <h2 className="gradient-title" style={{ fontSize: 20, marginBottom: 8 }}>
          Player not found
        </h2>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 14 }}>
          This account doesn't exist, or the player deleted it.
        </div>
        <Link to="/leaderboard" onClick={playNav} className="mono" style={{ fontSize: 11, color: 'var(--neon-cyan)' }}>
          ← Back to leaderboard
        </Link>
      </div>
    );
  }

  const earned = earnedBadges({
    bestStreak: profile.best_streak,
    totalPushes: profile.total_pushes,
    dayStreak: profile.day_streak,
    bustedAtZero: profile.busted_at_zero,
    bustedAtOne: profile.busted_at_one,
  });
  const earnedIds = new Set(earned.map((b) => b.id));

  const statTiles = [
    { label: "Today's Streak", value: todayRun?.streak ?? 0 },
    { label: 'Best Streak', value: profile.best_streak },
    { label: 'Total Pushes', value: profile.total_pushes },
    { label: 'Day Streak', value: profile.day_streak },
    // TEMP admin-gated (see isAdmin above) — the money variant isn't ready
    // for real players yet, so a regular viewer never sees this tile.
    ...(isAdmin && moneyLifetimeCents !== null ? [{ label: 'Lifetime $', value: formatCents(moneyLifetimeCents) }] : []),
  ];

  return (
    <div>
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <h2
            className="gradient-title"
            style={{ fontSize: 22, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
          >
            {profile.username}
          </h2>
          {profile.selected_emoji && <span style={{ fontSize: 20, flexShrink: 0 }}>{profile.selected_emoji}</span>}
        </div>
        {todayRun && (
          <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8 }}>
            {todayRun.status === 'dead' ? 'Busted today at' : 'Still playing today —'}{' '}
            <span style={{ color: 'var(--neon-green)', fontWeight: 700 }}>{todayRun.streak}</span>
            {todayRun.status === 'dead' ? '.' : ' and counting.'}
          </div>
        )}
        <Link to="/leaderboard" onClick={playNav} className="mono" style={{ fontSize: 10, color: 'var(--neon-cyan)', display: 'inline-block', marginTop: 10 }}>
          ← Back to leaderboard
        </Link>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 14 }}>Stats</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 10 }}>
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

      {/* alignItems:'start' — see the same rule in Profile.jsx; keeps each
          category panel sized to its own badge count instead of stretched
          to match the tallest one sharing its grid row. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {BADGE_CATEGORIES.map((cat) => (
          <div key={cat.id} className="panel spotlight" onMouseMove={spotlightMove}>
            <h3 style={{ fontSize: 14, marginBottom: 12 }}>{cat.label}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {BADGES.filter((b) => b.category === cat.id).map((b) => {
                const has = earnedIds.has(b.id);
                const rarity = RARITY_META[b.rarity];
                const emoji = BADGE_EMOJI[b.id];
                const selected = has && !!emoji && profile.selected_emoji === emoji;
                return (
                  <div
                    key={b.id}
                    className="badge-card"
                    style={{
                      border: selected
                        ? '1px solid rgba(255,212,94,0.7)'
                        : has
                        ? '1px solid rgba(139,92,246,0.6)'
                        : '1px solid rgba(255,255,255,0.16)',
                      borderRadius: 10,
                      padding: '14px 8px 14px',
                      textAlign: 'center',
                      background: selected ? 'rgba(255,212,94,0.1)' : has ? 'rgba(139,92,246,0.08)' : 'rgba(255,255,255,0.02)',
                      boxShadow: selected ? '0 0 14px rgba(255,212,94,0.3)' : has ? '0 0 14px rgba(139,92,246,0.22)' : 'none',
                      cursor: 'default',
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
