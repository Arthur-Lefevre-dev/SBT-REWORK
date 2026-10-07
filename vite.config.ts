import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));
const api = "http://localhost:3001";

export default defineConfig({
  root: path.join(root, "web"),
  plugins: [react()],
  publicDir: "public",
  build: {
    outDir: path.join(root, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      // Use /api/ (with slash) so Vite does not proxy frontend modules like /api.ts
      "/api/": { target: api, changeOrigin: true },
      "/admin/login": { target: api, changeOrigin: true },
      "/admin/callback": { target: api, changeOrigin: true },
      "/admin/logout": { target: api, changeOrigin: true },
      "/admin/ws": { target: "ws://localhost:3001", ws: true },
    },
  },
});
