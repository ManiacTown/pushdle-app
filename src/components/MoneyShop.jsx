import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { spotlightMove } from '../lib/spotlight.js';
import { playNav } from '../lib/sound.js';
import {
  AURA_COLORS,
  ROW_STYLE_COLORS,
  COSMETIC_LABELS,
  COSMETIC_PRICES,
  COSMETIC_CATEGORIES,
  INSURANCE_PRICE_DIAMONDS,
  STREAK_BONUS_PRICE_DIAMONDS,
  DAREDEVIL_PRICE_DIAMONDS,
} from '../lib/cosmetics.js';
import { STREAK_BONUS_EXTRA_CENTS, DAREDEVIL_GUARANTEED_PUSHES, DAREDEVIL_SUCCESS_CHANCE, DAREDEVIL_MULTIPLIER, formatCents } from '../lib/money.js';
import CosmeticTabs from './CosmeticTabs.jsx';

// Buy-only shop, tabbed by category (see cosmetics.js's COSMETIC_CATEGORIES
// for the three equip-style tabs this shares with Profile.jsx's Cosmetics
// section, plus its own "Upgrades" tab for non-cosmetic purchases like
// insurance). Nothing here EQUIPS anything anymore — every item is just
// "Buy" -> "✓ Bought", full stop; picking which owned item is actually
// active in each slot moved entirely to Profile.jsx's Cosmetics tabs. That
// split (shop = acquire, profile = equip) is deliberate, not incidental —
// it's what let the shop drop equip state/buttons entirely and just be a
// catalog.
//
// The one deliberate exception: the Upgrades tab's three cards (Insurance/
// Streak Bonus/Daredevil) ALSO have an Activate control, right here rather
// than in Profile.jsx — see cosmetics.js's own comment on why they don't
// fit Profile's three-slot equip-picker shape, and active_money_upgrade's
// comment in schema.sql for why only one of the three can ever be active.
const DIAMOND_BLUE = '#2bc8f7';
const DIAMOND_BUTTON_COST = 10;
const SHOP_TABS = [...COSMETIC_CATEGORIES.map((c) => ({ id: c.id, label: c.label })), { id: 'upgrades', label: 'Upgrades' }];

// One card shape shared by every item in this shop — buy-only now, so the
// only two states are "can't afford yet" / "Buy for N" and "✓ Bought".
// Diamond Button and Insurance render their own card bodies below (each
// has its own icon/description), but all THREE still share this exact
// owned/afford/buying logic — pulled out once here rather than repeated
// three times.
function useBuyState({ id, price, diamonds, busyId }) {
  const canAfford = diamonds >= price;
  const busy = busyId === id;
  return { canAfford, busy };
}

function BuyButton({ price, canAfford, busy, onClick, color = DIAMOND_BLUE }) {
  return (
    <button
      className="btn-ghost"
      disabled={busy || !canAfford}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10,
        fontWeight: 700,
        padding: '3px 8px',
        color: canAfford ? color : 'var(--text-dim)',
        borderColor: canAfford ? color : 'var(--line)',
        opacity: busy ? 0.6 : 1,
        cursor: canAfford ? 'pointer' : 'not-allowed',
      }}
    >
      <img src="/diamond.png" alt="" width={10} height={10} style={{ display: 'block' }} />
      {busy ? 'Buying…' : `Buy for ${price}`}
    </button>
  );
}

