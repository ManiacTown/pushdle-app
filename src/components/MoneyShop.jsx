import { useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { spotlightMove } from '../lib/spotlight.js';
import { AURA_COLORS, ROW_STYLE_COLORS, COSMETIC_LABELS, COSMETIC_PRICES, COSMETIC_CATEGORIES, INSURANCE_PRICE_DIAMONDS } from '../lib/cosmetics.js';
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
const DIAMOND_BLUE = '#2bc8f7';
const DIAMOND_BUTTON_COST = 10;
const SHOP_TABS = [...COSMETIC_CATEGORIES.map((c) => ({ id: c.id, label: c.label })), { id: 'upgrades', label: 'Upgrades' }];

// One card shape shared by every item in this shop — buy-only now, so the
// only two states are "can't afford yet" / "Buy for N" and "✓ Bought".
// Diamond Button and Insurance render their own card bodies below (each
// has its own icon/description), but all THREE still share this exact
// owned/afford/buying logic — pulled out once here rather than repeated
// three times.
function useBuyState({ id, price, owned, diamonds, busyId }) {
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

// Aura ("Name Color") / row-style items — mechanically identical
// (purchase_cosmetic, just a different color source/slot), so this is the
// one place that card layout lives instead of two near-duplicate blocks.
function CosmeticCard({ id, slot, color, owned, diamonds, busyId, onBuy }) {
  const price = COSMETIC_PRICES[id];
  const { canAfford, busy } = useBuyState({ id, price, owned, diamonds, busyId });
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
  const [activeTab, setActiveTab] = useState('push_skin');
  // One shared busy id (rather than a boolean per section) so only the
  // specific button mid-request disables.
  const [busyId, setBusyId] = useState(null);
  const [shopError, setShopError] = useState(null);

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
  const { canAfford: canAffordInsurance, busy: buyingInsurance } = useBuyState({
    id: 'insurance',
    price: INSURANCE_PRICE_DIAMONDS,
    diamonds,
    busyId,
  });

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
    if (busyId || ownsInsurance || !canAffordInsurance) return;
    setBusyId('insurance');
    setShopError(null);
    try {
      const { data, error } = await supabase.functions.invoke('purchase-weekly-insurance');
      if (error || !data) throw error ?? new Error('no response');
      if (!data.success) setShopError("Couldn't complete that purchase.");
      await refreshMoneyStats();
    } catch (err) {
      console.error('purchase insurance failed:', err);
      setShopError("Couldn't complete that purchase.");
    } finally {
      setBusyId(null);
    }
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
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 6 }}>
          {/* Weekly bust insurance — not a cosmetic, no equip step, just
              owned or not (see resolve_money_push's bust branch in
              schema.sql for what owning it does). Its live armed/used
              status shows on the money-mode home screen instead of here —
              this card is purely the purchase, same Buy/Bought shape as
              every other item in this shop. Room for future minor
              gameplay-boosting upgrades alongside it in this same tab. */}
          <div
            className="badge-card"
            style={{
              background: '#06060a',
              border: `1px solid rgba(57,255,143,${ownsInsurance ? 0.5 : 0.25})`,
              borderRadius: 10,
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: 20, marginBottom: 4 }}>🛡️</div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginBottom: 3 }}>
              Weekly Bust Insurance
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginBottom: 5 }}>
              Once a week, a bust banks half your run instead of losing it all.
            </div>
            {ownsInsurance ? (
              <BoughtBadge color="var(--neon-green)" />
            ) : (
              <>
                <BuyButton price={INSURANCE_PRICE_DIAMONDS} canAfford={canAffordInsurance} busy={buyingInsurance} onClick={buyInsurance} color="var(--neon-green)" />
                {!canAffordInsurance && (
                  <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 4 }}>
                    Need {INSURANCE_PRICE_DIAMONDS - diamonds} more
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {shopError && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--neon-red)', marginTop: 10, textAlign: 'center' }}>
          {shopError}
        </div>
      )}
    </div>
  );
}
