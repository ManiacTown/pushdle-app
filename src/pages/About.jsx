import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { spotlightMove } from '../lib/spotlight.js';
import OddsBar from '../components/OddsBar.jsx';
import CosmeticTabs from '../components/CosmeticTabs.jsx';
import {
  SUCCESS_CHANCE,
  RARITY_META,
  BADGE_CATEGORIES,
  BADGES,
  PITY_BUST_THRESHOLD,
  PITY_CHARGES_NEEDED,
} from '../lib/game.js';
import {
  MONEY_SUCCESS_CHANCE,
  MONEY_GUARANTEED_PUSHES,
  MONEY_BONUS_EVERY,
  MONEY_BONUS_MIN_CENTS,
  MONEY_BONUS_MAX_CENTS,
  STREAK_BONUS_EXTRA_CENTS,
  DAREDEVIL_GUARANTEED_PUSHES,
  DAREDEVIL_SUCCESS_CHANCE,
  DAREDEVIL_MULTIPLIER,
  formatCents,
} from '../lib/money.js';
import {
  auraSwatchColor,
  auraBackground,
  rowStyleSwatchColor,
  rowStyleBackground,
  COSMETIC_LABELS,
  COSMETIC_PRICES,
  COSMETIC_CATEGORIES,
  INSURANCE_PRICE_DIAMONDS,
  STREAK_BONUS_PRICE_DIAMONDS,
  DAREDEVIL_PRICE_DIAMONDS,
} from '../lib/cosmetics.js';

const DIAMOND_BUTTON_COST = 10; // mirrors MoneyShop.jsx's own display-only mirror of purchase_diamond_button's price

const ABOUT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'money', label: 'Money Mode' },
  { id: 'other', label: 'Other' },
];

function SectionHeader({ icon, title }) {
  return (
    <h3 style={{ fontSize: 16, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 20 }}>{icon}</span> {title}
    </h3>
  );
}

// Small labeled swatch — reused for both the Name Color and Row Background
// shop categories below, same "one shape, two color sets" reasoning
// CosmeticCard in MoneyShop.jsx itself already follows. `color` is always
// a single representative hex (a fusion item's first stop — see
// auraSwatchColor/rowStyleSwatchColor) since it's used for the border,
// which can't render a gradient; `swatchBackground` is the real CSS
// background value shown in the dot itself (defaults to `color` for a
// plain item, but callers pass the true gradient for a fusion one — this
// reference page should show what the item actually looks like, not a
// flattened stand-in).
function ColorSwatch({ label, color, swatchBackground, price }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        background: '#06060a',
        border: `1px solid ${color}40`,
        borderRadius: 10,
        padding: '10px 8px',
      }}
    >
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: swatchBackground ?? color }} />
      <span className="mono" style={{ fontSize: 10, color: 'var(--text)' }}>{label}</span>
      <span className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 3 }}>
        <img src="/diamond.png" alt="" width={9} height={9} style={{ display: 'block' }} />
        {price}
      </span>
    </div>
  );
}