function BoughtBadge({ color = DIAMOND_BLUE }) {
  return (
    <div
      className="mono"
      style={{ fontSize: 10, fontWeight: 700, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}
    >
      ✓ Bought
    </div>
  );
}

// Only ever shown once an Upgrades-tab item is owned — toggles that item
// on/off in the single active_money_upgrade slot (see schema.sql). Clicking
// while already active deactivates it (onClick passes null in that case),
// same "click again to clear" shape as MoneyShop's old equip pickers used
// to have before equip moved to Profile.jsx — this is the one place that
// pattern still lives, for the reason this file's own header comment gives.
// `locked` (see upgradeChoiceLocked above) disables it entirely once this
// week's choice has already been made — the button still shows "✓ Active"
// for whichever upgrade IS active (so the shop still tells you what's
// running), just non-interactive; a non-active card shows "🔒 Locked"
// instead of "Activate" so it's clear WHY clicking does nothing, rather
// than looking like a dead button.
function ActivateButton({ isActive, locked, busy, onClick, color }) {
  return (
    <button
      className="btn-ghost"
      disabled={busy || locked}
      onClick={onClick}
      style={{
        marginTop: 6,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.04em',
        padding: '3px 8px',
        color: isActive ? color : 'var(--text-dim)',
        borderColor: isActive ? color : 'var(--line)',
        background: isActive ? `${color}1a` : undefined,
        opacity: busy ? 0.6 : locked && !isActive ? 0.5 : 1,
        cursor: locked ? 'not-allowed' : 'pointer',
      }}
    >
      {busy ? '…' : isActive ? '✓ Active' : locked ? '🔒 Locked' : 'Activate'}
    </button>
  );
}

// Tiny deep-link to the matching explanation on the About page's Other tab
// (see About.jsx's own scrollToUpgrade effect) — reuses the same
// question-mark.png icon as NavBar's "How to play" link, for the same
// "this icon means more info lives elsewhere" visual language. Absolutely
// positioned in each UpgradeCard's own top-right corner so it doesn't
// disturb that card's centered content flow.
function InfoButton({ onClick }) {
  return (
    <button
      className="btn-ghost"
      onClick={onClick}
      title="Learn more"
      style={{
        position: 'absolute',
        top: 5,
        right: 5,
        padding: 0,
        width: 16,
        height: 16,
        minWidth: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '50%',
      }}
    >
      <img src="/question-mark.png" alt="Learn more" width={9} height={9} style={{ display: 'block' }} />
    </button>
  );
}

// Shared card shape for all three Upgrades-tab items (Insurance/Streak
// Bonus/Daredevil) — mechanically identical (a purchase_* RPC + the shared
// set_active_money_upgrade equip RPC), just different icon/copy/color, same
// "one card layout, not three near-duplicates" reasoning CosmeticCard above
// already follows for auras/row styles.
// `color` must be a literal hex string (e.g. '#39ff8f'), not a CSS
// var(--...) — this and ActivateButton both append a hex alpha suffix
// straight onto it for the border/background, which only produces a valid
// color when `color` itself is already hex.
function UpgradeCard({
  id,
  icon,
  title,
  description,
  price,
  owned,
  isActive,
  locked,
  justPurchased,
  diamonds,
  busyId,
  onBuy,
  onSetActive,
  onActivateNow,
  onDismissPrompt,
  onInfo,
  color,
}) {
  const { canAfford, busy } = useBuyState({ id, price, diamonds, busyId });
  const activateBusy = busyId === `${id}-activate`;
  return (
    <div
      className="badge-card"
      style={{
        position: 'relative',
        background: '#06060a',
        border: `1px solid ${color}${owned ? '80' : '40'}`,
        borderRadius: 10,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      <InfoButton onClick={() => onInfo(id)} />
      <div style={{ marginBottom: 4 }}>{icon}</div>
      <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginBottom: 3 }}>
        {title}
      </div>
      <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 5 }}>
        {description}
      </div>
      {justPurchased ? (
        // Nothing was active at the moment this got bought — a one-time
        // activate-or-not choice right here, instead of leaving it sitting
        // owned until the next weekly modal or an unlocked shop visit. See
        // MoneyShop.jsx's confirmActivateFromPrompt/dismissPostPurchasePrompt
        // for what each button actually does; the warning text is shown
        // UP FRONT, before the activate click, not as a second confirm step.
        <div style={{ width: '100%' }}>
          <BoughtBadge color={color} />
          <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', lineHeight: 1.5, marginTop: 6, marginBottom: 8 }}>
            Activate now?{' '}
            <strong style={{ color: 'var(--text)' }}>
              Once active, it can't be turned off until next week's reset.
            </strong>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
            <button className="btn-ghost" disabled={activateBusy} onClick={onDismissPrompt} style={{ fontSize: 9, padding: '3px 8px' }}>
              Not now
            </button>
            <button
              className="btn-ghost"
              disabled={activateBusy}
              onClick={() => onActivateNow(id)}
              style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', color, borderColor: color, background: `${color}1a` }}
            >
              {activateBusy ? '…' : 'Yes, activate'}
            </button>
          </div>
        </div>
      ) : owned ? (
        <>
          <BoughtBadge color={color} />
          <ActivateButton isActive={isActive} locked={locked} busy={activateBusy} onClick={() => onSetActive(isActive ? null : id)} color={color} />
        </>
      ) : (
        <>
          <BuyButton price={price} canAfford={canAfford} busy={busy} onClick={() => onBuy(id)} color={color} />
          {!canAfford && (
            <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
              Need {price - diamonds} more
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Aura ("Name Color") / row-style items — mechanically identical
// (purchase_cosmetic, just a different color source/slot), so this is the
// one place that card layout lives instead of two near-duplicate blocks.
function CosmeticCard({ id, slot, color, owned, diamonds, busyId, onBuy }) {
  const price = COSMETIC_PRICES[id];
  const { canAfford, busy } = useBuyState({ id, price, diamonds, busyId });
  return (
    <div
      className="badge-card"
      style={{
        background: '#06060a',
        border: `1px solid ${color}${owned ? '80' : '40'}`,
        borderRadius: 10,
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
      }}
    >
      {/* Swatch preview — a plain filled circle for row items (a row style
          IS just a flat background tint, so the swatch matches exactly);
          for name-color items, the same solid color applied to a couple of
          sample letters, since that's genuinely what it does to a username. */}
      {slot === 'aura' ? (
        <div
          className="mono"
          style={{
            height: 20,
            marginBottom: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            fontWeight: 700,
            color,
          }}
        >
          Aa
        </div>
      ) : (
        <div style={{ width: 20, height: 20, borderRadius: '50%', marginBottom: 4, background: color }} />
      )}
      <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginBottom: 5 }}>
        {COSMETIC_LABELS[id]}
      </div>
      {owned ? (
        <BoughtBadge color={color} />
      ) : (
        <>
          <BuyButton price={price} canAfford={canAfford} busy={busy} onClick={() => onBuy(id)} color={color} />
          {!canAfford && (
            <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
              Need {price - diamonds} more
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function MoneyShop({ onClose }) {
  const { stats, refreshMoneyStats } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('push_skin');
  // One shared busy id (rather than a boolean per section) so only the
  // specific button mid-request disables.
  const [busyId, setBusyId] = useState(null);
  const [shopError, setShopError] = useState(null);
  // Which upgrade (if any) was just bought while NOTHING was active — see
  // buyInsurance/buyStreakBonus/buyDaredevil below for where this gets set,
  // and UpgradeCard's own comment for why this is the one place a fresh
  // purchase gets an immediate activate-or-not choice instead of just
  // sitting owned. Cleared the moment that choice is made either way.
  const [postPurchasePromptId, setPostPurchasePromptId] = useState(null);

  const diamonds = stats?.moneyDiamonds ?? 0;
  const ownedCosmetics = stats?.ownedCosmetics ?? [];
  const ownsDiamondButtonSkin = !!stats?.ownsDiamondButton;
  const { canAfford: canAffordDiamondButton, busy: buyingDiamondButton } = useBuyState({
    id: 'diamond_button',
    price: DIAMOND_BUTTON_COST,
    diamonds,
    busyId,
  });

  const ownsInsurance = !!stats?.ownsInsurance;
  const ownsStreakBonus = !!stats?.ownsStreakBonus;
  const ownsDaredevil = !!stats?.ownsDaredevil;
  const activeMoneyUpgrade = stats?.activeMoneyUpgrade ?? null;
  // Once this account has made its ONE choice for the current money week
  // (see money_upgrade_choice_seen's own comment in schema.sql — either via
  // MoneyUpgradeChoiceModal.jsx or a direct change here while still
  // unlocked), Activate is locked until the next Monday reset reopens it.
  // `!= false` (not `=== true`) so this defaults to locked while stats are
  // still loading (null) — the moment-of-mount flash of an unlocked button
  // that then locks itself is worse than briefly showing locked.
  const upgradeChoiceLocked = stats?.moneyUpgradeChoiceSeen !== false;

  // purchase_diamond_button (see schema.sql) is the real enforcement point
  // — balance/already-owned checks both happen there, not here.
  async function buyDiamondButton() {
    if (busyId || ownsDiamondButtonSkin || !canAffordDiamondButton) return;
    setBusyId('diamond_button');
    setShopError(null);
    try {
      const { data, error } = await supabase.functions.invoke('buy-diamond-button');
      if (error || !data) throw error ?? new Error('no response');
      if (!data.success) setShopError("Couldn't complete that purchase.");
      await refreshMoneyStats();
    } catch (err) {
      console.error('buy diamond button failed:', err);
      setShopError("Couldn't complete that purchase.");
    } finally {
      setBusyId(null);
    }
  }

  // purchase_cosmetic (see schema.sql) is the real enforcement point, same
  // reasoning as buyDiamondButton above — shared by every aura/row-style
  // card via CosmeticCard's onBuy prop.
  async function buyCosmetic(id) {
    if (busyId || ownedCosmetics.includes(id)) return;
    setBusyId(id);
    setShopError(null);
    try {
      const { data, error } = await supabase.functions.invoke('purchase-cosmetic', { body: { cosmeticId: id } });
      if (error || !data) throw error ?? new Error('no response');
      if (!data.success) setShopError("Couldn't complete that purchase.");
      await refreshMoneyStats();
    } catch (err) {
      console.error('purchase cosmetic failed:', err);
      setShopError("Couldn't complete that purchase.");
    } finally {
      setBusyId(null);
    }
  }

  async function buyInsurance() {
    if (busyId || ownsInsurance) return;
    setBusyId('insurance');
    setShopError(null);
    try {
      const { data, error } = await supabase.functions.invoke('purchase-weekly-insurance');
      if (error || !data) throw error ?? new Error('no response');
      if (!data.success) setShopError("Couldn't complete that purchase.");
      // Nothing was running before this purchase — offer an immediate
      // activate-or-not choice instead of leaving it just sitting owned
      // (see postPurchasePromptId's own comment above).
      else if (activeMoneyUpgrade === null) setPostPurchasePromptId('insurance');
      await refreshMoneyStats();
    } catch (err) {
      console.error('purchase insurance failed:', err);
      setShopError("Couldn't complete that purchase.");
    } finally {
      setBusyId(null);
    }
  }

  // purchase_streak_bonus/purchase_daredevil (see schema.sql) are the real
  // enforcement points, same reasoning as buyInsurance above — one-time
  // purchases, activating what's bought is a separate step (setActiveUpgrade
  // below).
  async function buyStreakBonus() {
    if (busyId || ownsStreakBonus) return;
    setBusyId('streak_bonus');
    setShopError(null);
    try {
      const { data, error } = await supabase.functions.invoke('purchase-streak-bonus');
      if (error || !data) throw error ?? new Error('no response');
      if (!data.success) setShopError("Couldn't complete that purchase.");
      else if (activeMoneyUpgrade === null) setPostPurchasePromptId('streak_bonus');
      await refreshMoneyStats();
    } catch (err) {
      console.error('purchase streak bonus failed:', err);
      setShopError("Couldn't complete that purchase.");
    } finally {
      setBusyId(null);
    }
  }

  async function buyDaredevil() {
    if (busyId || ownsDaredevil) return;
    setBusyId('daredevil');
    setShopError(null);
    try {
      const { data, error } = await supabase.functions.invoke('purchase-daredevil');
      if (error || !data) throw error ?? new Error('no response');
      if (!data.success) setShopError("Couldn't complete that purchase.");
      else if (activeMoneyUpgrade === null) setPostPurchasePromptId('daredevil');
      await refreshMoneyStats();
    } catch (err) {
      console.error('purchase daredevil failed:', err);
      setShopError("Couldn't complete that purchase.");
    } finally {
      setBusyId(null);
    }
  }

  // set_active_money_upgrade (see schema.sql) is the real enforcement point
  // — ownership is re-checked there, not here. upgrade null deactivates
  // whichever one is currently active; shared by all three UpgradeCard
  // instances via their onSetActive prop. Uses a distinct `${id}-activate`
  // busy id so this can't disable/be disabled by an in-flight purchase on
  // the same card (they're never actually simultaneous — Buy disappears the
  // moment an item is owned — but keeping them distinct avoids relying on
  // that timing). `force` skips the upgradeChoiceLocked check — used
  // ONLY by the post-purchase "activate now?" prompt below, since buying
  // something new while nothing is active is a deliberate exception to the
  // weekly lock (there's no "switch" happening, just filling an empty
  // slot for the first time), not a loophole around it.
  async function setActiveUpgrade(upgrade, { force = false } = {}) {
    // Defense in depth — the button itself is already disabled while
    // locked (see upgradeChoiceLocked), this just backstops a stale click.
    if (upgradeChoiceLocked && !force) return;
    const busyKey = `${upgrade ?? activeMoneyUpgrade}-activate`;
    if (busyId) return;
    setBusyId(busyKey);
    setShopError(null);
    try {
      const { data, error } = await supabase.functions.invoke('set-active-money-upgrade', { body: { upgrade } });
      if (error || !data) throw error ?? new Error('no response');
      if (!data.success) setShopError("Couldn't activate that upgrade.");
      await refreshMoneyStats();
    } catch (err) {
      console.error('set active money upgrade failed:', err);
      setShopError("Couldn't activate that upgrade.");
    } finally {
      setBusyId(null);
    }
  }

  // The two answers to the post-purchase "activate now?" prompt (see
  // postPurchasePromptId above and UpgradeCard's own comment) — Activate
  // goes through the same real RPC as every other activation, just forced
  // past the weekly lock; Not Now just clears the prompt and leaves the
  // fresh purchase owned-but-inactive, subject to the normal lock from here
  // on same as if it had never shown.
  async function confirmActivateFromPrompt(id) {
    setPostPurchasePromptId(null);
    await setActiveUpgrade(id, { force: true });
  }
  function dismissPostPurchasePrompt() {
    setPostPurchasePromptId(null);
  }

  // Deep-links to the matching About-page explanation (see About.jsx's own
  // scrollToUpgrade effect) — shared onInfo prop for all three UpgradeCard
  // instances.
  function goToUpgradeInfo(upgrade) {
    playNav();
    navigate('/about', { state: { tab: 'other', scrollToUpgrade: upgrade } });
  }

  const auraCategory = COSMETIC_CATEGORIES.find((c) => c.id === 'aura');
  const rowCategory = COSMETIC_CATEGORIES.find((c) => c.id === 'row_style');

  return (
    <div
      className="panel spotlight"
      onMouseMove={spotlightMove}
      style={{
        marginTop: 16,
        maxWidth: 460,
        marginLeft: 'auto',
        marginRight: 'auto',
        // A distinct diamond-blue border (not .panel's own plain
        // var(--line) default) so the shop reads as its own bordered
        // module against the run/wallet panels around it, not just
        // another same-toned panel in the stack.
        border: '1px solid rgba(43,200,247,0.45)',
        boxShadow: '0 0 24px rgba(43,200,247,0.08)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div
          className="mono"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: DIAMOND_BLUE,
          }}
        >
          <img src="/diamond.png" alt="" width={14} height={14} style={{ display: 'block' }} />
          Shop
        </div>
        <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
        <img src="/diamond.png" alt="" width={16} height={16} style={{ display: 'block' }} />
        Diamonds: <span style={{ color: DIAMOND_BLUE, fontWeight: 700 }}>{diamonds}</span>
      </div>

      <CosmeticTabs tabs={SHOP_TABS} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'push_skin' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6 }}>
          <div
            className="badge-card"
            style={{
              background: '#06060a',
              border: `1px solid rgba(43,200,247,${ownsDiamondButtonSkin ? 0.5 : 0.25})`,
              borderRadius: 10,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <img src="/diamond-button.png" alt="" width={36} height={36} style={{ display: 'block', marginBottom: 4 }} />
            <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginBottom: 5 }}>
              {COSMETIC_LABELS.diamond_button}
            </div>
            {ownsDiamondButtonSkin ? (
              <BoughtBadge />
            ) : (
              <>
                <BuyButton price={DIAMOND_BUTTON_COST} canAfford={canAffordDiamondButton} busy={buyingDiamondButton} onClick={buyDiamondButton} />
                {!canAffordDiamondButton && (
                  <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
                    Need {DIAMOND_BUTTON_COST - diamonds} more
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'aura' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 6 }}>
          {auraCategory.itemIds.map((id) => (
            <CosmeticCard
              key={id}
              id={id}
              slot="aura"
              color={AURA_COLORS[id]}
              owned={ownedCosmetics.includes(id)}
              diamonds={diamonds}
              busyId={busyId}
              onBuy={buyCosmetic}
            />
          ))}
        </div>
      )}

      {activeTab === 'row_style' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 6 }}>
          {rowCategory.itemIds.map((id) => (
            <CosmeticCard
              key={id}
              id={id}
              slot="row_style"
              color={ROW_STYLE_COLORS[id]}
              owned={ownedCosmetics.includes(id)}
              diamonds={diamonds}
              busyId={busyId}
              onBuy={buyCosmetic}
            />
          ))}
        </div>
      )}

      {activeTab === 'upgrades' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6 }}>
            {/* Three mutually-exclusive gameplay upgrades — see this file's
                own header comment for why these (alone, among everything
                else in this shop) get an Activate control right on their
                cards. Own as many as you like; set_active_money_upgrade only
                ever lets one be active at a time, and locks (see
                upgradeChoiceLocked above) the moment that choice is made
                for the week — MoneyUpgradeChoiceModal.jsx is the other
                place that same choice gets made, first thing each week. */}
            <UpgradeCard
              id="insurance"
              icon={<img src="/shield.png" alt="" width={20} height={20} style={{ display: 'block' }} />}
              title="Weekly Bust Insurance"
              description="Once a week, a bust banks half your run instead of losing it all."
              price={INSURANCE_PRICE_DIAMONDS}
              owned={ownsInsurance}
              isActive={activeMoneyUpgrade === 'insurance'}
              locked={upgradeChoiceLocked}
              justPurchased={postPurchasePromptId === 'insurance'}
              diamonds={diamonds}
              busyId={busyId}
              onBuy={buyInsurance}
              onSetActive={setActiveUpgrade}
              onActivateNow={confirmActivateFromPrompt}
              onDismissPrompt={dismissPostPurchasePrompt}
              onInfo={goToUpgradeInfo}
              color="#39ff8f"
            />
            <UpgradeCard
              id="streak_bonus"
              icon={<span style={{ fontSize: 20 }}>💲</span>}
              title="Streak Bonus"
              description={`Every combo-bar fill pays an extra ${formatCents(STREAK_BONUS_EXTRA_CENTS)}, cash or diamond either way.`}
              price={STREAK_BONUS_PRICE_DIAMONDS}
              owned={ownsStreakBonus}
              isActive={activeMoneyUpgrade === 'streak_bonus'}
              locked={upgradeChoiceLocked}
              justPurchased={postPurchasePromptId === 'streak_bonus'}
              diamonds={diamonds}
              busyId={busyId}
              onBuy={buyStreakBonus}
              onSetActive={setActiveUpgrade}
              onActivateNow={confirmActivateFromPrompt}
              onDismissPrompt={dismissPostPurchasePrompt}
              onInfo={goToUpgradeInfo}
              color="#ffd45e"
            />
            <UpgradeCard
              id="daredevil"
              icon={<span style={{ fontSize: 20 }}>😈</span>}
              title="Daredevil"
              description={`Only ${DAREDEVIL_GUARANTEED_PUSHES} guaranteed pushes, ${Math.round(DAREDEVIL_SUCCESS_CHANCE * 100)}% after — but ${DAREDEVIL_MULTIPLIER}× money.`}
              price={DAREDEVIL_PRICE_DIAMONDS}
              owned={ownsDaredevil}
              isActive={activeMoneyUpgrade === 'daredevil'}
              locked={upgradeChoiceLocked}
              justPurchased={postPurchasePromptId === 'daredevil'}
              diamonds={diamonds}
              busyId={busyId}
              onBuy={buyDaredevil}
              onSetActive={setActiveUpgrade}
              onActivateNow={confirmActivateFromPrompt}
              onDismissPrompt={dismissPostPurchasePrompt}
              onInfo={goToUpgradeInfo}
              color="#ff2d6d"
            />
          </div>
          {!postPurchasePromptId && upgradeChoiceLocked && (ownsInsurance || ownsStreakBonus || ownsDaredevil) && (
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 10, textAlign: 'center' }}>
              🔒 This week's upgrade is locked in — the next Monday reset opens it back up.
            </div>
          )}
        </>
      )}

      {shopError && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--neon-red)', marginTop: 10, textAlign: 'center' }}>
          {shopError}
        </div>
      )}
    </div>
  );
}
