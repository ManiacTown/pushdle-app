import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient.js';
import { pacificDateString } from '../lib/pacificDate.js';
import { BADGE_CATEGORIES, SECRET_CATEGORY, BADGE_EMOJI_RARITY, earnedBadges } from '../lib/game.js';
import { formatCents } from '../lib/money.js';
import { spotlightMove } from '../lib/spotlight.js';
import { playNav } from '../lib/sound.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { auraStyle, AURA_COLORS, ROW_STYLE_COLORS, COSMETIC_LABELS } from '../lib/cosmetics.js';
import StatTilesPanel from '../components/StatTilesPanel.jsx';
import AchievementTabToggle from '../components/AchievementTabToggle.jsx';
import BadgeGrid from '../components/BadgeGrid.jsx';
import ActiveMoneyUpgradeBadge from '../components/ActiveMoneyUpgradeBadge.jsx';
import MoneyWinsBadge from '../components/MoneyWinsBadge.jsx';
import TopThreeTag from '../components/TopThreeTag.jsx';

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
  const { user } = useAuth();
  const [profile, setProfile] = useState(null);
  const [todayRun, setTodayRun] = useState(null);
  const [todayMoneyRun, setTodayMoneyRun] = useState(null);
  const [moneyStats, setMoneyStats] = useState(null);
  const [achievementTab, setAchievementTab] = useState('streak');
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // Distinct from notFound — a genuinely missing/deleted account (query
  // succeeded, just no matching row) reads completely differently to a
  // player than "the site couldn't reach the database right now," which
  // used to render as the exact same "Player not found" message.
  const [fetchFailed, setFetchFailed] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);
    setFetchFailed(false);
    (async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select(
          'username, selected_emoji, active_aura, active_push_skin, active_row_style, active_money_upgrade, ' +
            'best_streak, total_pushes, day_streak, busted_at_zero, busted_at_one'
        )
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error('public profile fetch failed:', error);
        setFetchFailed(true);
        setLoading(false);
        return;
      }
      if (!data) {
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
      // failed main query (it reads as "player not found"). These columns
      // are public-read on profiles, same as the streak stats above, so
      // every viewer gets this now.
      const { data: moneyData, error: moneyError } = await supabase
        .from('profiles')
        .select(
          'money_lifetime_cents, money_best_run_cents, money_best_bank_streak, ' +
            'money_weekly_cents, money_best_weekly_cents, money_currently_top3, money_weekly_wins, ' +
            'money_reached_top3_weekly, money_banked_after_one_push, money_busted_over100, ' +
            'owns_insurance, owns_streak_bonus, owns_daredevil, owns_diamond_button, ' +
            'owns_any_row_style, owns_any_aura, money_diamonds_spent_lifetime, ' +
            'money_daredevil_run_200, clicked_contact, ' +
            'won_weekly_with_insurance, won_weekly_with_streak_bonus, won_weekly_with_daredevil, artemis_earned'
        )
        .eq('id', userId)
        .maybeSingle();
      if (!cancelled && !moneyError) setMoneyStats(moneyData ?? {});

      // Unlike the columns above, money_runs (today's IN-PROGRESS run) is
      // deliberately NOT publicly readable (see schema.sql) — there's no
      // live money leaderboard the way daily_runs backs one for classic,
      // so nobody's unbanked-and-still-changing balance is anyone else's
      // business. Only fetch it when viewing your own profile, where RLS
      // ("users can read their own money run") actually allows it anyway;
      // for every other viewer this just silently stays null, dropping
      // the "Today's Money" tile below rather than erroring.
      if (userId === user?.id) {
        const { data: moneyRun } = await supabase
          .from('money_runs')
          .select('earnings_cents, status')
          .eq('user_id', userId)
          .eq('date', today)
          .maybeSingle();
        if (!cancelled) setTodayMoneyRun(moneyRun ?? null);
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, user?.id]);

  if (loading) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (fetchFailed) {
    return (
      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <h2 className="gradient-title" style={{ fontSize: 20, marginBottom: 8 }}>
          Couldn't load this profile
        </h2>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 14 }}>
          Something went wrong fetching this player. Try refreshing the page.
        </div>
        <Link to="/leaderboard" onClick={playNav} className="mono" style={{ fontSize: 11, color: 'var(--neon-cyan)' }}>
          ← Back to leaderboard
        </Link>
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

  // Explicit field picks — same reasoning as Profile.jsx's identical
  // comment: keeps "streak badges are classic-mode only" true by
  // construction rather than by coincidence. moneyStats is null only
  // while still loading or on a fetch error — every real viewer gets it
  // now. Reused as-is for BadgeGrid's own progress-hint calc below, not
  // just earnedBadges() — same fields either way.
  const statsForBadges = {
    bestStreak: profile.best_streak,
    totalPushes: profile.total_pushes,
    dayStreak: profile.day_streak,
    bustedAtZero: profile.busted_at_zero,
    bustedAtOne: profile.busted_at_one,
    moneyLifetimeCents: moneyStats?.money_lifetime_cents,
    moneyBestRunCents: moneyStats?.money_best_run_cents,
    moneyBestBankStreak: moneyStats?.money_best_bank_streak,
    moneyReachedTop3Weekly: moneyStats?.money_reached_top3_weekly,
    moneyBankedAfterOnePush: moneyStats?.money_banked_after_one_push,
    moneyBustedOver100: moneyStats?.money_busted_over100,
    // money-shop badges (see game.js's BADGES)
    ownsInsurance: moneyStats?.owns_insurance,
    ownsStreakBonus: moneyStats?.owns_streak_bonus,
    ownsDaredevil: moneyStats?.owns_daredevil,
    moneyDiamondsSpentLifetime: moneyStats?.money_diamonds_spent_lifetime,
    ownsDiamondButton: moneyStats?.owns_diamond_button,
    ownsAnyRowStyle: moneyStats?.owns_any_row_style,
    ownsAnyAura: moneyStats?.owns_any_aura,
    // secret badges (see game.js's BADGES)
    moneyDaredevilRun200: moneyStats?.money_daredevil_run_200,
    clickedContact: moneyStats?.clicked_contact,
    moneyWeeklyWins: moneyStats?.money_weekly_wins,
    wonWeeklyWithInsurance: moneyStats?.won_weekly_with_insurance,
    wonWeeklyWithStreakBonus: moneyStats?.won_weekly_with_streak_bonus,
    wonWeeklyWithDaredevil: moneyStats?.won_weekly_with_daredevil,
    artemisEarned: moneyStats?.artemis_earned,
  };
  const earned = earnedBadges(statsForBadges);
  const earnedIds = new Set(earned.map((b) => b.id));

  // Split by achievementTab (see the toggle below) rather than one fixed
  // list — normal-mode stats when viewing Normal Mode, money-mode stats
  // when viewing Money Mode, instead of cramming both into the same panel
  // regardless of which badge grid is showing. "Today's Money" mirrors
  // "Today's Streak"'s own busted/live distinction: a busted run's
  // earnings_cents is what was LOST, not banked, so it reads as $0 here,
  // same "you didn't actually earn anything from a run you didn't bank"
  // reasoning MoneyMode.jsx's own reveal already uses.
  const streakStatTiles = [
    { label: "Today's Streak", value: todayRun?.streak ?? 0 },
    { label: 'Best Streak', value: profile.best_streak },
    { label: 'Total Pushes', value: profile.total_pushes },
    { label: 'Day Streak', value: profile.day_streak },
  ];
  const moneyStatTiles = moneyStats
    ? [
        // Only on your own profile — see the fetch effect above for why
        // todayMoneyRun stays null for every other viewer (money_runs'
        // own RLS policy wouldn't return it for them anyway).
        ...(userId === user?.id
          ? [
              {
                label: "Today's Money",
                value: formatCents(todayMoneyRun?.status === 'dead' ? 0 : todayMoneyRun?.earnings_cents ?? 0),
              },
            ]
          : []),
        { label: 'Most Banked', value: formatCents(moneyStats.money_best_run_cents) },
        { label: 'Weekly $', value: formatCents(moneyStats.money_weekly_cents) },
        { label: 'Best Weekly $', value: formatCents(moneyStats.money_best_weekly_cents) },
        { label: 'Lifetime $', value: formatCents(moneyStats.money_lifetime_cents) },
      ]
    : [];
  const statTiles = achievementTab === 'money' ? moneyStatTiles : streakStatTiles;

  return (
    <div>
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {!!moneyStats?.money_currently_top3 && <TopThreeTag />}
            <h2
              className="gradient-title"
              style={{
                fontSize: 22,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                minWidth: 0,
                ...(profile.active_aura ? auraStyle(profile.active_aura) : {}),
              }}
            >
              {profile.username}
            </h2>
            {profile.selected_emoji && (
              <span
                className={BADGE_EMOJI_RARITY[profile.selected_emoji] === 'special' ? 'flair-special' : undefined}
                style={{ fontSize: 20, flexShrink: 0 }}
              >
                {profile.selected_emoji}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <ActiveMoneyUpgradeBadge activeMoneyUpgrade={profile.active_money_upgrade ?? null} />
            <MoneyWinsBadge wins={moneyStats?.money_weekly_wins ?? 0} />
          </div>
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

      <StatTilesPanel tiles={statTiles} />

      <AchievementTabToggle tab={achievementTab} onChange={setAchievementTab} />

      {/* Read-only summary of whichever shop cosmetics this player has
          EQUIPPED (see Profile.jsx's own Cosmetics tabs, where they picked
          these) — sits right above the badge grid, on purpose, since both
          are "what does this player show off" content. Only lists
          categories that actually have something equipped; a player with
          nothing equipped anywhere just doesn't get this panel at all,
          same "no clutter for what isn't there" reasoning as
          ActiveMoneyUpgradeBadge above. */}
      {(profile.active_push_skin || profile.active_aura || profile.active_row_style) && (
        <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 13, marginBottom: 10 }}>Cosmetics</h3>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            {profile.active_push_skin === 'diamond_button' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <img src="/diamond-button.png" alt="" width={20} height={20} style={{ display: 'block' }} />
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  {COSMETIC_LABELS.diamond_button}
                </span>
              </div>
            )}
            {profile.active_aura && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 700, color: AURA_COLORS[profile.active_aura] }}>Aa</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  {COSMETIC_LABELS[profile.active_aura]} name
                </span>
              </div>
            )}
            {profile.active_row_style && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 14, height: 14, borderRadius: '50%', background: ROW_STYLE_COLORS[profile.active_row_style] }} />
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
                  {COSMETIC_LABELS[profile.active_row_style]} row
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <BadgeGrid
        categories={
          achievementTab === 'secret'
            ? [SECRET_CATEGORY]
            : BADGE_CATEGORIES.filter((cat) => cat.id.startsWith('money-') === (achievementTab === 'money'))
        }
        earnedIds={earnedIds}
        currentEmoji={profile.selected_emoji}
        stats={statsForBadges}
      />
    </div>
  );
}
