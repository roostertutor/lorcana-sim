import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,svg,woff2}"],
        runtimeCaching: [
          {
            // Lorcast card images — cache-first, 90-day TTL
            urlPattern: /^https:\/\/.*lorcast\.com\/.*\.(png|jpg|webp)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "lorcast-card-images",
              expiration: { maxEntries: 3000, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Supabase API — network-first with 3s fallback
            urlPattern: /^https:\/\/.*supabase\.co\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 50, maxAgeSeconds: 3600 },
            },
          },
        ],
      },
      manifest: {
        name: "Lorcana Sim",
        short_name: "LorcanaSim",
        description: "Lorcana TCG analytics engine and interactive simulator",
        theme_color: "#0a0a0f",
        background_color: "#0a0a0f",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@lorcana-sim/engine": path.resolve(__dirname, "../engine/src/index.ts"),
      "@lorcana-sim/simulator": path.resolve(__dirname, "../simulator/src/index.ts"),
      "@lorcana-sim/analytics": path.resolve(__dirname, "../analytics/src/index.ts"),
    },
  },
});
