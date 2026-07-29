import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { pacificDateString } from '../lib/pacificDate.js';
import * as storage from '../lib/storage.js';
import { BADGES, BADGE_CATEGORIES, BADGE_EMOJI, earnedBadges } from '../lib/game.js';
import { formatCents } from '../lib/money.js';
import { spotlightMove } from '../lib/spotlight.js';
import { auraStyle, AURA_COLORS, ROW_STYLE_COLORS, COSMETIC_CATEGORIES } from '../lib/cosmetics.js';
import { playBadgeSelect } from '../lib/sound.js';
import StatTilesPanel from '../components/StatTilesPanel.jsx';
import AchievementTabToggle from '../components/AchievementTabToggle.jsx';
import CosmeticTabs from '../components/CosmeticTabs.jsx';
import InsuranceBadge from '../components/InsuranceBadge.jsx';
import BadgeGrid from '../components/BadgeGrid.jsx';

// Username's own natural (unshrunk) size and the floor it can shrink to
// before the streak badge and Log out button start crowding it — see the
// measurement effect below.
const USERNAME_BASE_FONT_SIZE = 22;
const USERNAME_MIN_FONT_SIZE = 12;

const COSMETICS_TABS = [{ id: 'flair', label: 'Flair' }, ...COSMETIC_CATEGORIES.map((c) => ({ id: c.id, label: c.label }))];

