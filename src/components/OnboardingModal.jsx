import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SUCCESS_CHANCE } from '../lib/game.js';
import { playNav } from '../lib/sound.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { hasSeenOnboardingLocally, markOnboardingSeenLocally } from '../lib/onboarding.js';

// How long the page sits still before the modal appears — deliberately not
// instant, so it reads as the page settling in and then gliding the modal
// up to meet you, rather than a jarring pop the moment the page loads.
const APPEAR_DELAY_MS = 1150;
// Matches .onboarding-modal's own glide-in animation-duration in
// global.css (the longer of the two exit animations, backdrop/modal) —
// the actual unmount waits this long so the reverse animation gets to
// finish playing instead of being cut off mid-flight.
const EXIT_DURATION_MS = 500;

// Shown once ever, before a first-time player's first push — the
// reasoning (and the copy) is: name the goal and the risk in one screen,
// nothing else. Badges/leaderboard/rarity tiers live on /about instead;
// reachable here via "Full rules", and any time after via the nav bar's ❓.
//
// Guests are tracked purely via localStorage (see lib/onboarding.js). A
// logged-in player's dismissal is tracked server-side too
// (profiles.onboarding_seen, via AuthContext) so it follows their account
// across devices — see AuthContext.jsx for the login-time carry-over that
// also covers a guest who dismissed this locally and then signs up.
//
// `forceOpen`/`onForceOpenConsumed` let the admin dev-tools panel
// (Home.jsx) summon this on demand for preview/QA — see the comment above
// shouldEventuallyShow. A forced open never touches real seen-state
// (localStorage or the server), so previewing it doesn't affect whether a
// real first-time visitor would still see it.
export default function OnboardingModal({ forceOpen = false, onForceOpenConsumed }) {
  const { user, onboardingSeen, markOnboardingSeen } = useAuth();
  const navigate = useNavigate();
  // Dismissing hides the modal immediately without waiting on the
  // AuthContext round trip (that still happens, just optimistically) —
  // same "hide the instant they act" feel the old version had.
  const [dismissedThisSession, setDismissedThisSession] = useState(false);
  // Gates the actual mount, separately from "should this show at all" —
  // see the effect below. Kept as its own flag rather than a CSS
  // animation-delay so the backdrop doesn't sit in the DOM (invisible but
  // still catching clicks) for that first stretch.
  const [readyToShow, setReadyToShow] = useState(false);
  // True for the EXIT_DURATION_MS window between "user asked to close" and
  // the actual unmount — drives the reverse-glide CSS classes below, so
  // the close motion gets to play instead of the DOM node just vanishing.
  const [exiting, setExiting] = useState(false);
  // What to actually DO once the exit animation finishes — captured at
  // click time (not derived at finalize time) since which button was
  // clicked matters (e.g. "Full rules" also navigates).
  const pendingActionRef = useRef(null);

  // Render nothing — not even a flash — while we don't yet know enough to
  // decide correctly: auth itself hasn't resolved yet (user undefined), or
  // it has resolved to a real account but that account's own
  // onboarding_seen hasn't loaded from the profiles row yet (onboardingSeen
  // null). Without this gate, a RETURNING logged-in player whose account
  // already dismissed this on another device would see it flash on screen
  // for a moment before the server confirms it shouldn't. forceOpen
  // bypasses all of this — an admin summoning it doesn't need to wait on
  // any of these real-visitor gates.
  const authLoading = user === undefined || (user && onboardingSeen === null);
  const seen = !authLoading && (dismissedThisSession || (user ? onboardingSeen : hasSeenOnboardingLocally()));
  const shouldEventuallyShow = forceOpen || (!authLoading && !seen);

  // Hooks can't sit after an early return (order has to stay identical
  // every render), so the actual "don't render yet" bailouts happen below,
  // after every hook in this component has already run.
  useEffect(() => {
    if (!shouldEventuallyShow) return;
    const timer = setTimeout(() => setReadyToShow(true), APPEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [shouldEventuallyShow]);

  // Runs the actually-deferred close action once the exit animation's had
  // time to finish. forceOpen is captured fresh here (not from the click
  // handler) since it's still accurate for the whole short exit window.
  useEffect(() => {
    if (!exiting) return;
    const timer = setTimeout(() => {
      const action = pendingActionRef.current;
      setExiting(false);
      setReadyToShow(false);
      if (forceOpen) {
        onForceOpenConsumed?.();
      } else {
        markOnboardingSeenLocally();
        setDismissedThisSession(true);
        if (user) markOnboardingSeen();
      }
      if (action === 'rules') {
        playNav();
        navigate('/about');
      }
    }, EXIT_DURATION_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  if (!shouldEventuallyShow) return null;

  if (!readyToShow) {
    // Waiting out APPEAR_DELAY_MS — invisible, but still needs to block
    // interaction with the page underneath (namely the push button),
    // otherwise a fast player could get a push in before the modal
    // actually appears to explain what they're doing.
    return <div className="onboarding-preblock" aria-hidden="true" />;
  }

  function beginClose(action) {
    if (exiting) return; // ignore a second click mid-exit
    pendingActionRef.current = action;
    setExiting(true);
  }

  // Only a direct click on the backdrop itself dismisses — a click that
  // bubbled up from something inside the modal panel has e.target pointing
  // at that inner element, not this one, so it's ignored here.
  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) beginClose('dismiss');
  }

  return (
    <div
      className={'onboarding-backdrop' + (exiting ? ' onboarding-exiting' : '')}
      role="dialog"
      aria-modal="true"
      aria-label="How to play Pushdle"
      onClick={handleBackdropClick}
    >
      <div className={'panel onboarding-modal' + (exiting ? ' onboarding-exiting' : '')}>
        {/* text-align lives on this wrapper, not the h2 itself — h1/h2/h3
            are globally display:inline-block (see global.css, for an
            unrelated hover-pop scale effect), which makes an inline-block
            element's own text-align a no-op; centering has to come from
            the parent instead, same as About.jsx's header does it. Scoped
            to just this header block (not the whole panel) so the "How it
            works" bullets below stay left-aligned rather than inheriting
            center too. */}
        <div style={{ textAlign: 'center' }}>
          <p className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
            Welcome to
          </p>
          <h2 className="gradient-title" style={{ fontSize: 28, marginBottom: 6 }}>
            Pushdle
          </h2>
          <p className="mono" style={{ fontSize: 12, color: 'var(--neon-cyan)', marginBottom: 20 }}>
            {Math.round(SUCCESS_CHANCE * 100)}% you live · {Math.round((1 - SUCCESS_CHANCE) * 100)}% you don't
          </p>
        </div>

        <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.8, marginBottom: 18 }}>
          <p style={{ marginBottom: 10 }}>
            Tap <strong style={{ color: 'var(--text)' }}>Push</strong>. Every press after your
            first has a {Math.round(SUCCESS_CHANCE * 100)}% chance to keep your streak alive.
          </p>
          <p style={{ marginBottom: 10 }}>
            Your <strong style={{ color: 'var(--text)' }}>score</strong> is how many pushes you
            survive in a row before you bust.
          </p>
          <p>
            <strong style={{ color: 'var(--text)' }}>One run a day.</strong> Bust — or walk away —
            and that's it until tomorrow.
          </p>
        </div>

        <div className="mono onboarding-note" style={{ marginBottom: 10 }}>
          🔑 Create an account to save your streak and rank on the leaderboard — guest runs stay
          local to this device only.
        </div>
        <div className="mono onboarding-note" style={{ marginBottom: 22 }}>
          📤 Bust? Share your run or copy the result to send to friends.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <button className="btn-ghost onboarding-cta" onClick={() => beginClose('dismiss')}>
            Push to play →
          </button>
          <button className="mono onboarding-link" onClick={() => beginClose('rules')}>
            Full rules
          </button>
        </div>
      </div>
    </div>
  );
}
