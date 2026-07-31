import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext.jsx';
import { useChrome } from '../lib/ChromeContext.jsx';
import { isMuted, toggleMuted, playNav } from '../lib/sound.js';

export default function NavBar() {
  const { user, stats } = useAuth();
  const { collapsed } = useChrome();
  const navRef = useRef(null);
  // The actual page links live in their own inner flex container (see the
  // JSX below), separate from the mute button — .nav-bar itself is just a
  // 2-item row (links container + mute button) that never wraps; all the
  // "does this fit on one line" logic below cares about THIS container's
  // own children, not the outer bar's.
  const linksRef = useRef(null);
  const [soundMuted, setSoundMuted] = useState(() => isMuted());
  // stats is server-authoritative for logged-in players (AuthContext merges
  // it on login and Home.jsx keeps it fresh after every push/admin action)
  // — reading it straight from context means this updates live wherever
  // it's rendered, not just on the next route change.
  const dayStreak = stats?.dayStreak ?? 0;

  // The bar must never wrap to a second line — rather than trying to keep
  // everything fitted (impossible for an arbitrarily long username), a
  // too-long username is dropped entirely, keeping just the streak badge
  // in its place. usernameHiddenRef mirrors the state into the
  // ResizeObserver callback below (a plain closure would only ever see the
  // value from whichever render created it, not the latest one).
  const [usernameHidden, setUsernameHidden] = useState(false);
  const usernameHiddenRef = useRef(usernameHidden);
  usernameHiddenRef.current = usernameHidden;
  // Tracks the links container's own last known width so the observer can
  // tell "the viewport actually got wider, worth re-trying the username"
  // apart from "our own show/hide just changed the row's height," which
  // also fires this same observer but isn't a reason to retry anything.
  const lastWidthRef = useRef(null);

  // --nav-bar-clearance started as a static guess (119px, sized for the
  // worst-case 2-line wrap) — too generous in the common 1-line case, so
  // it got tightened to a flat 76px total... which then wasn't enough on
  // the rare 2-line wrap (long username + narrow-ish viewport), causing
  // the page header/Admin button/badge toast to overlap the bar's second
  // line. Now that a too-long username gets dropped instead of wrapping,
  // this still measures the bar's REAL current height (rather than
  // assuming "always 1 line now") since chrome font/zoom settings etc.
  // could still in principle produce a taller single line than expected.
  // useLayoutEffect (not useEffect) so it's set before the browser's first
  // paint — no flash of wrong spacing while this measures.
  useLayoutEffect(() => {
    const bar = navRef.current;
    const links = linksRef.current;
    if (!bar || !links || collapsed) return; // keep the last expanded height during a mid-run collapse, not 0

    const wraps = () => {
      const kids = Array.from(links.children);
      if (kids.length < 2) return false;
      const firstTop = kids[0].offsetTop;
      return kids.some((k) => k.offsetTop !== firstTop);
    };
    const setClearance = () => {
      document.documentElement.style.setProperty('--nav-bar-clearance', `${Math.ceil(bar.getBoundingClientRect().height)}px`);
    };
    // Only ever hides the username here — never retries showing it. That
    // retry only makes sense right after a genuine width change (see
    // handleResize below); doing it unconditionally on every render would
    // immediately re-show the very username whose removal we're in the
    // middle of committing, oscillating forever.
    const commitMeasurement = () => {
      if (wraps() && !usernameHiddenRef.current) {
        setUsernameHidden(true);
        return;
      }
      setClearance();
    };
    const handleResize = () => {
      const width = links.getBoundingClientRect().width;
      const widthChanged = lastWidthRef.current === null || Math.abs(width - lastWidthRef.current) >= 0.5;
      lastWidthRef.current = width;
      if (widthChanged && usernameHiddenRef.current) {
        // Width may have grown enough to fit the username again — try
        // showing it; commitMeasurement (on the next effect run, since
        // usernameHidden is a dependency) re-checks from that state and
        // hides it right back if it still doesn't fit.
        setUsernameHidden(false);
        return;
      }
      commitMeasurement();
    };

    lastWidthRef.current = links.getBoundingClientRect().width;
    commitMeasurement();
    const ro = new ResizeObserver(handleResize);
    ro.observe(links);
    // Separate observer on the OUTER bar itself, purely to keep
    // --nav-bar-clearance in sync while .nav-bar's own max-height is
    // mid CSS transition (collapsing/uncollapsing around a run — see
    // .nav-bar--collapsed in global.css). .nav-bar-links' own size doesn't
    // change during that transition (it's just being clipped/revealed by
    // the outer bar's overflow:hidden, not resizing itself), so watching
    // only `links` meant this froze at whatever height the bar happened to
    // be at the instant this effect last ran — typically right at the
    // START of an 800ms expand, a few px tall — rather than tracking the
    // animated value through to its real final height. That stale,
    // too-small clearance was what let a newly-navigated-to page's content
    // render up underneath the still-expanding nav bar for the rest of
    // the transition.
    const barRo = new ResizeObserver(setClearance);
    barRo.observe(bar);
    return () => {
      ro.disconnect();
      barRo.disconnect();
    };
  }, [collapsed, user, dayStreak, usernameHidden]);

  return (
    <nav ref={navRef} className={'nav-bar' + (collapsed ? ' nav-bar--collapsed' : '')}>
      <div className="nav-bar-links" ref={linksRef}>
        {user && (
          <span className="user-bar-name">
            {!usernameHidden && (user.user_metadata?.username || user.email)}
            <span className="user-bar-streak" title="Daily play streak">
              🔥<span className="user-bar-streak-num">{dayStreak}</span>
            </span>
          </span>
        )}
        <NavLink to="/" end onClick={playNav} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
          Play
        </NavLink>
        <NavLink to="/leaderboard" onClick={playNav} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
          Leaderboard
        </NavLink>
        <NavLink to="/profile" onClick={playNav} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
          Profile
        </NavLink>
        {!user && (
          <NavLink to="/login" onClick={playNav} className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>
            Log in
          </NavLink>
        )}
      </div>
      {/* Real sibling flex items (not absolutely positioned — that was tried
          first, but it doesn't reserve any layout space, so on narrower
          screens it could visually overlap "Log in" instead of the links
          container ever knowing to make room for it). .nav-bar-links being
          flex:1 means it always shrinks to leave these buttons their own
          space, never the other way around. */}
      <NavLink
        to="/about"
        onClick={playNav}
        className={({ isActive }) => 'nav-link nav-mute-btn' + (isActive ? ' active' : '')}
        title="How to play"
      >
        <img src="/question-mark.png" alt="How to play" width={18} height={18} style={{ display: 'block' }} />
      </NavLink>
      <button
        className="nav-link nav-mute-btn"
        onClick={() => setSoundMuted(toggleMuted())}
        title={soundMuted ? 'Unmute sound' : 'Mute sound'}
      >
        {soundMuted ? '🔇' : '🔊'}
      </button>
    </nav>
  );
}
