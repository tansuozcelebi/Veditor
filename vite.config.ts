import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
// VITE_BASE_PATH lets the app live in a sub-folder of the site (e.g. /veditor/) – see scripts/deploy-siteground.mjs.
// Only the path matters: a full URL such as https://example.com/veditor is reduced to /veditor/.
/** @param {string | undefined} value */
function normalizeBase(value) {
  let p = (value || '/').trim();
  if (/^https?:\/\//i.test(p)) { try { p = new URL(p).pathname; } catch { p = '/'; } }
  if (!p.startsWith('/')) p = '/' + p;
  return p.replace(/\/?$/, '/');
}
const base = normalizeBase(process.env.VITE_BASE_PATH);

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: { port: 8080 },
  preview: { port: 8080 },
});
