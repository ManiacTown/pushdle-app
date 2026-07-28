import { useState } from 'react';
import { useAuth } from '../lib/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';
import { spotlightMove } from '../lib/spotlight.js';

// v1 shell — cosmetic-only shop scope. One real purchase so far (the
// diamond button below, see purchase_diamond_button in schema.sql); the
// other two are still inert "coming soon" placeholders. Reuses
// .badge-card's hover/scale treatment for the item cards, same visual
// language as Profile.jsx's badge grid, just with a price pill instead of
// a rarity pill.
//
// Diamond blue — sampled off public/diamond.png's own facet colors, kept
// deliberately distinct from --neon-cyan (which reads more teal/green and
// is already used elsewhere for classic-mode odds text/focus rings). No
// gold anywhere in this file, per the ask — diamonds get their own theme,
// not a reskin of the wallet's gold.
const DIAMOND_BLUE = '#2bc8f7';

const DIAMOND_BUTTON_COST = 10;

// Priced in diamonds, not cents — diamonds only come from a 10% roll on a
// full combo bar (see resolve_money_push), so these are deliberately not
// cheap; a handful of pushes shouldn't buy an item. Still just "coming
// soon" — the diamond button card below (rendered separately, not looped
// from this array) is the shop's only actually-purchasable item right now.
const PLACEHOLDER_ITEMS = [
  { id: 'crystal-trail', label: 'Crystal Trail Effect', priceDiamonds: 25 },
  { id: 'diamond-charm', label: 'Diamond Charm', priceDiamonds: 40 },
];

export default function MoneyShop({ onClose }) {
  const { stats, refreshMoneyStats } = useAuth();
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState(null);

  const diamonds = stats?.moneyDiamonds ?? 0;
  const owned = !!stats?.ownsDiamondButton;
  const canAfford = diamonds >= DIAMOND_BUTTON_COST;

  // purchase_diamond_button (see schema.sql) is the real enforcement point
  // — balance/already-owned checks both happen there, not here. A false
  // out_success just means the client's cached state was stale (shouldn't
  // normally be reachable, since the Buy button is already disabled
  // whenever either condition holds) — refreshing either way pulls in
  // whatever's actually true server-side.
  async function buyDiamondButton() {
    if (buying || owned || !canAfford) return;
    setBuying(true);
    setBuyError(null);
    try {
      const { data, error } = await supabase.functions.invoke('buy-diamond-button');
      if (error || !data) throw error ?? new Error('no response');
      if (!data.success) {
        setBuyError("Couldn't complete that purchase.");
      }
      await refreshMoneyStats();
    } catch (err) {
      console.error('buy diamond button failed:', err);
      setBuyError("Couldn't complete that purchase.");
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginTop: 16, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
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

      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
        <img src="/diamond.png" alt="" width={16} height={16} style={{ display: 'block' }} />
        Diamonds: <span style={{ color: DIAMOND_BLUE, fontWeight: 700 }}>{diamonds}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        {/* The real item — applies to CLASSIC mode's push button (see
            Home.jsx), not this money-mode UI. Rendered explicitly rather
            than folded into PLACEHOLDER_ITEMS' generic .map() below since
            it needs actual purchase/owned states, not just a static price
            pill. */}
        <div
          className="badge-card"
          style={{
            background: '#06060a',
            border: `1px solid rgba(43,200,247,${owned ? 0.5 : 0.25})`,
            borderRadius: 10,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
          }}
        >
          <img src="/diamond-button.png" alt="" width={44} height={44} style={{ display: 'block', marginBottom: 6 }} />
          <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginBottom: 8 }}>
            Diamond Button
          </div>
          {owned ? (
            <div
              className="mono"
              style={{ fontSize: 10, fontWeight: 700, color: DIAMOND_BLUE, textTransform: 'uppercase', letterSpacing: '0.08em' }}
            >
              ✓ Owned
            </div>
          ) : (
            <>
              <button
                className="btn-ghost"
                disabled={buying || !canAfford}
                onClick={buyDiamondButton}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 8px',
                  color: canAfford ? DIAMOND_BLUE : 'var(--text-dim)',
                  borderColor: canAfford ? DIAMOND_BLUE : 'var(--line)',
                  opacity: buying ? 0.6 : 1,
                  cursor: canAfford ? 'pointer' : 'not-allowed',
                }}
              >
                <img src="/diamond.png" alt="" width={10} height={10} style={{ display: 'block' }} />
                {buying ? 'Buying…' : `Buy for ${DIAMOND_BUTTON_COST}`}
              </button>
              {!canAfford && (
                <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 6 }}>
                  Need {DIAMOND_BUTTON_COST - diamonds} more
                </div>
              )}
            </>
          )}
        </div>

        {PLACEHOLDER_ITEMS.map((item) => (
          <div
            key={item.id}
            className="badge-card"
            style={{
              background: '#06060a',
              border: '1px solid rgba(43,200,247,0.25)',
              borderRadius: 10,
              padding: 12,
              opacity: 0.6,
            }}
          >
            <div className="mono" style={{ fontSize: 11, color: 'var(--text)', marginBottom: 6 }}>
              {item.label}
            </div>
            <div
              className="mono"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                fontWeight: 700,
                color: DIAMOND_BLUE,
                border: `1px solid ${DIAMOND_BLUE}`,
                borderRadius: 6,
                padding: '2px 6px',
              }}
            >
              <img src="/diamond.png" alt="" width={10} height={10} style={{ display: 'block' }} />
              {item.priceDiamonds}
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Coming soon
            </div>
          </div>
        ))}
      </div>

      {buyError && (
        <div className="mono" style={{ fontSize: 10, color: 'var(--neon-red)', marginTop: 10, textAlign: 'center' }}>
          {buyError}
        </div>
      )}
    </div>
  );
}
