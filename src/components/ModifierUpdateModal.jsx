import { useEffect, useRef, useState } from 'react';

// Matches OnboardingModal/MoneyModeUnlockModal/PityIntroModal's own
// exit-animation duration — reuses the exact same .onboarding-backdrop/
// .onboarding-modal/.onboarding-exiting CSS (see global.css), same
// "centered panel, glides in, glides back out" shape as all three. Unlike
// those, this one's content is long enough to need real scrolling — see
// the render below for how that's handled, since no existing modal here
// needed it before.
const EXIT_DURATION_MS = 500;

// One-time "what's new" recap, shown once to any LOGGED-IN account (no
// guest path — see Home.jsx's trigger effect and profiles.modifier_update_seen)
// summarizing everything shipped since the 2026-08-20 changelog entry.
// Deliberately brief bullet points, not the full changelog detail (see
// lib/changelog.js for that) — this is a quick "here's what changed since
// you last looked" catch-up, not a replacement for /updates.
export default function ModifierUpdateModal({ onDismiss }) {
  const [exiting, setExiting] = useState(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => onDismiss(), EXIT_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  function beginClose() {
    if (pendingRef.current) return; // ignore a second click mid-exit
    pendingRef.current = true;
    setExiting(true);
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) beginClose();
  }

  return (
    <div
      className={'onboarding-backdrop' + (exiting ? ' onboarding-exiting' : '')}
      role="dialog"
      aria-modal="true"
      aria-label="Modifier Update"
      onClick={handleBackdropClick}
    >
      <div className={'panel onboarding-modal' + (exiting ? ' onboarding-exiting' : '')}>
        <div style={{ textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            What's new
          </p>
          <h2 className="gradient-title" style={{ fontSize: 28, marginBottom: 6 }}>
            Modifier Update
          </h2>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 20 }}>
            Here's what's changed in Money Mode since our last update.
          </p>
        </div>

        {/* No existing modal here needed an inner scroll region before —
            .onboarding-backdrop already scrolls the whole thing on a short
            viewport (see its own comment in global.css), so this list is
            just left free to grow instead of adding a second, competing
            scroll container. */}
        <ul
          className="mono"
          style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 22, paddingLeft: 18 }}
        >
          <li style={{ marginBottom: 10 }}>
            Added two new Money Mode upgrades — <strong style={{ color: 'var(--text)' }}>💲 Streak Bonus</strong> and{' '}
            <strong style={{ color: 'var(--text)' }}>😈 Daredevil</strong> — alongside Weekly Bust Insurance, 30
            diamonds each in the shop.
          </li>
          <li style={{ marginBottom: 10 }}>
            Only <strong style={{ color: 'var(--text)' }}>one upgrade can be active</strong> at a time — you'll be
            asked to pick one (or none) the first time you enter Money Mode each week.
          </li>
          <li style={{ marginBottom: 10 }}>
            Buying your first upgrade while nothing's active now offers an instant "activate now?" choice, right
            in the shop.
          </li>
          <li style={{ marginBottom: 10 }}>
            Your weekly pick is <strong style={{ color: 'var(--text)' }}>locked in</strong> once made — the shop's
            Activate buttons stay locked until the next Monday reset.
          </li>
          <li style={{ marginBottom: 10 }}>
            A tag now shows on your profile for whichever upgrade you currently have active.
          </li>
          <li style={{ marginBottom: 10 }}>
            Added a new <strong style={{ color: 'var(--text)' }}>Shop</strong> badge category — 5 badges for buying
            things in the Money Mode shop.
          </li>
          <li style={{ marginBottom: 10 }}>
            Added a new <strong style={{ color: 'var(--text)' }}>Secret</strong> badge category — 6 hidden badges
            whose descriptions stay a mystery until you actually earn them.
          </li>
          <li style={{ marginBottom: 10 }}>
            Special-rarity badge flair now glows next to your name, wherever it shows up.
          </li>
          <li>
            The Golden Goose badge's chicken finally became an actual goose 🪿.
          </li>
        </ul>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <button className="btn-ghost onboarding-cta" onClick={beginClose}>
            Got it →
          </button>
        </div>
      </div>
    </div>
  );
}
