import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Pure static SPA. Relative base so it works on Vercel and any static host.
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Auto-update the service worker in the background; new content is picked
      // up on the next launch without prompting the user.
      registerType: 'autoUpdate',
      // Non-hashed static files that should be precached for offline use.
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'תרגול מבחנים',
        short_name: 'תרגול',
        lang: 'he',
        dir: 'rtl',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f172a',
        theme_color: '#1e293b',
        icons: [
          { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: './icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          { src: './icon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
      },
      workbox: {
        // Precache the built app so it works fully offline (all data is bundled).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // SPA fallback so deep links / refreshes resolve while offline.
        navigateFallback: 'index.html',
      },
    }),
  ],
  base: './',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