function OverviewTab() {
  return (
    <>
      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="🎯" title="How to play" />
        <OddsBar
          caption="Every push after your first rolls these odds — survive one more, or bust and start over tomorrow."
          chance={SUCCESS_CHANCE}
        />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginTop: 16 }}>
          <p style={{ marginBottom: 12 }}>
            Tap <strong style={{ color: 'var(--text)' }}>Push</strong>. Each press has a{' '}
            {Math.round(SUCCESS_CHANCE * 100)}% chance to keep your streak alive — until it
            doesn't. Your very first push of the day is guaranteed, so nobody busts immediately.
          </p>
          <p style={{ marginBottom: 12 }}>
            Your <strong style={{ color: 'var(--text)' }}>score</strong> is how many presses you
            survive in a row before you bust. The longer you go, the more you have to lose.
          </p>
          <p>
            <strong style={{ color: 'var(--text)' }}>One run per day.</strong> Once you bust (or
            choose to walk away), that's it until the next day resets.
          </p>
        </div>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="🏆" title="Leaderboard" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          <p style={{ marginBottom: 12 }}>
            Every logged-in run's streak is ranked against everyone else's for that day — top 3
            get a medal, and your own row is highlighted so you can always find yourself. It
            resets daily along with everyone's runs.
          </p>
          <p>
            Guest runs (no account) are tracked locally on your device only and never appear on
            the leaderboard — create an account to have your runs count.
          </p>
        </div>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="🏅" title="Badges & flair" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 16 }}>
          <p>
            Badges track your progress across four categories — clear a milestone once and it's
            yours for good:
          </p>
        </div>
        {/* auto-fit/minmax instead of a flat '1fr 1fr' — on a narrow enough
            phone, two fixed columns leaves the label and count touching
            edge-to-edge with zero breathing room (space-between has no
            slack left to distribute). This reflows to a single column
            once there isn't enough width for two, rather than squeezing. */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 18 }}>
          {BADGE_CATEGORIES.filter((cat) => !cat.id.startsWith('money')).map((cat) => {
            const count = BADGES.filter((b) => b.category === cat.id).length;
            return (
              <div
                key={cat.id}
                style={{
                  background: '#06060a',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{cat.label}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{count} badges</span>
              </div>
            );
          })}
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 12 }}>
          Every badge has a rarity tier, shown as a colored pill right on the badge:
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
          {Object.entries(RARITY_META).map(([key, meta]) => (
            <span
              key={key}
              className="badge-rarity"
              style={{ '--rarity-color': meta.color, fontSize: 10, padding: '4px 10px' }}
            >
              {meta.label}
            </span>
          ))}
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          Earn a <span style={{ color: RARITY_META.rare.color }}>rare</span>-or-better badge and
          you unlock its emoji as leaderboard flair — set it from your Profile page and it'll show
          up next to your name for everyone else to see.
        </div>
      </div>
    </>
  );
}

