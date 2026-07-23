// Open Graph preview image — /api/og, linked from index.html's og:image
// meta tag. Renders an actual PNG from a React element tree via
// @vercel/og (an Edge Function, not a Node one — different runtime than
// api/simulate-bot-day.js) using the exact same colors/gradient/fonts as
// the real site (src/styles/global.css), rather than an AI-generated
// approximation of the brand.
//
// Built with React.createElement calls instead of JSX syntax — this file
// needs to stay a plain .js file (not .jsx) for Vercel's generic
// (non-Next.js) Function auto-detection to actually recognize and deploy
// it; .jsx is Next.js-specific handling and silently 404s outside of that
// framework, which is what @vercel/og's own quickstart example uses
// (their docs assume a Next.js project) and is not what this is.

import { ImageResponse } from '@vercel/og';
import { createElement as h } from 'react';

export const config = { runtime: 'edge' };

// Google's font CSS endpoint serves WOFF2 by default (which Satori, the
// renderer @vercel/og uses under the hood, can't read) — but serves an
// older TTF/OTF format for user agents that don't advertise WOFF2 support,
// which is exactly what an Edge Function's plain fetch() looks like to it
// with no extra header spoofing needed. This is the standard trick, not
// something fragile/unusual to this project.
async function loadGoogleFont(family, weight) {
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}`;
  const css = await (await fetch(cssUrl)).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(?:opentype|truetype)'\)/);
  if (!match) throw new Error(`Could not resolve a font file URL for ${family} ${weight}`);
  const res = await fetch(match[1]);
  return res.arrayBuffer();
}

export default async function handler() {
  const [spaceGroteskBold, jetBrainsMono] = await Promise.all([
    loadGoogleFont('Space Grotesk', 700),
    loadGoogleFont('JetBrains Mono', 500),
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
      {
        style: {
          display: 'flex',
          fontFamily: 'JetBrains Mono',
          fontSize: 22,
          letterSpacing: 4,
          textTransform: 'uppercase',
          color: '#22e5ff',
          marginBottom: 18,
        },
      },
      "90% you live · 10% you don't"
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          fontSize: 160,
          fontWeight: 700,
          backgroundImage: 'linear-gradient(135deg, #8b5cf6, #22e5ff)',
          backgroundClip: 'text',
          color: 'transparent',
        },
      },
      'Pushdle'
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          fontFamily: 'JetBrains Mono',
          fontSize: 26,
          color: '#7a7a8c',
          marginTop: 22,
        },
      },
      'Press your luck. No skill, just nerve.'
    ),
    h(
      'div',
      {
        style: {
          display: 'flex',
          fontFamily: 'JetBrains Mono',
          fontSize: 20,
          letterSpacing: 3,
          textTransform: 'uppercase',
          color: '#3a3a45',
          marginTop: 56,
        },
      },
      'pushdle.com'
    )
  );

  return new ImageResponse(tree, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Space Grotesk', data: spaceGroteskBold, weight: 700, style: 'normal' },
      { name: 'JetBrains Mono', data: jetBrainsMono, weight: 500, style: 'normal' },
    ],
  });
}
