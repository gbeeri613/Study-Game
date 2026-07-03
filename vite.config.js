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
        // Precache the app shell so the app installs to the home screen and
        // loads fast. Data is NOT bundled anymore — it lives in Supabase — so
        // the app needs a connection to load questions (offline practice was
        // intentionally dropped when the DB moved server-side).
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // SPA fallback so deep links / refreshes resolve to the app shell.
        navigateFallback: 'index.html',
        // Replace any previously installed (offline-everything) service worker
        // and drop its stale caches on the next visit.
        cleanupOutdatedCaches: true,
        // Never cache Supabase auth/data — always hit the network so questions
        // and cross-device sync state are fresh.
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('.supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  base: './',
  server: {
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
})