function MoneyModeTab() {
  return (
    <>
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ textAlign: 'center' }}>
        <h2 className="gradient-title" style={{ fontSize: 24, marginBottom: 6 }}>
          💰 Money Mode
        </h2>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 18 }}>
          Same nerve as classic. Real stakes.
        </p>
        <OddsBar
          chance={MONEY_SUCCESS_CHANCE}
          liveLabel="you keep it"
          liveColor="var(--neon-green)"
          liveBg="rgba(57,255,143,0.18)"
          caption="Every push rolls these odds — survive to keep pushing, or bust and lose whatever this run hasn't banked yet."
        />
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="💵" title="How it works" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8 }}>
          <p style={{ marginBottom: 12 }}>
            Same push-your-luck pressure as classic — except every push is worth{' '}
            <strong style={{ color: 'var(--text)' }}>$1</strong>, and you can{' '}
            <strong style={{ color: 'var(--text)' }}>cash out any time</strong> to bank it for good.
          </p>
          <p style={{ marginBottom: 12 }}>
            Bust and you only lose what THIS run hasn't banked yet — every dollar you've already
            cashed out stays yours no matter what. Requires an account; there's no guest path for
            Money Mode.
          </p>
          <p>
            Your first {MONEY_GUARANTEED_PUSHES} pushes each run are guaranteed, so nobody busts
            right out of the gate.
          </p>
        </div>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="💎" title="Diamonds & the combo bar" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 16 }}>
          <p style={{ marginBottom: 12 }}>
            Every {MONEY_BONUS_EVERY}th successful push fills the combo bar and pays out — either
            a random <strong style={{ color: 'var(--text)' }}>{formatCents(MONEY_BONUS_MIN_CENTS)}–{formatCents(MONEY_BONUS_MAX_CENTS)}</strong>{' '}
            cash bonus, or a rarer <strong style={{ color: 'var(--text)' }}>diamond</strong> instead.
          </p>
          <p>Diamonds are a separate currency from your dollar earnings — spend them in the shop below.</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <img src="/coin-transparent.png" alt="" width={36} height={36} style={{ display: 'block' }} />
          <span className="mono" style={{ fontSize: 16, color: 'var(--text-dim)' }}>or</span>
          <img src="/diamond.png" alt="" width={36} height={36} style={{ display: 'block' }} />
        </div>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="🛍" title="The shop" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 16 }}>
          Spend diamonds on cosmetics — purely visual, nothing here changes your odds:
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginBottom: 8, fontWeight: 700 }}>
          Push Button Skin
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <img src="/diamond-button.png" alt="" width={40} height={40} style={{ display: 'block' }} />
          <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
            Diamond Button — <img src="/diamond.png" alt="" width={10} height={10} style={{ display: 'block' }} /> {DIAMOND_BUTTON_COST}
          </span>
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginBottom: 8, fontWeight: 700 }}>
          Name Color
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 8, marginBottom: 18 }}>
          {COSMETIC_CATEGORIES.find((c) => c.id === 'aura').itemIds.map((id) => (
            <ColorSwatch
              key={id}
              label={COSMETIC_LABELS[id]}
              color={auraSwatchColor(id)}
              swatchBackground={auraBackground(id)}
              price={COSMETIC_PRICES[id]}
            />
          ))}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginBottom: 8, fontWeight: 700 }}>
          Row Background
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(70px, 1fr))', gap: 8 }}>
          {COSMETIC_CATEGORIES.find((c) => c.id === 'row_style').itemIds.map((id) => (
            <ColorSwatch
              key={id}
              label={COSMETIC_LABELS[id]}
              color={rowStyleSwatchColor(id)}
              swatchBackground={rowStyleBackground(id)}
              price={COSMETIC_PRICES[id]}
            />
          ))}
        </div>
        <div className="mono onboarding-note" style={{ marginTop: 18 }}>
          🛡️ The shop's Upgrades tab also has Weekly Bust Insurance, Streak Bonus, and Daredevil —
          see the Other tab for what each one does.
        </div>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="🏆" title="Weekly leaderboard" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 14 }}>
          Bank runs all week to climb it — top 3 win prizes. It tracks what you've banked{' '}
          <strong style={{ color: 'var(--text)' }}>this week only</strong>, and resets fresh every
          Monday.
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, fontSize: 26 }}>
          <span>🥇</span>
          <span>🥈</span>
          <span>🥉</span>
        </div>
      </div>

      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <SectionHeader icon="🏅" title="Money badges" />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 16 }}>
          Money Mode has its own badge categories, tracked separately from classic's:
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
          {BADGE_CATEGORIES.filter((cat) => cat.id.startsWith('money')).map((cat) => {
            const count = BADGES.filter((b) => b.category === cat.id).length;
            return (
              <div
                key={cat.id}
                style={{
                  background: '#06060a',
                  border: '1px solid var(--line)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                }}
              >
                <span className="mono" style={{ fontSize: 12, color: 'var(--text)' }}>{cat.label}</span>
                <span className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>{count} badges</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function OtherTab({ insuranceRef, streakBonusRef, daredevilRef }) {
  return (
    <>
      <div className="panel spotlight" onMouseMove={spotlightMove}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h2 className="gradient-title" style={{ fontSize: 24, marginBottom: 6 }}>
            🍀 Comeback Boost
          </h2>
          <p className="mono" style={{ fontSize: 12, color: 'var(--neon-green)' }}>
            A little help when luck isn't on your side.
          </p>
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 18 }}>
          <p style={{ marginBottom: 10 }}>
            Bust at streak <strong style={{ color: 'var(--text)' }}>{PITY_BUST_THRESHOLD} or under</strong>,{' '}
            {PITY_CHARGES_NEEDED} times in a row, and a meter builds up a{' '}
            <strong style={{ color: 'var(--text)' }}>Comeback Boost</strong> for your next classic
            run.
          </p>
          <p>
            Once it's full, that next run gets a{' '}
            <strong style={{ color: 'var(--text)' }}>boost in luck</strong> to help you get back on
            track — just play it out. It only fires once, then resets on its own. Classic mode,
            registered accounts only.
          </p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <div className="pity-meter">
            <div className="pity-meter-track">
              <div className="pity-meter-fill pity-meter-fill--armed" style={{ width: '100%' }} />
            </div>
            <div className="mono pity-meter-label">Comeback Boost armed for this run</div>
          </div>
        </div>
      </div>

      <div ref={insuranceRef} className="panel spotlight" onMouseMove={spotlightMove}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h2 className="gradient-title" style={{ fontSize: 24, marginBottom: 6 }}>
            🛡️ Weekly Bust Insurance
          </h2>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            A safety net for one bad Money Mode run a week.
          </p>
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 18 }}>
          <p style={{ marginBottom: 10 }}>
            Once a week, a Money Mode bust banks{' '}
            <strong style={{ color: 'var(--text)' }}>half this run's earnings</strong> instead of
            losing all of it. Buy it in the shop's Upgrades tab for{' '}
            <img src="/diamond.png" alt="" width={11} height={11} style={{ display: 'inline-block', verticalAlign: 'middle' }} />{' '}
            <strong style={{ color: 'var(--text)' }}>{INSURANCE_PRICE_DIAMONDS}</strong>, and it
            re-arms automatically once used.
          </p>
          <p>
            Insurance, Streak Bonus, and Daredevil are three separate upgrades, but only{' '}
            <strong style={{ color: 'var(--text)' }}>one can be active</strong> at a time — buy as
            many as you like. The first time you enter Money Mode each week, you'll be asked to
            pick one (or none) for that week; it's locked in from there until the next Monday reset.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <img src="/shield.png" alt="" width={32} height={32} style={{ display: 'block' }} />
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--neon-green)',
              border: '1px solid rgba(57,255,143,0.4)',
              borderRadius: 20,
              padding: '5px 12px',
            }}
          >
            Insurance armed
          </span>
        </div>
      </div>

      <div ref={streakBonusRef} className="panel spotlight" onMouseMove={spotlightMove}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h2 className="gradient-title" style={{ fontSize: 24, marginBottom: 6 }}>
            💲 Streak Bonus
          </h2>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Extra cash every time the combo bar fills.
          </p>
        </div>
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 18 }}>
          <p>
            Every {MONEY_BONUS_EVERY}th successful push fills the combo bar — with Streak Bonus
            active, that fill pays an extra{' '}
            <strong style={{ color: 'var(--text)' }}>{formatCents(STREAK_BONUS_EXTRA_CENTS)}</strong>{' '}
            on top, whether the bar landed on cash or a diamond that time. Buy it in the shop's
            Upgrades tab for{' '}
            <img src="/diamond.png" alt="" width={11} height={11} style={{ display: 'inline-block', verticalAlign: 'middle' }} />{' '}
            <strong style={{ color: 'var(--text)' }}>{STREAK_BONUS_PRICE_DIAMONDS}</strong>.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <span style={{ fontSize: 28 }}>💲</span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: '#ffd45e',
              border: '1px solid rgba(255,212,94,0.4)',
              borderRadius: 20,
              padding: '5px 12px',
            }}
          >
            Streak Bonus Activated
          </span>
        </div>
      </div>

      <div ref={daredevilRef} className="panel spotlight" onMouseMove={spotlightMove}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}>
          <h2 className="gradient-title" style={{ fontSize: 24, marginBottom: 6 }}>
            😈 Daredevil
          </h2>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            Shorter guarantee, worse odds, double money.
          </p>
        </div>
        <OddsBar
          chance={DAREDEVIL_SUCCESS_CHANCE}
          liveLabel="you keep it"
          liveColor="var(--neon-red)"
          liveBg="rgba(255,45,109,0.18)"
          caption={`Only your first ${DAREDEVIL_GUARANTEED_PUSHES} pushes are guaranteed (down from ${MONEY_GUARANTEED_PUSHES}) — every push after rolls these odds instead of the normal ${Math.round(MONEY_SUCCESS_CHANCE * 100)}%.`}
        />
        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginTop: 16, marginBottom: 18 }}>
          <p>
            In exchange, every dollar you earn — the base $1 per push and any{' '}
            {formatCents(MONEY_BONUS_MIN_CENTS)}–{formatCents(MONEY_BONUS_MAX_CENTS)} combo bonus —
            is worth <strong style={{ color: 'var(--text)' }}>{DAREDEVIL_MULTIPLIER}×</strong> while
            it's active. Diamonds from the combo bar are unaffected. Buy it in the shop's Upgrades
            tab for{' '}
            <img src="/diamond.png" alt="" width={11} height={11} style={{ display: 'inline-block', verticalAlign: 'middle' }} />{' '}
            <strong style={{ color: 'var(--text)' }}>{DAREDEVIL_PRICE_DIAMONDS}</strong>.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <span style={{ fontSize: 28 }}>😈</span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--neon-red)',
              border: '1px solid rgba(255,45,109,0.4)',
              borderRadius: 20,
              padding: '5px 12px',
            }}
          >
            Daredevil Mode
          </span>
        </div>
      </div>
    </>
  );
}

