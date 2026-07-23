// Shareable result-card image — /api/share?streak=23&rarity=15 (and
// optionally &newBest=1). Same rendering approach as api/og.js (an Edge
// Function via @vercel/og, React.createElement instead of JSX for the
// same reason — see that file's header comment), but for a specific run's
// result instead of the generic site preview. Not wired into the app yet
// — this is a working prototype for the "shareable run image" idea, ready
// to link from Home.jsx's handleShare once/if it's wanted for real.

import { ImageResponse } from '@vercel/og';
import { createElement as h } from 'react';

export const config = { runtime: 'edge' };

async function loadGoogleFont(family, weight) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`;
  const css = await (await fetch(cssUrl)).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/);
  if (!match) throw new Error(`Could not resolve a font file URL for ${family} ${weight}`);
  const res = await fetch(match[1]);
  return res.arrayBuffer();
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const streak = Math.max(0, parseInt(searchParams.get('streak'), 10) || 0);
  const rarity = Math.max(1, Math.min(100, parseInt(searchParams.get('rarity'), 10) || 50));
  const newBest = searchParams.get('newBest') === '1';

  const [spaceGroteskBold, jetBrainsMono, jetBrainsMonoBold] = await Promise.all([
    loadGoogleFont('Space Grotesk', 700),
    loadGoogleFont('JetBrains Mono', 500),
    loadGoogleFont('JetBrains Mono', 700),
  ]);

  const tree = h(
    'div',
    {
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#08080c',
        backgroundImage:
          'radial-gradient(circle at 50% 0%, rgba(139,92,246,0.35), transparent 45%), radial-gradient(circle at 80% 100%, rgba(34,229,255,0.25), transparent 50%)',
        fontFamily: 'Space Grotesk',
      },
    },
    h(
      'div',
      { style: { display: 'flex', fontFamily: 'JetBrains Mono', fontSize: 20, letterSpacing: 4, textTransform: 'uppercase', color: '#22e5ff', marginBottom: 18 } },
      "PUSHDLE · TODAY'S RUN"
    ),
    // Same neon-red the real bust screen's ".bust-busted" text uses.
    h('div', { style: { display: 'flex', fontWeight: 700, fontSize: 40, color: '#ff2d6d', marginBottom: 24 } }, 'Busted!'),
    h(
      'div',
      {
        style: {
          display: 'flex',
          fontSize: 220,
          fontWeight: 700,
          backgroundImage: 'linear-gradient(135deg, #8b5cf6, #22e5ff)',
          backgroundClip: 'text',
          color: 'transparent',
          lineHeight: 1,
        },
      },
      String(streak)
    ),
    h(
      'div',
      { style: { display: 'flex', fontFamily: 'JetBrains Mono', fontSize: 24, letterSpacing: 2, textTransform: 'uppercase', color: '#7a7a8c', marginTop: 10 } },
      'streak'
    ),
    newBest &&
      h(
        'div',
        { style: { display: 'flex', fontFamily: 'JetBrains Mono', fontWeight: 700, fontSize: 22, letterSpacing: 2, textTransform: 'uppercase', color: '#ffd45e', marginTop: 14 } },
        'New personal best!'
      ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          fontWeight: 700,
          fontSize: 32,
          backgroundImage: 'linear-gradient(135deg, #8b5cf6, #22e5ff)',
          backgroundClip: 'text',
          color: 'transparent',
          marginTop: 30,
        },
      },
      `TOP ${rarity}%`
    ),
    h(
      'div',
      { style: { display: 'flex', fontFamily: 'JetBrains Mono', fontSize: 20, letterSpacing: 3, textTransform: 'uppercase', color: '#3a3a45', marginTop: 56 } },
      'pushdle.com'
    )
  );

  return new ImageResponse(tree, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Space Grotesk', data: spaceGroteskBold, weight: 700, style: 'normal' },
      { name: 'JetBrains Mono', data: jetBrainsMono, weight: 500, style: 'normal' },
      { name: 'JetBrains Mono', data: jetBrainsMonoBold, weight: 700, style: 'normal' },
    ],
  });
}
