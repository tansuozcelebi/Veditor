// Builds the HLS fixture the live-TV recording checks play against.
//
// Unlike the other fixtures this one is committed, because it cannot be generated where the tests
// run: the ffmpeg Playwright bundles can mux only WebM and image2, and HLS needs an MP4 muxer.
// Chromium has no H.264/AAC either, so the stream is VP9 + Opus in fragmented MP4 – which is also
// the branch worth covering, since fMP4 is the shape that needs an initialisation segment.
//
// Run it with a full ffmpeg on PATH when the fixture needs rebuilding:  node test/gen-hls.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dir = new URL('./fixtures/iptv/hls/', import.meta.url).pathname;
const src = new URL('./fixtures/clipA.webm', import.meta.url).pathname;

const probe = spawnSync('ffmpeg', ['-hide_banner', '-formats'], { encoding: 'utf8' });
if (probe.status !== 0 || !/\bhls\b/.test(probe.stdout || '')) {
  console.error('needs a full ffmpeg on PATH (one that can mux HLS) – the bundled Playwright build cannot');
  process.exit(1);
}

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
const r = spawnSync('ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
  '-vf', 'scale=320:-2', '-c:v', 'libvpx-vp9', '-b:v', '150k', '-deadline', 'realtime', '-cpu-used', '8',
  '-g', '25', '-keyint_min', '25',
  '-c:a', 'libopus', '-b:a', '32k',
  '-f', 'hls', '-hls_time', '1', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
  '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
  '-hls_segment_filename', join(dir, 'seg%03d.m4s'), join(dir, 'stream.m3u8'),
], { stdio: 'inherit' });
if (r.status !== 0) process.exit(r.status ?? 1);

let total = 0;
for (const f of readdirSync(dir)) total += statSync(join(dir, f)).size;
console.log(`hls fixture: ${readdirSync(dir).length} files, ${(total / 1024).toFixed(0)} KB`);
