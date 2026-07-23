import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Rebuilds the precache list on every deploy and swaps it in as soon
      // as the new service worker activates — no "update available, click
      // to refresh" prompt to build/wire up, matching how the rest of the
      // site auto-deploys on push.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Pushdle',
        short_name: 'Pushdle',
        description: 'A daily push-your-luck game. Press the button, keep your streak alive, see how far you get before you bust.',
        start_url: '/',
        display: 'standalone',
        background_color: '#08080c',
        theme_color: '#08080c',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