// Shared by every tab in the Cosmetics panel below (Flair included) — a
// row of owned options plus an explicit "none" (🚫) choice, the active one
// highlighted with the same gold ring regardless of which tab it's in.
// `items`/`renderItem` let each tab supply its own glyph (an emoji for
// flair, a colored swatch for name-color/row-background, an icon for
// push-button skins) without four near-identical button blocks. Returns
// just the empty-state message (no button row, not even the 🚫) when
// nothing's ownable yet — matches Flair's own pre-existing behavior of
// fully hiding the picker until there's at least one real choice to make.
function EquipPicker({ items, activeId, onSelect, disabled, renderItem, emptyMessage }) {
  if (items.length === 0) {
    // Flair passes no emptyMessage — its own bespoke "earn a badge to
    // unlock one" copy already lives just above this component, so
    // rendering nothing here avoids a redundant/blank second message box.
    if (!emptyMessage) return null;
    return (
      <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {emptyMessage}
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
      <button
        className="btn-ghost"
        onClick={() => onSelect(null)}
        disabled={disabled}
        title="None"
        style={{
          fontSize: 15,
          lineHeight: 1,
          padding: '8px 12px',
          border: !activeId ? '1px solid rgba(255,212,94,0.7)' : undefined,
          background: !activeId ? 'rgba(255,212,94,0.12)' : undefined,
          boxShadow: !activeId ? '0 0 10px rgba(255,212,94,0.25)' : undefined,
        }}
      >
        🚫
      </button>
      {items.map((id) => (
        <button
          key={id}
          className="btn-ghost"
          onClick={() => onSelect(id)}
          disabled={disabled}
          title={activeId === id ? 'Currently equipped' : 'Equip'}
          style={{
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: activeId === id ? '1px solid rgba(255,212,94,0.7)' : undefined,
            background: activeId === id ? 'rgba(255,212,94,0.12)' : undefined,
            boxShadow: activeId === id ? '0 0 10px rgba(255,212,94,0.25)' : undefined,
          }}
        >
          {renderItem(id)}
        </button>
      ))}
    </div>
  );
}

export default function Profile() {
  const { user, logout, isAdmin, selectedEmoji, updateSelectedEmoji, stats: authStats, refreshMoneyStats } = useAuth();
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
  // Which achievement grid is showing — see the toggle above the grid
  // below. The toggle itself only renders for isAdmin, same gate/reasoning
  // as Leaderboard.jsx's money tab — a real player seeing a "Money" tab at
  // all would leak that the mode exists before it's ready, even if every
  // badge behind it reads as locked.
  const [achievementTab, setAchievementTab] = useState('streak');
  // Which tab of the Cosmetics panel is showing — Flair first (see
  // COSMETICS_TABS above), then the three shop-purchased equip categories.
  const [cosmeticsTab, setCosmeticsTab] = useState('flair');
  // Shared busy flag for every equip click across all three cosmetic tabs
  // (not per-tab) — only one equip request is ever in flight at a time
  // regardless of which tab it came from.
  const [equipBusy, setEquipBusy] = useState(false);
  // Today's streak/money-run — mirrors PublicProfile.jsx's own
  // todayRun/todayMoneyRun, just sourced per-mode below (guest local
  // storage vs. a real daily_runs/money_runs row for a logged-in
  // account) since this page, unlike PublicProfile.jsx, has a guest path
  // to support too.
  const [todayStreak, setTodayStreak] = useState(0);
  const [todayMoneyRun, setTodayMoneyRun] = useState(null);
  // Distinct from "0 today" — a failed fetch used to render identically to
  // an honest 0, no way to tell "you haven't played" from "this broke".
  const [todayFetchError, setTodayFetchError] = useState(false);
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
      storage.getTodayState().then((s) => setTodayStreak(s.streak));
    }
  }, [user]);

  // Logged-in counterpart to the guest fetch above — real rows instead of
  // local storage. money_runs read is gated behind isAdmin, same as the
  // achievement tab that shows it at all (see that toggle's own comment) —
  // a non-admin account has no money_runs row to find anyway (money mode
  // is gated client- AND server-side), so this just skips a query that
  // would always come back empty for them.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setTodayFetchError(false);
    const today = pacificDateString();
    supabase
      .from('daily_runs')
      .select('streak')
      .eq('user_id', user.id)
      .eq('date', today)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('today streak fetch failed:', error);
          setTodayFetchError(true);
          return;
        }
        setTodayStreak(data?.streak ?? 0);
      });
    if (isAdmin) {
      supabase
        .from('money_runs')
        .select('earnings_cents, status')
        .eq('user_id', user.id)
        .eq('date', today)
        .maybeSingle()
        .then(({ data, error }) => {
          if (cancelled) return;
          if (error) {
            console.error('today money run fetch failed:', error);
            setTodayFetchError(true);
            return;
          }
          setTodayMoneyRun(data ?? null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [user, isAdmin]);

  // AuthContext merges/holds the server-authoritative copy for logged-in
  // players (see its login-time merge and Home.jsx, which keeps it fresh
  // after every push/admin action) — stats is null only for the brief
  // window right after login while that merge is still in flight.
  const bestStreak = user ? authStats?.bestStreak ?? 0 : guestBestStreak;
  const stats = user ? authStats ?? { totalPushes: 0, dayStreak: 0, bustedAtZero: false, bustedAtOne: false } : guestStats;
  const statsLoading = user && !authStats;

  // Explicit field picks, not a wholesale ...stats spread — stats is
  // authStats for logged-in players, which carries every money_* field
  // too (see AuthContext.jsx). Naming every field individually, streak
  // AND money alike, is what keeps "streak badges are classic-mode only"
  // true by construction rather than by coincidence — a wholesale spread
  // would still work today (no streak check reads a money field) but
  // wouldn't guard against a future badge accidentally doing so. Reused
  // as-is for BadgeGrid's own progress-hint calc below, not just
  // earnedBadges() — same fields either way.
  const statsForBadges = {
    bestStreak,
    totalPushes: stats.totalPushes,
    dayStreak: stats.dayStreak,
    bustedAtZero: stats.bustedAtZero,
    bustedAtOne: stats.bustedAtOne,
    moneyLifetimeCents: stats.moneyLifetimeCents,
    moneyBestRunCents: stats.moneyBestRunCents,
    moneyBestBankStreak: stats.moneyBestBankStreak,
    moneyReachedTop3Weekly: stats.moneyReachedTop3Weekly,
    moneyBankedAfterOnePush: stats.moneyBankedAfterOnePush,
    moneyBustedOver100: stats.moneyBustedOver100,
  };
  const earned = earnedBadges(statsForBadges);
  const earnedIds = new Set(earned.map((b) => b.id));
  // Guests never appear on the real leaderboard (see lib/storage.js's note),
  // so their flair is purely a local preview — logged-in players' flair is
  // the one that actually shows up for other people.
  const currentEmoji = user ? selectedEmoji : guestEmoji;
  // Guests can't own shop cosmetics (see cosmetics.js) — everything below
  // is null/empty for them, same "authStats is null while logged out"
  // reasoning every other money-mode field already follows. The
  // Cosmetics panel's three shop tabs show a "log in" message instead of
  // an empty picker in that case (see the render below).
  const activeAura = user ? authStats?.activeAura : null;
  const activePushSkin = user ? authStats?.activePushSkin : null;
  const activeRowStyle = user ? authStats?.activeRowStyle : null;
  const ownedCosmetics = user ? authStats?.ownedCosmetics ?? [] : [];
  const ownedPushSkins = user && authStats?.ownsDiamondButton ? ['diamond_button'] : [];
  // Guests can't buy shop upgrades either — see InsuranceBadge's own gate.
  const ownsInsurance = user ? !!authStats?.ownsInsurance : false;
  const ownedAuras = ownedCosmetics.filter((id) => id.startsWith('aura_'));
  const ownedRowStyles = ownedCosmetics.filter((id) => id.startsWith('row_'));

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

  // Shared by all three shop-cosmetic tabs below (push skin/name color/row
  // background) — set_active_cosmetic (see schema.sql) is the real
  // enforcement point, same "server never trusts the client's cached
  // owned/active state" reasoning as the shop's own purchase calls.
  // cosmeticId null unequips that slot, always succeeds.
  async function equipCosmetic(slot, cosmeticId) {
    if (equipBusy) return;
    setEquipBusy(true);
    playBadgeSelect();
    try {
      const { data, error } = await supabase.functions.invoke('set-active-cosmetic', { body: { slot, cosmeticId } });
      if (error || !data?.success) throw error ?? new Error('no response');
      await refreshMoneyStats();
    } catch (err) {
      console.error('equip cosmetic failed:', err);
    } finally {
      setEquipBusy(false);
    }
  }

  async function handleBadgeClick(badge) {
    const emoji = BADGE_EMOJI[badge.id];
    if (!emoji || !earnedIds.has(badge.id)) return;
    await setFlair(currentEmoji === emoji ? null : emoji);
  }

  // Split by achievementTab, same as PublicProfile.jsx's identical split —
  // normal-mode stats while viewing Normal Mode, money-mode stats while
  // viewing Money Mode, instead of one fixed panel regardless of which
  // badge grid is showing. "Today's Money" mirrors "Today's Streak"'s own
  // busted/live distinction: a busted run's earnings_cents is what was
  // LOST, not banked, so it reads as $0, same reasoning as
  // MoneyMode.jsx's own reveal and PublicProfile.jsx's tile.
  const streakStatTiles = [
    { label: "Today's Streak", value: todayStreak },
    { label: 'Best Streak', value: bestStreak },
    { label: 'Total Pushes', value: stats.totalPushes },
    { label: 'Day Streak', value: stats.dayStreak },
  ];
  const moneyStatTiles = [
    {
      label: "Today's Money",
      value: formatCents(todayMoneyRun?.status === 'dead' ? 0 : todayMoneyRun?.earnings_cents ?? 0),
    },
    { label: 'Most Banked', value: formatCents(stats.moneyBestRunCents) },
    { label: 'Weekly $', value: formatCents(stats.moneyWeeklyCents) },
    { label: 'Best Weekly $', value: formatCents(stats.moneyBestWeeklyCents) },
    { label: 'Lifetime $', value: formatCents(stats.moneyLifetimeCents) },
  ];
  const statTiles = achievementTab === 'money' && isAdmin ? moneyStatTiles : streakStatTiles;

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
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              {/* No streak badge here anymore — it's redundant with the nav
                  bar (always visible there regardless of page), and removing
                  it buys back exactly the width that was causing a max-length
                  username to hit the shrink floor and still need to truncate
                  on the narrowest phones. */}
              <h2
                ref={nameRef}
                className="gradient-title"
                style={{
                  fontSize: usernameFontSize,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  ...(activeAura ? auraStyle(activeAura) : {}),
                }}
              >
                {user ? user.user_metadata?.username || user.email : 'Guest'}
              </h2>
              {/* Same treatment PublicProfile.jsx gives everyone else's name —
                  your own header showed the username alone with no visual
                  confirmation of which flair (if any) is actually selected,
                  the one place on the whole site that couldn't show it. */}
              {currentEmoji && (
                <span ref={emojiRef} style={{ fontSize: 20, flexShrink: 0 }}>
                  {currentEmoji}
                </span>
              )}
            </div>
            <InsuranceBadge owns={ownsInsurance} />
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

      <StatTilesPanel tiles={statTiles} loading={statsLoading} />
      {/* Distinct from statsLoading — this is "the fetch actually failed,"
          not "still in flight." The tiles above still render (falling back
          to whatever stats/authStats already held), just possibly stale. */}
      {todayFetchError && (
        <div
          className="mono"
          style={{ fontSize: 11, color: 'var(--neon-red)', marginTop: -12, marginBottom: 20, padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,90,90,0.35)', background: 'rgba(255,90,90,0.06)' }}
        >
          Couldn't load today's stats — the numbers above may be out of date. Try refreshing the page.
        </div>
      )}

      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginBottom: 20 }}>
        <h3 style={{ fontSize: 15, marginBottom: 14 }}>Cosmetics</h3>
        <CosmeticTabs tabs={COSMETICS_TABS} active={cosmeticsTab} onChange={setCosmeticsTab} />

        {cosmeticsTab === 'flair' && (
          <>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
              {unlockedFlairs.length > 0
                ? 'Pick which badge shows next to your name on the leaderboard, or choose no flair:'
                : `Earn a rare-or-better badge to unlock a flair emoji — ${isTouch ? 'tap' : 'click'} it to show it next to your name on the leaderboard.`}
            </div>
            {/* The badge grid below still supports click-to-set/clear too
                (same setFlair underneath) — this quick-pick row is just a
                faster path that doesn't need scrolling to find the
                specific badge card. */}
            <EquipPicker
              items={unlockedFlairs}
              activeId={currentEmoji}
              onSelect={setFlair}
              renderItem={(emoji) => <span style={{ fontSize: 15 }}>{emoji}</span>}
              emptyMessage=""
            />
            {flairError && (
              <div className="mono" style={{ fontSize: 11, color: 'var(--neon-red)', marginTop: 8 }}>
                {flairError}
              </div>
            )}
          </>
        )}

        {cosmeticsTab === 'push_skin' && (
          <>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
              Which push-button skin shows in classic mode.
            </div>
            {!user ? (
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Log in to buy and equip cosmetics from the shop.
              </div>
            ) : (
              <EquipPicker
                items={ownedPushSkins}
                activeId={activePushSkin}
                onSelect={(id) => equipCosmetic('push_skin', id)}
                disabled={equipBusy}
                renderItem={() => <img src="/diamond-button.png" alt="" width={20} height={20} style={{ display: 'block' }} />}
                emptyMessage="Nothing owned yet — buy a push-button skin from the Shop to equip it here."
              />
            )}
          </>
        )}

        {cosmeticsTab === 'aura' && (
          <>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
              Which color your username shows in, everywhere it appears.
            </div>
            {!user ? (
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Log in to buy and equip cosmetics from the shop.
              </div>
            ) : (
              <EquipPicker
                items={ownedAuras}
                activeId={activeAura}
                onSelect={(id) => equipCosmetic('aura', id)}
                disabled={equipBusy}
                renderItem={(id) => <span style={{ fontWeight: 700, color: AURA_COLORS[id] }}>Aa</span>}
                emptyMessage="Nothing owned yet — buy a name color from the Shop to equip it here."
              />
            )}
          </>
        )}

        {cosmeticsTab === 'row_style' && (
          <>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 4 }}>
              Which background color highlights your row on the leaderboard.
            </div>
            {!user ? (
              <div className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                Log in to buy and equip cosmetics from the shop.
              </div>
            ) : (
              <EquipPicker
                items={ownedRowStyles}
                activeId={activeRowStyle}
                onSelect={(id) => equipCosmetic('row_style', id)}
                disabled={equipBusy}
                renderItem={(id) => (
                  <div style={{ width: 16, height: 16, borderRadius: '50%', background: ROW_STYLE_COLORS[id] }} />
                )}
                emptyMessage="Nothing owned yet — buy a row background from the Shop to equip it here."
              />
            )}
          </>
        )}
      </div>

      {/* TEMP admin gate, same reasoning as Leaderboard.jsx's money tab —
          a real player seeing this toggle at all would leak that money
          mode exists before it's ready, so it doesn't render otherwise.
          Sits right above the grid it controls ("at the bottom" of the
          page, where the achievement content itself lives), not above the
          Stats/Flair panels — those stay unified across both categories. */}
      {isAdmin && <AchievementTabToggle tab={achievementTab} onChange={setAchievementTab} />}

      <BadgeGrid
        gridRef={badgeGridRef}
        categories={BADGE_CATEGORIES.filter((cat) => cat.id.startsWith('money-') === (achievementTab === 'money'))}
        earnedIds={earnedIds}
        currentEmoji={currentEmoji}
        stats={statsForBadges}
        interactive
        onBadgeClick={handleBadgeClick}
        expandedBadgeId={expandedBadgeId}
        onToggleExpand={(id) => setExpandedBadgeId((prev) => (prev === id ? null : id))}
      />
    </div>
  );
}
