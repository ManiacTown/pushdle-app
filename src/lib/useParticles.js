import { useEffect, useRef, useState } from 'react';

// Extracted out of Home.jsx unchanged — the money-variant mode
// (MoneyMode.jsx) needs the same coin-pop burst effect, and this was the
// only shareable piece of it (the classic-mode-specific choreography
// around WHEN to call these stays in each component).
const BUTTON_RADIUS = 95; // matches the 190px push button

export function useParticles() {
  const [particles, setParticles] = useState([]);
  const [rings, setRings] = useState([]);
  const particleId = useRef(0);
  const particleTimers = useRef([]);

  useEffect(() => {
    return () => particleTimers.current.forEach(clearTimeout);
  }, []);

  // speedScale > 1 makes particles travel further and complete sooner — a
  // bigger, snappier burst rather than just a proportionally-slower-looking
  // bigger one.
  function spawnEffect(color, count = 16, speedScale = 1) {
    // Particles start on the button's own edge (BUTTON_RADIUS out from
    // center), spread evenly around the ring with a little jitter, so the
    // burst reads as coming off the button rather than its middle.
    const angleJitter = Math.random() * Math.PI * 2;
    const newOnes = Array.from({ length: count }).map((_, i) => {
      const angle = angleJitter + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const dist = (70 + Math.random() * 90) * speedScale;
      const sx = Math.cos(angle) * BUTTON_RADIUS;
      const sy = Math.sin(angle) * BUTTON_RADIUS;
      return {
        id: particleId.current++,
        style: {
          '--sx': `${sx}px`,
          '--sy': `${sy}px`,
          '--dx': `${Math.cos(angle) * (BUTTON_RADIUS + dist)}px`,
          '--dy': `${Math.sin(angle) * (BUTTON_RADIUS + dist)}px`,
          '--dur': `${(0.45 + Math.random() * 0.3) / speedScale}s`,
          background: color,
          boxShadow: `0 0 10px ${color}, 0 0 3px #fff`,
        },
      };
    });
    const ringId = particleId.current++;
    setParticles((p) => [...p, ...newOnes]);
    setRings((r) => [...r, { id: ringId, color }]);
    const ids = newOnes.map((p) => p.id);
    particleTimers.current.push(
      setTimeout(() => setParticles((p) => p.filter((x) => !ids.includes(x.id))), 900)
    );
    particleTimers.current.push(
      setTimeout(() => setRings((r) => r.filter((x) => x.id !== ringId)), 700)
    );
  }

  // Money-variant coin-pop (see MoneyMode.jsx) — identical trajectory math
  // to spawnEffect above, just rendered as the real coin image
  // (public/coin-transparent.png, .particle--coin in global.css) instead
  // of a plain colored dot. Kept as its own function rather than adding an
  // "asset" param to spawnEffect since spawnEffect's color also drives its
  // box-shadow glow, which doesn't make sense for an image particle.
  function spawnCoins(count = 10, speedScale = 1) {
    const angleJitter = Math.random() * Math.PI * 2;
    const newOnes = Array.from({ length: count }).map((_, i) => {
      const angle = angleJitter + (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const dist = (70 + Math.random() * 90) * speedScale;
      const sx = Math.cos(angle) * BUTTON_RADIUS;
      const sy = Math.sin(angle) * BUTTON_RADIUS;
      return {
        id: particleId.current++,
        coin: true,
        style: {
          '--sx': `${sx}px`,
          '--sy': `${sy}px`,
          '--dx': `${Math.cos(angle) * (BUTTON_RADIUS + dist)}px`,
          '--dy': `${Math.sin(angle) * (BUTTON_RADIUS + dist)}px`,
          '--dur': `${(0.45 + Math.random() * 0.3) / speedScale}s`,
        },
      };
    });
    const ringId = particleId.current++;
    setParticles((p) => [...p, ...newOnes]);
    setRings((r) => [...r, { id: ringId, color: '#ffd45e' }]);
    const ids = newOnes.map((p) => p.id);
    particleTimers.current.push(
      setTimeout(() => setParticles((p) => p.filter((x) => !ids.includes(x.id))), 900)
    );
    particleTimers.current.push(
      setTimeout(() => setRings((r) => r.filter((x) => x.id !== ringId)), 700)
    );
  }

  // Bust-only companion to spawnEffect, fired alongside it rather than
  // instead of it — the red burst reads as the impact spark, this reads as
  // the wreckage falling afterward. Angles are constrained to a downward
  // cone (roughly ±50° off straight down) instead of spawnEffect's full
  // 360°, and rendered with the .particle--debris modifier (ease-in timing
  // — see global.css — instead of ease-out), so the same
  // --sx/--sy/--dx/--dy trajectory math reads as gravity pulling something
  // down instead of an outward blast. intensity (0-1) scales both how much
  // debris there is and how far it falls.
  function spawnDebris(intensity) {
    const count = Math.round(6 + intensity * 14);
    const newOnes = Array.from({ length: count }).map(() => {
      const angle = Math.PI / 2 + (Math.random() - 0.5) * 1.75; // ~±50° around straight down
      const dist = (50 + Math.random() * 70) * (1 + intensity * 0.6);
      const sx = Math.cos(angle) * BUTTON_RADIUS * 0.6;
      const sy = Math.sin(angle) * BUTTON_RADIUS * 0.6;
      const size = 4 + Math.random() * 5;
      return {
        id: particleId.current++,
        debris: true,
        style: {
          '--sx': `${sx}px`,
          '--sy': `${sy}px`,
          '--dx': `${Math.cos(angle) * dist}px`,
          // extra downward pull on top of the angled distance, so it reads
          // as falling rather than just a lower-angled burst.
          '--dy': `${Math.sin(angle) * dist + 30 + intensity * 30}px`,
          '--dur': `${0.7 + Math.random() * 0.4}s`,
          width: `${size}px`,
          height: `${size}px`,
          background: '#4a3838',
          boxShadow: '0 0 6px rgba(0,0,0,0.5)',
        },
      };
    });
    setParticles((p) => [...p, ...newOnes]);
    const ids = newOnes.map((p) => p.id);
    particleTimers.current.push(
      setTimeout(() => setParticles((p) => p.filter((x) => !ids.includes(x.id))), 1300)
    );
  }

  // A spark or two flaking off the crack when the busted button gets
  // poked — much smaller/quicker than spawnDebris's pile of falling
  // wreckage, since this isn't a second impact, just catching the light as
  // an already-broken surface gets jostled. Reuses the same .particle
  // burst mechanics (--sx/--sy/--dx/--dy, ease-out) at a fraction of the
  // scale, colored like the crack's own glow rather than debris's dark
  // chips, so it reads as coming off the fracture itself.
  function spawnSpark() {
    const count = 1 + Math.floor(Math.random() * 3);
    const newOnes = Array.from({ length: count }).map(() => {
      const angle = Math.random() * Math.PI * 2;
      const startR = BUTTON_RADIUS * 0.55;
      const dist = 14 + Math.random() * 22;
      return {
        id: particleId.current++,
        style: {
          '--sx': `${Math.cos(angle) * startR}px`,
          '--sy': `${Math.sin(angle) * startR}px`,
          '--dx': `${Math.cos(angle) * (startR + dist)}px`,
          '--dy': `${Math.sin(angle) * (startR + dist)}px`,
          '--dur': `${0.3 + Math.random() * 0.2}s`,
          width: '4px',
          height: '4px',
          background: '#fff3ea',
          boxShadow: '0 0 6px rgba(255,60,60,0.9), 0 0 3px #fff',
        },
      };
    });
    setParticles((p) => [...p, ...newOnes]);
    const ids = newOnes.map((p) => p.id);
    particleTimers.current.push(
      setTimeout(() => setParticles((p) => p.filter((x) => !ids.includes(x.id))), 550)
    );
  }

  // Immediate wipe for a hard admin reset (e.g. "reset day timer") — bypasses
  // the normal timed cleanup so nothing lingers on screen after state that
  // no longer applies to it.
  function clearParticles() {
    setParticles([]);
    setRings([]);
  }

  return { particles, rings, spawnEffect, spawnCoins, spawnDebris, spawnSpark, clearParticles };
}
