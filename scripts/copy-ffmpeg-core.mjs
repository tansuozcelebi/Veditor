#!/usr/bin/env node
/**
 * Copies the ffmpeg.wasm core (open source, GPL-2.0-or-later) out of node_modules into public/ffmpeg/
 * so the editor can serve its own decoder from the same origin instead of depending on a CDN.
 * Runs automatically before `npm run build` / `npm run dev`; the copied files are git-ignored.
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// the ESM build: Vite bundles ffmpeg.wasm's worker as a module worker, which can only import the ESM core
const from = join(root, 'node_modules/@ffmpeg/core/dist/esm');
const to = join(root, 'public/ffmpeg');
const files = ['ffmpeg-core.js', 'ffmpeg-core.wasm'];

if (!existsSync(from)) {
  console.warn('⚠ @ffmpeg/core is not installed – the editor will fall back to the CDN for unsupported codecs');
  process.exit(0);
}
mkdirSync(to, { recursive: true });
for (const f of files) {
  const src = join(from, f), dst = join(to, f);
  if (!existsSync(src)) { console.warn(`⚠ missing ${f} in @ffmpeg/core`); continue; }
  if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue; // already up to date
  copyFileSync(src, dst);
  console.log(`  ffmpeg core → public/ffmpeg/${f} (${(statSync(dst).size / 1048576).toFixed(1)} MB)`);
}