export default function About() {
  // Only ever set by MoneyShop.jsx's per-upgrade info buttons
  // ({ tab: 'other', scrollToUpgrade: 'insurance' | 'streak_bonus' |
  // 'daredevil' }) — lazy-initialized so the right tab renders on the very
  // first paint instead of flashing Overview then switching, same reasoning
  // Leaderboard.jsx's own location.state-driven initial tab uses.
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(() => (location.state?.tab === 'money' || location.state?.tab === 'other' ? location.state.tab : 'overview'));
  const insuranceRef = useRef(null);
  const streakBonusRef = useRef(null);
  const daredevilRef = useRef(null);

  // Scrolls to the specific upgrade section within the (already-selected,
  // via the lazy useState above) Other tab — same "land at the top instantly,
  // then glide down via rAF once this render's DOM is actually laid out"
  // pattern as Profile.jsx's own scrollToBadges effect.
  useEffect(() => {
    const target = location.state?.scrollToUpgrade;
    const ref = target === 'insurance' ? insuranceRef : target === 'streak_bonus' ? streakBonusRef : target === 'daredevil' ? daredevilRef : null;
    if (!ref) return;
    window.scrollTo(0, 0);
    requestAnimationFrame(() => {
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, [location.state]);

  function changeTab(id) {
    if (id === activeTab) return;
    setActiveTab(id);
    // "Money Mode"/"Other" are each several panels tall — jumping back to
    // the top on every switch is what makes this read as "go to that
    // section" rather than leaving a reader who scrolled halfway through
    // Overview stranded mid-scroll in whatever the new tab's content
    // happens to have at that same pixel offset.
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="panel spotlight" onMouseMove={spotlightMove} style={{ textAlign: 'center' }}>
        <h2 className="gradient-title" style={{ fontSize: 26, marginBottom: 8 }}>About Pushdle</h2>
        <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>
          A daily push-your-luck game. Tap the button, keep your streak alive, don't get greedy.
        </p>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <CosmeticTabs tabs={ABOUT_TABS} active={activeTab} onChange={changeTab} />
        </div>
      </div>

      {activeTab === 'overview' && <OverviewTab />}
      {activeTab === 'money' && <MoneyModeTab />}
      {activeTab === 'other' && <OtherTab insuranceRef={insuranceRef} streakBonusRef={streakBonusRef} daredevilRef={daredevilRef} />}
    </div>
  );
}
