import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  server: {
    fs: {
      allow: ['..']
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon-192.png', 'icon-512.png', 'exercises/*.png'],
      manifest: {
        name: 'FitTrainer',
        short_name: 'FitTrainer',
        description: 'Premium AI-powered workout companion.',
        theme_color: '#0A1128',
        background_color: '#060B18',
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
        maximumFileSizeToCacheInBytes: 5000000
      }
    })
  ],
  resolve: {
    alias: {
      // Stub out the optional MediaPipe backend; MoveNet runs on tfjs/webgpu.
      // `__dirname` is unavailable in ESM, so derive the path from import.meta.
      '@mediapipe/pose': fileURLToPath(new URL('./mock-mediapipe.js', import.meta.url))
    }
  }
})
