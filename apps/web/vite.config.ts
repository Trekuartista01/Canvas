import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      // App-shell only: precache the built JS/CSS/HTML so the SPA still
      // boots offline or on a flaky connection. Deliberately no runtime
      // caching of /trpc or /uploads — this app's data is realtime
      // (WS invalidation) and stale cached API responses would be worse
      // than a visible loading state.
      workbox: {
        navigateFallbackDenylist: [/^\/auth\//, /^\/uploads\//, /^\/trpc\//],
      },
      manifest: {
        name: "Canvas",
        short_name: "Canvas",
        description: "Work management with an image-native AI brain.",
        start_url: "/",
        display: "standalone",
        background_color: "#f9f9f7",
        theme_color: "#0d0d0d",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5183,
    proxy: {
      "/trpc": "http://localhost:3001",
      "/auth": "http://localhost:3001",
      "/uploads": "http://localhost:3001",
      "/public-forms": "http://localhost:3001",
      "/avatars": "http://localhost:3001",
      "/image-versions": "http://localhost:3001",
      "/image-assets": "http://localhost:3001",
      "/ai-references": "http://localhost:3001",
      "/export": "http://localhost:3001",
      "/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
});
