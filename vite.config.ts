import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
// VITE_BASE_PATH lets the app live in a sub-folder of the site (e.g. /veditor/) – see scripts/deploy-siteground.mjs
const base = (process.env.VITE_BASE_PATH || '/').replace(/\/?$/, '/');

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 8080 },
  preview: { port: 8080 },
});
