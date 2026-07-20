import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      filename: "service-worker.js",
      injectRegister: false,
      includeAssets: ["icon.svg", "maskable-icon.svg"],
      manifest: {
        name: "vatove Activity Explorer",
        short_name: "vatove",
        description: "Explore Intervals.icu routes, heart-rate zones, and elevation.",
        theme_color: "#071712",
        background_color: "#f3f1e9",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "/maskable-icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/tiles\.openfreemap\.org\//,
            handler: "CacheFirst",
            options: {
              cacheName: "openfreemap-v1",
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 512,
                maxAgeSeconds: 7 * 24 * 60 * 60,
                purgeOnQuotaError: true
              }
            }
          }
        ]
      }
    })
  ],
  build: {
    sourcemap: true
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: false
      }
    }
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    coverage: {
      reporter: ["text", "html"]
    }
  }
});
