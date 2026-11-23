import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    fs: {
      allow: ['..']
    },
    // Dev talks to the API on the same origin, exactly as it does in
    // production behind nginx. Keeping both same-origin means there is no CORS
    // configuration anywhere, and no base URL to switch between environments.
    // Start the API alongside vite with `npm run server`.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      }
    }
  },
  preview: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'FitTrainer',
        short_name: 'FitTrainer',
        description: 'Self-hosted workout companion.',
        // Both track --bg-deep in src/index.css. theme_color paints the Android
        // status bar and the splash; if it drifts from the page background the
        // installed app opens with a visible seam across the top.
        theme_color: '#070B16',
        background_color: '#070B16',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 5000000,
        // The service worker must never answer for /api. Serving a cached
        // workout history to the app would make a sync look successful when it
        // was not, and could replay stale rows over newer ones.
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          }
        ]
      }
    })
  ]
})
