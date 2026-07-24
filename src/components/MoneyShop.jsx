import { useAuth } from '../lib/AuthContext.jsx';
import { formatCents } from '../lib/money.js';
import { spotlightMove } from '../lib/spotlight.js';

// v1 shell only — cosmetic-only shop scope, no real catalog/purchase flow
// yet (see the plan). Shows the real wallet balance (spending here never
// touches the lifetime leaderboard total — see schema.sql's
// money_wallet_cents/money_lifetime_cents split) so that part is real even
// though nothing's actually purchasable. Reuses .badge-card's hover/scale
// treatment for the item cards, same visual language as Profile.jsx's
// badge grid, just with a price pill instead of a rarity pill.
const PLACEHOLDER_ITEMS = [
  { id: 'gold-button-skin', label: 'Gold Button Skin', priceCents: 500 },
  { id: 'coin-trail', label: 'Coin Trail Effect', priceCents: 1000 },
  { id: 'money-bag-charm', label: 'Money Bag Charm', priceCents: 1500 },
];

export default function MoneyShop({ onClose }) {
  const { stats } = useAuth();

  return (
    <div className="panel spotlight" onMouseMove={spotlightMove} style={{ marginTop: 16, maxWidth: 420, marginLeft: 'auto', marginRight: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div className="mono" style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#ffd45e' }}>
          🛍 Shop
        </div>
        <button className="btn-ghost" style={{ padding: '4px 10px', fontSize: 11 }} onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 16 }}>
        Wallet: <span style={{ color: '#ffd45e' }}>{formatCents(stats?.moneyWalletCents)}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        {PLACEHOLDER_ITEMS.map((item) => (
          <div
            key={item.id}
            className="badge-card"
            style={{
              background: '#06060a',
              border: '1px solid rgba(255,212,94,0.25)',
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
                display: 'inline-block',
                fontSize: 10,
                fontWeight: 700,
                color: '#ffd45e',
                border: '1px solid #ffd45e',
                borderRadius: 6,
                padding: '2px 6px',
              }}
            >
              {formatCents(item.priceCents)}
            </div>
            <div className="mono" style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 6, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Coming soon
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
