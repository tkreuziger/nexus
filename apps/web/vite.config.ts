import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/**
 * In development the app runs on Vite's port and proxies `/api` to the server, so the browser sees a
 * single origin and no CORS is involved (ADR-8). The prefix is not rewritten: the server serves the
 * API under the same `/api` prefix, so development and production agree.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.NEXUS_API_URL ?? "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
});
