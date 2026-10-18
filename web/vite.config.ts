import { env } from "node:process";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const studioServer = env.AETHER_DEV_SERVER || "http://127.0.0.1:8781";

export default defineConfig({
  base: "./",
  build: {
    rollupOptions: {
      input: { app: 'index.html', 'create-document': 'src/create-document.ts' },
      preserveEntrySignatures: 'strict',
      output: { entryFileNames: chunk => chunk.name === 'create-document' ? 'create-document.js' : 'assets/[name]-[hash].js' },
    },
  },
  plugins: [react()],
  server: {
    host: "127.0.0.1", strictPort: true, port: 5178,
    fs: { allow: ["."] },
    proxy: {
      "/api": { target: studioServer, changeOrigin: true, headers: { Origin: studioServer } },
      "/icons": { target: studioServer, changeOrigin: true },
    },
  },
});
