// End-to-end smoke test: serves the app, drives it in headless Chromium and verifies
// import → timeline editing → playback → voice-over recording → export (validated with ffmpeg).
import http from 'node:http';
import net from 'node:net';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { findFfmpeg } from './gen-fixtures.mjs';

const root = new URL('../', import.meta.url).pathname;
const fixtures = join(root, 'test/fixtures');
const outDir = join(root, 'test/output'); mkdirSync(outDir, { recursive: true });
if (!existsSync(join(fixtures, 'clipA.webm'))) { console.log('generating fixtures…'); const r = spawnSync(process.execPath, [join(root, 'test/gen-fixtures.mjs')], { stdio: 'inherit' }); if (r.status !== 0) process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webm': 'video/webm', '.wav': 'audio/wav', '.json': 'application/json' };
// Serves the production build (dist/) with an SPA fallback, so the React router route /video-editor resolves.
const dist = join(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) { console.error('dist/index.html not found – run `npm run build` first'); process.exit(1); }
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let f = join(dist, p);
  try { if (p === '/' || !statSync(f).isFile()) throw new Error(); }
  catch { f = join(dist, 'index.html'); }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const results = [];
function check(name, cond, detail = '') { results.push({ name, ok: !!cond, detail }); if (!cond) failures++; console.log(`${cond ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`); }
const approx = (a, b, tol = 0.05) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 950 }, permissions: ['microphone'], locale: 'tr-TR' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
const consoleLines = [];
page.on('console', (m) => { consoleLines.push(`${m.type()} ${m.text()}`); if (m.type() === 'error') errors.push('console: ' + m.text()); });

try {
  await page.goto(base + '/video-editor');
  await page.waitForFunction(() => window.veditor && window.veditor.store && window.veditor.tl);
  check('app boots', true);

  // ---- import ----
  await page.setInputFiles('#fileInput', ['clipA.webm', 'clipB.webm', 'tone.wav', 'logo.png'].map((f) => join(fixtures, f)));
  await page.waitForFunction(() => document.querySelectorAll('.media-card').length === 4, null, { timeout: 30000 });
  await page.waitForFunction(() => [...window.veditor.store.media.values()].every((m) => !m.analyzing), null, { timeout: 60000 });
  const media = await page.evaluate(() => [...window.veditor.store.media.values()].map((m) => ({ name: m.name, kind: m.kind, duration: m.duration, w: m.width, h: m.height, thumbs: m.thumbnails.length, peaks: m.peaks ? m.peaks.length : 0, hasAudio: m.hasAudio })));
  const byName = Object.fromEntries(media.map((m) => [m.name, m]));
  check('clipA metadata', byName['clipA.webm'] && byName['clipA.webm'].kind === 'video' && approx(byName['clipA.webm'].duration, 6, 0.2) && byName['clipA.webm'].w === 640, JSON.stringify(byName['clipA.webm']));
  check('clipA thumbnails + waveform', byName['clipA.webm'].thumbs >= 4 && byName['clipA.webm'].peaks > 100 && byName['clipA.webm'].hasAudio === true);
  check('clipB metadata', byName['clipB.webm'].kind === 'video' && approx(byName['clipB.webm'].duration, 4, 0.2));
  check('tone metadata', byName['tone.wav'].kind === 'audio' && approx(byName['tone.wav'].duration, 5, 0.05) && byName['tone.wav'].peaks > 100);
  check('image metadata', byName['logo.png'].kind === 'image' && byName['logo.png'].w === 200 && byName['logo.png'].duration === 5);

  // ---- console diagnostics: an import must be explainable from the browser console alone ----
  const traceLines = consoleLines.filter((l) => /\[veditor\]|detected kind|metadata read/.test(l));
  check('the console reports the environment and each import step',
    traceLines.some((l) => /environment/.test(l)) && traceLines.some((l) => /blob: playback|detected kind/.test(l)) && consoleLines.some((l) => /detected kind/.test(l)) && consoleLines.some((l) => /metadata read/.test(l)),
    JSON.stringify(traceLines.slice(0, 3).map((l) => l.replace(/%c/g, '').slice(0, 60))));

  // ---- awkward real-world files: no extension / no MIME type, and a file the browser cannot decode ----
  const odd = {
    noExtVideo: join(outDir, 'camera-clip'),            // valid video bytes, no extension → must be sniffed
    noExtAudio: join(outDir, 'recording'),              // valid audio bytes, no extension
    broken: join(outDir, 'undecodable.mp4'),            // looks like video, cannot be decoded (like HEVC in a browser without it)
  };
  writeFileSync(odd.noExtVideo, readFileSync(join(fixtures, 'clipA.webm')));
  writeFileSync(odd.noExtAudio, readFileSync(join(fixtures, 'tone.wav')));
  writeFileSync(odd.broken, Buffer.alloc(300000, 7));
  await page.setInputFiles('#fileInput', [odd.noExtVideo, odd.noExtAudio]);
  await page.waitForFunction(() => window.veditor.store.media.size === 6, null, { timeout: 30000 }).catch(() => null);
  const sniffed = await page.evaluate(() => [...window.veditor.store.media.values()].filter((m) => ['camera-clip', 'recording'].includes(m.name)).map((m) => ({ name: m.name, kind: m.kind, duration: m.duration })));
  check('files without an extension are detected from their content', sniffed.length === 2 && sniffed.find((m) => m.name === 'camera-clip')?.kind === 'video' && sniffed.find((m) => m.name === 'recording')?.kind === 'audio', JSON.stringify(sniffed));

  const beforeBroken = await page.evaluate(() => window.veditor.store.media.size);
  await page.setInputFiles('#fileInput', odd.broken);
  await page.waitForTimeout(3000);
  const brokenOutcome = await page.evaluate(() => ({ n: window.veditor.store.media.size, toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent) }));
  const codecToast = brokenOutcome.toasts.find((t) => t.includes('undecodable.mp4'));
  check('an undecodable file is rejected with a reason, not a generic error', brokenOutcome.n === beforeBroken && !!codecToast && /(kode|codec|dönüştür|convert)/i.test(codecToast), JSON.stringify({ added: brokenOutcome.n - beforeBroken, toast: (codecToast || '').slice(0, 100) }));
  await page.waitForFunction(() => document.querySelectorAll('[data-sonner-toast]').length === 0, null, { timeout: 15000 }).catch(() => null); // let the toasts dismiss themselves; removing them by hand corrupts React's tree
  await page.evaluate(() => { const { store } = window.veditor; for (const m of [...store.media.values()]) if (['camera-clip', 'recording'].includes(m.name)) store.removeMedia(m.id); }); // back to the four fixtures for the rest of the run

  // ---- codec fallback: a file this browser cannot decode is converted with the bundled ffmpeg.wasm ----
  // The fixtures are VP8/Opus because that is what a browser can produce; an H.264/AAC MP4 (what phones
  // and WhatsApp hand out) is made here with the same ffmpeg core, then imported like a user's file.
  const nativeH264 = await page.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"'));
  const mp4Path = join(outDir, 'phone-clip.mp4');
  const mp4Bytes = await page.evaluate(async (bytes) => {
    const src = new File([new Uint8Array(bytes)], 'clipA.webm', { type: 'video/webm' });
    const out = await window.veditor.ffmpeg.runFFmpeg(src, ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k'], 'out.mp4', { type: 'video/mp4' });
    return [...new Uint8Array(await out.arrayBuffer())];
  }, [...readFileSync(join(fixtures, 'clipA.webm'))]);
  writeFileSync(mp4Path, Buffer.from(mp4Bytes));
  check('ffmpeg.wasm core runs in the browser', mp4Bytes.length > 50000, `${mp4Bytes.length} bytes of H.264/AAC, native support: ${nativeH264 || 'none'}`);

  const mediaBefore = await page.evaluate(() => window.veditor.store.media.size);
  await page.setInputFiles('#fileInput', mp4Path);
  await page.waitForFunction((n) => window.veditor.store.media.size === n + 1, mediaBefore, { timeout: 180000 });
  await page.waitForFunction(() => [...window.veditor.store.media.values()].every((m) => !m.analyzing), null, { timeout: 120000 });
  const imported = await page.evaluate(() => { const m = [...window.veditor.store.media.values()].find((x) => x.name === 'phone-clip.mp4'); return { kind: m.kind, duration: +m.duration.toFixed(2), w: m.width, h: m.height, transcoded: !!m.transcoded, thumbs: m.thumbnails.length, peaks: m.peaks ? m.peaks.length : 0, hasAudio: m.hasAudio }; });
  check('an H.264 file imports (converted when the browser lacks the codec)',
    imported.kind === 'video' && approx(imported.duration, 6, 0.3) && imported.w === 640 && imported.thumbs >= 4 && imported.peaks > 100 && imported.hasAudio === true && (nativeH264 ? true : imported.transcoded),
    JSON.stringify(imported));
  await page.evaluate(() => { const { store } = window.veditor; const m = [...store.media.values()].find((x) => x.name === 'phone-clip.mp4'); store.removeMedia(m.id); });

  // ---- place on timeline ----
  const placed = await page.evaluate(() => {
    const { store, addMediaToTimeline } = window.veditor;
    const id = (n) => [...store.media.values()].find((m) => m.name === n).id;
    const v1 = store.firstTrackOfKind('video');
    const a = addMediaToTimeline(id('clipA.webm'), { trackId: v1.id, time: 0 });
    const v2 = store.addTrack('video'); // new top layer
    const b = addMediaToTimeline(id('clipB.webm'), { trackId: v2.id, time: 1 });
    store.updateClip(b.id, { scale: 0.33, x: 32, y: -32, fit: 'contain' }); // PiP top-right
    const tone = addMediaToTimeline(id('tone.wav'), { time: 0.5 }); // auto audio track
    const logo = addMediaToTimeline(id('logo.png'), { time: 6 }); // no track given → primary (bottom) video track, after clipA
    return { clips: store.project.clips.map((c) => ({ id: c.id, track: store.getTrack(c.trackId).kind, trackId: c.trackId, start: c.start, duration: c.duration })), tracks: store.project.tracks.map((t) => t.kind), duration: store.projectDuration(), a: a.id, b: b.id, tone: tone.id, logo: logo.id, v1: v1.id, v2: v2.id };
  });
  check('4 clips placed', placed.clips.length === 4, JSON.stringify(placed.clips));
  check('audio auto-track chosen', placed.clips.find((c) => c.id === placed.tone).track === 'audio');
  check('logo placed on primary video track right after clipA', (() => { const l = placed.clips.find((c) => c.id === placed.logo); return l.trackId === placed.v1 && approx(l.start, 6, 0.3); })());
  check('project duration ~11s', approx(placed.duration, 11, 0.4), String(placed.duration));

  // ---- overlap prevention ----
  const overlap = await page.evaluate(({ a }) => {
    const { store } = window.veditor;
    const clip = store.getClip(a);
    const start = store.findPlacement(clip.trackId, 2, 3, []); // clipA occupies 0–6 → must move after it
    return { start, free: store.isFree(clip.trackId, 2, 3) };
  }, placed);
  check('overlap prevented (placement pushed after clip)', overlap.free === false && overlap.start >= 5.9, JSON.stringify(overlap));

  // ---- split / undo / redo ----
  const split = await page.evaluate(({ a }) => {
    const { store, player, splitSelected } = window.veditor;
    player.seek(2); store.selectClips([a]); splitSelected();
    const after = store.project.clips.length;
    const parts = store.clipsOnTrack(store.getClip(a).trackId).map((c) => ({ start: c.start, duration: c.duration, offset: c.offset }));
    store.undo(); const undone = store.project.clips.length; store.redo(); const redone = store.project.clips.length;
    return { after, parts, undone, redone };
  }, placed);
  check('split creates two parts', split.after === 5 && approx(split.parts[0].duration, 2) && approx(split.parts[1].start, 2) && approx(split.parts[1].offset, 2), JSON.stringify(split.parts));
  check('undo / redo', split.undone === 4 && split.redone === 5);

  // ---- mouse drag: move clipB right by 120px, then trim its right edge ----
  const pps = await page.evaluate(() => window.veditor.tl.pps);
  const bBox = await page.locator(`.clip[data-clip-id="${placed.b}"]`).boundingBox();
  await page.mouse.move(bBox.x + bBox.width / 2, bBox.y + bBox.height / 2);
  await page.mouse.down(); await page.mouse.move(bBox.x + bBox.width / 2 + 60, bBox.y + bBox.height / 2, { steps: 5 }); await page.mouse.move(bBox.x + bBox.width / 2 + 120, bBox.y + bBox.height / 2, { steps: 5 }); await page.mouse.up();
  const afterMove = await page.evaluate(({ b }) => window.veditor.store.getClip(b).start, placed);
  check('drag moves clip', approx(afterMove, 1 + 120 / pps, 0.3), `start=${afterMove.toFixed(2)} expected≈${(1 + 120 / pps).toFixed(2)}`);
  const bBox2 = await page.locator(`.clip[data-clip-id="${placed.b}"]`).boundingBox();
  await page.mouse.move(bBox2.x + bBox2.width - 3, bBox2.y + bBox2.height / 2);
  await page.mouse.down(); await page.mouse.move(bBox2.x + bBox2.width - 43, bBox2.y + bBox2.height / 2, { steps: 6 }); await page.mouse.up();
  const afterTrim = await page.evaluate(({ b }) => window.veditor.store.getClip(b).duration, placed);
  check('trim handle shortens clip', afterTrim < 4 && approx(afterTrim, 4 - 40 / pps, 0.3), `duration=${afterTrim.toFixed(2)}`);
  const hist = await page.evaluate(() => ({ canUndo: window.veditor.store.canUndo(), n: window.veditor.store.history.length }));
  check('drag operations recorded in history', hist.canUndo && hist.n >= 6, JSON.stringify(hist));

  // ---- playback ----
  const play = await page.evaluate(async ({ b }) => {
    const { player, store } = window.veditor;
    player.seek(store.getClip(b).start + 0.2); await player.play();
    await new Promise((r) => setTimeout(r, 1500));
    // give slow decoders (loaded CI machines) a moment: wait until every active visual element has a frame
    for (let i = 0; i < 40 && player._visualClips(player.currentTime).some(({ clip }) => player.nodes.get(clip.id)?.el.readyState < 2); i++) await new Promise((r) => setTimeout(r, 100));
    const t = player.currentTime; const playing = player.playing;
    const g = player.canvas.getContext('2d');
    const px = g.getImageData(player.canvas.width / 2, player.canvas.height / 2, 1, 1).data; // centre of frame → clipA blue
    const pip = g.getImageData(Math.round(player.canvas.width * 0.82), Math.round(player.canvas.height * 0.18), 1, 1).data; // PiP area → clipB
    const actives = [...player.nodes.values()].filter((n) => n.el && n.el.tagName !== 'IMG' && !n.el.paused).length;
    player.pause();
    return { t: t - store.getClip(b).start - 0.2, playing, px: [...px], pip: [...pip], actives, ctxState: player.audio.state };
  }, placed);
  check('clock advances while playing', play.playing && play.t > 1.0 && play.t < 2.0, `elapsed=${play.t.toFixed(2)} audio=${play.ctxState}`);
  check('composite frame shows base video', play.px[2] > 100 && play.px[0] < 80, `centre rgb=${play.px.slice(0, 3)}`);
  check('PiP layer drawn on top', (play.pip[1] > 120 || play.pip[0] > 200), `pip rgb=${play.pip.slice(0, 3)}`);
  check('media elements were playing', play.actives >= 2, `active=${play.actives}`);

  // ---- engine revival (React StrictMode runs effect cleanup + re-run on the same engine instance) ----
  const revive = await page.evaluate(async ({ b }) => {
    const { player, store } = window.veditor;
    player.destroy(); player.attach();
    player.seek(store.getClip(b).start + 0.2); await player.play();
    await new Promise((r) => setTimeout(r, 1200));
    const t = player.currentTime - store.getClip(b).start - 0.2; const playing = player.playing;
    const ui = document.getElementById('timeCurrent').textContent;
    const px = player.canvas.getContext('2d').getImageData(player.canvas.width / 2, player.canvas.height / 2, 1, 1).data;
    const actives = [...player.nodes.values()].filter((n) => n.el && n.el.tagName !== 'IMG' && !n.el.paused).length;
    player.pause();
    return { t, playing, ui, px: [...px], actives };
  }, placed);
  check('player plays again after destroy()+attach()', revive.playing && revive.t > 0.8 && revive.ui !== '00:00.000' && revive.px[2] > 100 && revive.actives >= 2, JSON.stringify(revive));

  // ---- grid view ----
  const grid = await page.evaluate(async ({ b }) => {
    const { player, store } = window.veditor; player.viewMode = 'grid'; player.seek(store.getClip(b).start + 0.5);
    await new Promise((r) => setTimeout(r, 400)); // let both decoders deliver the seeked frame
    for (let i = 0; i < 40 && player._visualClips(player.currentTime).some(({ clip }) => player.nodes.get(clip.id)?.el.readyState < 2); i++) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, 50)); // one more frame so the render loop draws the ready frame
    const g = player.canvas.getContext('2d'); const W = player.canvas.width, H = player.canvas.height;
    const left = g.getImageData(Math.round(W * 0.25), Math.round(H * 0.5), 1, 1).data; const right = g.getImageData(Math.round(W * 0.75), Math.round(H * 0.5), 1, 1).data;
    const tm = player.currentTime;
    const visual = player._visualClips(tm).map((v) => { const n = player.nodes.get(v.clip.id); return `${v.track.name}:${v.clip.name}@${v.clip.start.toFixed(2)} rs=${n && n.el.readyState} ct=${n && (+n.el.currentTime).toFixed(2)}`; });
    player.viewMode = 'composite';
    return { left: [...left], right: [...right], tm, visual };
  }, placed);
  check('grid view renders two channels side by side', (grid.left[0] + grid.left[1] + grid.left[2] > 60) && (grid.right[0] + grid.right[1] + grid.right[2] > 60), JSON.stringify(grid));

  // ---- detach audio ----
  const detach = await page.evaluate(({ a }) => {
    const { store, detachAudioSelected } = window.veditor; store.selectClips([a]); detachAudioSelected();
    const orig = store.getClip(a); const audioTracks = store.project.tracks.filter((t) => t.kind === 'audio');
    const copies = store.project.clips.filter((c) => c.mediaId === orig.mediaId && audioTracks.some((t) => t.id === c.trackId));
    return { muted: orig.muted, copies: copies.length, sameStart: copies.some((c) => Math.abs(c.start - orig.start) < 1e-6 && Math.abs(c.duration - orig.duration) < 1e-6) };
  }, placed);
  check('detach audio → copy on audio track, original muted', detach.muted && detach.copies === 1 && detach.sameStart, JSON.stringify(detach));

  // ---- voice-over recording (fake microphone) ----
  await page.evaluate(() => window.veditor.player.seek(3));
  const clipsBefore = await page.evaluate(() => window.veditor.store.project.clips.length);
  await page.click('#btnRecordVoice');
  await page.click('[data-testid=record-start]');
  await page.waitForTimeout(1800);
  await page.click('[data-testid=record-stop]');
  await page.waitForFunction((n) => window.veditor.store.project.clips.length === n + 1, clipsBefore, { timeout: 20000 });
  await page.waitForFunction(() => [...window.veditor.store.media.values()].every((m) => !m.analyzing), null, { timeout: 30000 });
  const rec = await page.evaluate(() => { const { store } = window.veditor; const m = [...store.media.values()].find((x) => x.recorded); const c = store.project.clips.find((x) => x.mediaId === m.id); return { kind: m.kind, duration: m.duration, start: c.start, track: store.getTrack(c.trackId).kind }; });
  check('voice-over recorded and placed at playhead on an audio track', rec.kind === 'audio' && rec.duration > 1 && rec.duration < 4 && approx(rec.start, 3, 0.05) && rec.track === 'audio', JSON.stringify(rec));

  // ---- project save / load round trip ----
  const roundtrip = await page.evaluate(() => {
    const { store } = window.veditor; const json = JSON.parse(JSON.stringify(store.toJSON()));
    const before = store.project.clips.length;
    store.loadProject(json.project);
    return { before, after: store.project.clips.length, tracks: store.project.tracks.length, media: json.media.length };
  });
  check('project JSON round trip', roundtrip.before === roundtrip.after && roundtrip.media === 5, JSON.stringify(roundtrip));

  // ---- text layer ----
  const txt = await page.evaluate(async () => {
    const { store, player, addTextClip } = window.veditor;
    player.pause(); player.seek(0.5);
    const c = addTextClip(0.5, 'VEDITOR TEST');
    store.updateClip(c.id, { bgEnabled: true, bgColor: '#ff0000', bgOpacity: 1, color: '#ffffff', fontSize: 12, x: 0, y: 30, transIn: { type: 'none', duration: 0.4 } });
    player.seek(1.5);
    await new Promise((r) => setTimeout(r, 300));
    const g = player.canvas.getContext('2d'); const W = player.canvas.width, H = player.canvas.height;
    // the box is centred at (50%, 80%) and padded around a 12%-high line: sample inside the box just above the glyphs
    const box = g.getImageData(Math.round(W * 0.5), Math.round(H * 0.8 - H * 0.12 * 0.75), 1, 1).data;
    const el = document.querySelector(`.clip[data-clip-id="${c.id}"]`);
    return { kind: c.kind, track: store.getTrack(c.trackId).kind, duration: c.duration, box: [...box], label: el && el.querySelector('.clip-label').textContent, cls: el && el.className };
  });
  check('text layer placed on a video track', txt.kind === 'text' && txt.track === 'video' && txt.duration === 5 && /VEDITOR TEST/.test(txt.label) && /\btext\b/.test(txt.cls), JSON.stringify({ ...txt, box: undefined }));
  check('text layer renders its background box', txt.box[0] > 180 && txt.box[1] < 90 && txt.box[2] < 90, `rgb=${txt.box.slice(0, 3)}`);

  // ---- transitions: cross dissolve between the two halves of clip A, fade-in on clip B ----
  const trans = await page.evaluate(async ({ b, v1 }) => {
    const { store, player } = window.veditor;
    const parts = store.clipsOnTrack(v1).filter((c) => c.kind !== 'text');
    const a2 = parts[1]; // starts at 2.0 right after the first half
    store.updateClip(a2.id, { transIn: { type: 'fade', duration: 1 } });
    const bc = store.getClip(b);
    store.updateClip(b, { transIn: { type: 'fade', duration: 1 }, scale: 1, x: 0, y: 0 });
    const vis = player._visualClips(a2.start + 0.5).map((v) => ({ name: v.clip.name, ext: v.extended }));
    const fx0 = player._transitionFx(bc, bc.start + 0.1), fx1 = player._transitionFx(bc, bc.start + 0.9), fxN = player._transitionFx(bc, bc.start + 2);
    // element of the extended predecessor must be considered active during the blend
    player.seek(a2.start + 0.5); player._syncElements(a2.start + 0.5);
    const prevNode = player.nodes.get(parts[0].id);
    const g = player.canvas.getContext('2d'); const W = player.canvas.width, H = player.canvas.height;
    player.seek(bc.start + 0.1); await new Promise((r) => setTimeout(r, 350)); player.render(bc.start + 0.1);
    const early = g.getImageData(Math.round(W * 0.5), Math.round(H * 0.5), 1, 1).data;
    player.seek(bc.start + 0.95); await new Promise((r) => setTimeout(r, 350)); player.render(bc.start + 0.95);
    const late = g.getImageData(Math.round(W * 0.5), Math.round(H * 0.5), 1, 1).data;
    return { vis, fx0: fx0.alpha, fx1: fx1.alpha, fxN: fxN.alpha, prevGain: prevNode && prevNode.gain ? prevNode.gain.gain.value : null, early: [...early], late: [...late] };
  }, placed);
  check('cross dissolve keeps the previous clip drawn (extended) during the blend', trans.vis.length >= 2 && trans.vis[0].ext === true && trans.vis[1].ext === false && trans.vis.slice(2).every((v) => !v.ext), JSON.stringify(trans.vis));
  check('fade transition ramps alpha 0→1 over its duration', approx(trans.fx0, 0.1, 0.02) && approx(trans.fx1, 0.9, 0.02) && trans.fxN === 1, `alpha=${trans.fx0},${trans.fx1},${trans.fxN}`);
  check('fading-in clip blends over the layer below', trans.early[2] > trans.late[2] + 40 && trans.late[1] > trans.early[1] + 40, `early=${trans.early.slice(0, 3)} late=${trans.late.slice(0, 3)}`);

  // ---- dockable panels ----
  const box = () => page.evaluate(() => {
    const rect = (id) => { const el = document.getElementById(id); if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }; };
    const panels = {};
    for (const id of ['libraryPanel', 'previewPanel', 'inspectorPanel', 'sourcePanel', 'timelinePanel']) panels[id] = rect(id);
    return { docW: document.documentElement.scrollWidth, vw: window.innerWidth, vh: window.innerHeight, lang: document.documentElement.lang, title: document.getElementById('inspectorTitle').textContent, panels, tabs: [...document.querySelectorAll('.dv-tab')].map((t) => t.textContent.trim()) };
  });
  const layout = await box();
  const p = layout.panels;
  check('layout fits the viewport (every panel visible, no horizontal overflow)',
    layout.docW <= layout.vw && Object.values(p).every((b) => b && b.w > 60 && b.h > 60 && b.right <= layout.vw + 1 && b.bottom <= layout.vh + 1),
    JSON.stringify({ docW: layout.docW, vw: layout.vw, panels: p }));
  check('the default arrangement: settings top-left, the source player under it, the timeline across the bottom',
    layout.tabs.length === 5 && p.inspectorPanel.x < p.previewPanel.x && p.sourcePanel.x === p.inspectorPanel.x && p.sourcePanel.y >= p.inspectorPanel.bottom - 40
      && p.timelinePanel.y >= p.previewPanel.bottom - 40 && p.timelinePanel.w > layout.vw * 0.9 && p.libraryPanel.x > p.previewPanel.x,
    JSON.stringify({ tabs: layout.tabs, inspector: p.inspectorPanel, source: p.sourcePanel, timeline: p.timelinePanel }));

  // ---- source player: shows what is selected or dropped, and never plays over the timeline ----
  const clipAId = await page.evaluate(() => [...window.veditor.store.media.values()].find((m) => m.name === 'clipA.webm').id);
  await page.click(`.media-card[data-id="${clipAId}"]`);
  const sourcePlay = await page.evaluate(async () => {
    const v = document.getElementById('sourceVideo');
    if (!v) return { shown: false };
    await window.veditor.player.play();           // the timeline monitor is running…
    const timelineWas = window.veditor.player.playing;
    await v.play().catch(() => {});               // …and must stand down when the source plays
    await new Promise((r) => setTimeout(r, 800));
    const out = { shown: true, blob: v.currentSrc.startsWith('blob:'), t: v.currentTime, name: document.querySelector('#sourcePanel h2').textContent, timelineWas, timelineNow: window.veditor.player.playing };
    v.pause();
    return out;
  });
  check('the source player plays the selected clip and stops the timeline monitor',
    sourcePlay.shown && sourcePlay.blob && sourcePlay.t > 0.2 && sourcePlay.name === 'clipA.webm' && sourcePlay.timelineWas === true && sourcePlay.timelineNow === false,
    JSON.stringify(sourcePlay));

  const droppedOnSource = await page.evaluate(async (bytes) => {
    const stage = document.getElementById('sourceStage');
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'dropped-clip.webm', { type: 'video/webm' }));
    stage.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    stage.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    const shown = () => document.querySelector('#sourcePanel h2').textContent === 'dropped-clip.webm' && !!document.getElementById('sourceVideo')?.getAttribute('src')?.startsWith('blob:');
    for (let i = 0; i < 100 && !shown(); i++) await new Promise((r) => setTimeout(r, 100));
    return { name: document.querySelector('#sourcePanel h2').textContent, inLibrary: [...window.veditor.store.media.values()].some((m) => m.name === 'dropped-clip.webm'), src: !!document.getElementById('sourceVideo')?.getAttribute('src')?.startsWith('blob:') };
  }, [...readFileSync(join(fixtures, 'clipB.webm'))]);
  check('a file dropped on the source player is imported and shown there', droppedOnSource.name === 'dropped-clip.webm' && droppedOnSource.inLibrary && droppedOnSource.src === true, JSON.stringify(droppedOnSource));
  await page.evaluate(() => { const { store } = window.veditor; const m = [...store.media.values()].find((x) => x.name === 'dropped-clip.webm'); if (m) store.removeMedia(m.id); });

  // ---- panels can be hidden, brought back, rearranged and reset ----
  await page.click('#btnLayout');
  await page.click('#layoutMenu [data-panel="source"]');
  await page.waitForTimeout(250);
  const hidden = await page.evaluate(() => !!document.getElementById('sourcePanel'));
  await page.click('#layoutMenu [data-panel="source"]');
  await page.waitForTimeout(250);
  const restored = await page.evaluate(() => !!document.getElementById('sourcePanel'));
  await page.keyboard.press('Escape');
  check('the layout menu hides a panel and brings it back', hidden === false && restored === true, JSON.stringify({ hidden, restored }));

  // a real mouse drag of a tab, the way a user rearranges the workspace
  const sourceTitle = await page.evaluate(() => window.veditor.dock.api.getPanel('source').title);
  const groupsBefore = await page.evaluate(() => window.veditor.dock.api.groups.length);
  const tabBox = await page.locator('.dv-tab').filter({ hasText: sourceTitle }).first().boundingBox();
  const previewBox = await page.locator('#previewPanel').boundingBox();
  await page.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2, { steps: 20 });
  await page.mouse.move(previewBox.x + previewBox.width / 2 + 4, previewBox.y + previewBox.height / 2, { steps: 4 });
  await page.waitForTimeout(300);
  const dropTarget = await page.evaluate(() => !!document.querySelector('.dv-drop-target-anchor, .dv-drop-target'));
  await page.mouse.up();
  await page.waitForTimeout(800);
  const dragged = await page.evaluate(() => ({
    groups: window.veditor.dock.api.groups.length,
    group: window.veditor.dock.api.getPanel('source').group.panels.map((x) => x.id),
    saved: (localStorage.getItem('veditor.layout.v1') || '').includes('"source"'),
  }));
  check('a panel tab can be dragged onto another panel with the mouse, and the arrangement is stored',
    dropTarget && dragged.groups === groupsBefore - 1 && dragged.group.includes('source') && dragged.group.includes('preview') && dragged.saved,
    JSON.stringify({ dropTarget, groupsBefore, ...dragged }));

  await page.evaluate(() => window.veditor.dock.reset());
  await page.waitForTimeout(600);
  const afterReset = await box();
  check('the default arrangement can be restored, with its original proportions',
    afterReset.panels.libraryPanel.x > afterReset.panels.previewPanel.x && afterReset.panels.sourcePanel.x === afterReset.panels.inspectorPanel.x && afterReset.tabs.length === 5
      && approx(afterReset.panels.inspectorPanel.w, p.inspectorPanel.w, 2) && approx(afterReset.panels.libraryPanel.w, p.libraryPanel.w, 2) && approx(afterReset.panels.sourcePanel.h, p.sourcePanel.h, 2),
    JSON.stringify(afterReset.panels));
  check('Turkish locale picks Turkish UI', layout.lang === 'tr' && /Özellikler|Klip|Kanal|Proje/.test(layout.title), layout.title);
  await page.screenshot({ path: join(outDir, 'editor.png') });

  // ---- UI-level checks: inspector, context menu, export dialog ----
  await page.click(`.clip[data-clip-id="${placed.b}"]`);
  const insp = await page.evaluate(() => ({ title: document.getElementById('inspectorTitle').textContent, ranges: document.querySelectorAll('#inspectorBody [data-slot=slider]').length, presets: document.querySelectorAll('#inspectorBody [data-testid=layout-presets] button').length }));
  check('inspector shows clip properties', /Klip/.test(insp.title) && insp.ranges >= 4 && insp.presets >= 7, JSON.stringify(insp));
  await page.click(`.clip[data-clip-id="${placed.b}"]`, { button: 'right' });
  await page.waitForSelector('#contextMenu', { timeout: 5000 }).catch(() => null);
  const menuItems = await page.evaluate(() => { const m = document.getElementById('contextMenu'); return m ? m.querySelectorAll('[data-slot=context-menu-item]').length : 0; });
  check('context menu opens on right-click', menuItems >= 6, `items=${menuItems}`);
  await page.keyboard.press('Escape');
  await page.click('#btnExport');
  await page.waitForSelector('#exFormat');
  await page.selectOption('#exFormat', { index: await page.evaluate(() => [...document.querySelectorAll('#exFormat option')].findIndex((o) => /VP8/.test(o.textContent))) });
  await page.evaluate(() => { const { store } = window.veditor; store.pushHistory(); for (const c of store.project.clips) { if (c.start >= 2) { store.removeClips([c.id], { silent: true }); continue; } if (c.start + c.duration > 2) c.duration = 2 - c.start; } store.changed('trim-for-ui-test'); });
  await page.click('[data-testid=export-start]');
  await page.waitForSelector('#exResult a[download]', { timeout: 30000 });
  const dlg = await page.evaluate(() => ({ href: document.querySelector('#exResult a[download]').getAttribute('download'), status: document.getElementById('exStatus').textContent, size: window.__lastExport && window.__lastExport.blob.size }));
  check('export dialog produces a downloadable file', /\.webm$/.test(dlg.href) && dlg.size > 10000, JSON.stringify(dlg));
  await page.click('[data-testid=export-close]');
  await page.evaluate(() => { const { store } = window.veditor; store.undo(); });

  // ---- export (shorten the project first so the real-time export stays quick) ----
  const exp = await page.evaluate(async () => {
    const { store, exporter } = window.veditor;
    store.pushHistory();
    for (const c of store.project.clips) { if (c.start >= 3.5) { store.removeClips([c.id], { silent: true }); continue; } if (c.start + c.duration > 3.5) c.duration = 3.5 - c.start; }
    store.changed('trim-for-test');
    const formats = window.veditor.supportedFormats();
    const fmt = formats.find((f) => /vp8/.test(f.mime)) || formats.find((f) => f.ext === 'webm') || formats[0]; // VP8: decodable by the bundled ffmpeg
    const progress = [];
    const out = await exporter.run({ format: fmt, fps: 30, videoBitrate: 2500000, audioBitrate: 128000, muteMonitor: true }, (p) => progress.push(p.progress));
    const buf = new Uint8Array(await out.blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return { formats: formats.map((f) => f.mime), mime: fmt.mime, size: out.blob.size, duration: out.duration, progressSamples: progress.length, maxProgress: Math.max(...progress), b64: btoa(s), ext: out.ext };
  });
  check('export produced data', exp.size > 20000 && exp.progressSamples > 3 && exp.maxProgress > 0.9, `size=${exp.size} mime=${exp.mime} duration=${exp.duration.toFixed(2)} formats=${exp.formats.length}`);
  const outFile = join(outDir, 'export.' + exp.ext);
  writeFileSync(outFile, Buffer.from(exp.b64, 'base64'));
  const ffmpeg = findFfmpeg();
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', outFile], { encoding: 'utf8' }).stderr;
  const durMatch = probe.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
  const probedDur = durMatch ? (+durMatch[1]) * 3600 + (+durMatch[2]) * 60 + (+durMatch[3]) : NaN;
  check('exported file has video + audio streams', /Video: vp[89]/.test(probe) && /Audio: opus/.test(probe), probe.split('\n').filter((l) => /Stream|Duration/.test(l)).join(' | ').trim());
  check('exported WebM carries duration metadata (patched)', isFinite(probedDur) && approx(probedDur, 3.5, 0.6), `probed=${probedDur}`);
  const decode = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', outFile, '-f', 'image2', '-frames:v', '3', join(outDir, 'frame%d.png')], { encoding: 'utf8' });
  check('exported file decodes without errors', decode.status === 0 && !decode.stderr.trim() && existsSync(join(outDir, 'frame3.png')), decode.stderr.trim().slice(0, 200));

  // ---- host-app menu navigation: leave the editor route and come back (unmount + remount) ----
  const beforeNav = await page.evaluate(() => { const { store, player } = window.veditor; player.seek(1.25); return { clips: store.project.clips.length, media: store.media.size, time: player.currentTime, pps: window.veditor.tl.pps }; });
  await page.evaluate(() => window.veditor.tl.zoomBy(1.7));
  await page.click('nav a[href="/dashboard"]');
  await page.waitForFunction(() => !document.getElementById('previewPanel'));
  const hostLeft = await page.evaluate(() => ({ mediaHosts: document.querySelectorAll('.ve-media-host').length, videos: document.querySelectorAll('video').length }));
  check('editor unmounts cleanly when leaving the route', hostLeft.mediaHosts === 0 && hostLeft.videos === 0, JSON.stringify(hostLeft));
  await page.click('nav a[href="/video-editor"]');
  await page.waitForFunction(() => window.veditor && window.veditor.tl && document.getElementById('previewPanel'));
  const afterNav = await page.evaluate(() => { const { store, player, tl } = window.veditor; return { clips: store.project.clips.length, media: store.media.size, time: player.currentTime, cards: document.querySelectorAll('.media-card').length, clipEls: document.querySelectorAll('.clip').length, pps: tl.pps, timeUi: document.getElementById('timeCurrent').textContent }; });
  check('project survives leaving and returning to the route', afterNav.clips === beforeNav.clips && afterNav.media === beforeNav.media && afterNav.cards === beforeNav.media && afterNav.clipEls === beforeNav.clips && approx(afterNav.time, 1.25, 0.01) && afterNav.pps > beforeNav.pps * 1.5, JSON.stringify({ beforeNav, afterNav }));
  const remount = await page.evaluate(async () => {
    const { player } = window.veditor;
    await player.play();
    await new Promise((r) => setTimeout(r, 1200));
    const t = player.currentTime; const playing = player.playing; const ui = document.getElementById('timeCurrent').textContent;
    const px = player.canvas.getContext('2d').getImageData(player.canvas.width / 2, player.canvas.height / 2, 1, 1).data;
    const actives = [...player.nodes.values()].filter((n) => n.el && n.el.tagName !== 'IMG' && !n.el.paused).length;
    player.pause();
    return { t, playing, ui, px: [...px], actives };
  });
  check('playback works again after returning to the route', remount.playing && remount.t > 2.0 && remount.ui !== '00:00.000' && remount.px[2] > 100 && remount.actives >= 1, JSON.stringify(remount));

  check('no page errors', errors.length === 0, errors.join(' ; ').slice(0, 500));
} catch (e) {
  failures++; console.error('❌ test crashed:', e);
} finally {
  await browser.close();
}

// ---- real-user run: default autoplay policy, no fake flags, real mouse clicks on the buttons ----
{
  const b2 = await chromium.launch({ channel: 'chromium' });
  const p2 = await b2.newPage({ viewport: { width: 1600, height: 950 }, locale: 'tr-TR' });
  const errs2 = []; p2.on('pageerror', (e) => errs2.push('pageerror: ' + e.message)); p2.on('console', (m) => { if (m.type() === 'error') errs2.push('console: ' + m.text()); });
  try {
    await p2.goto(base + '/video-editor');
    await p2.waitForFunction(() => window.veditor && window.veditor.tl);
    await p2.setInputFiles('#fileInput', [join(fixtures, 'clipA.webm')]);
    await p2.waitForFunction(() => document.querySelectorAll('.media-card').length === 1 && [...window.veditor.store.media.values()].every((m) => !m.analyzing), null, { timeout: 30000 });
    await p2.hover('.media-card'); await p2.click('.media-card .actions button:first-child'); // "+" → add to timeline
    await p2.waitForFunction(() => window.veditor.store.project.clips.length === 1);
    const readPlay = async () => p2.evaluate(() => { const { player } = window.veditor; const px = player.canvas.getContext('2d').getImageData(player.canvas.width / 2, player.canvas.height / 2, 1, 1).data;
      return { t: player.currentTime, playing: player.playing, ui: document.getElementById('timeCurrent').textContent, audio: player.audio ? player.audio.state : 'none', px: [...px], actives: [...player.nodes.values()].filter((n) => n.el && n.el.tagName !== 'IMG' && !n.el.paused).length, btn: document.getElementById('btnPlay').querySelector('svg').getAttribute('class') }; });
    await p2.click('#btnPlay');
    await p2.waitForTimeout(1500);
    const r1 = await readPlay();
    check('real click on Play starts playback (default autoplay policy)', r1.playing && r1.t > 1.0 && r1.ui !== '00:00.000' && r1.audio === 'running' && r1.px[2] > 100 && r1.actives === 1 && /pause/.test(r1.btn), JSON.stringify(r1));
    await p2.click('#btnPlay'); // pause
    const paused = await readPlay();
    check('real click on Play again pauses', !paused.playing && paused.actives === 0 && /play/.test(paused.btn), JSON.stringify(paused));
    // a rearranged workspace must still be there after a trip through the host app's menu
    await p2.evaluate(() => { const { api } = window.veditor.dock; api.getPanel('inspector').api.moveTo({ group: api.getPanel('library').group, position: 'center' }); });
    await p2.waitForTimeout(700);
    const stacked = await p2.evaluate(() => window.veditor.dock.api.getPanel('inspector').group.panels.map((x) => x.id));
    await p2.click('nav a[href="/dashboard"]');
    await p2.waitForFunction(() => !document.getElementById('previewPanel'));
    await p2.click('nav a[href="/video-editor"]');
    await p2.waitForFunction(() => window.veditor && window.veditor.tl && document.querySelectorAll('.clip').length === 1);
    await p2.waitForTimeout(500);
    const stackedAfter = await p2.evaluate(() => window.veditor.dock.api.getPanel('inspector').group.panels.map((x) => x.id));
    check('the panel arrangement survives a trip through the menu', stacked.length === 2 && stackedAfter.join() === stacked.join(), JSON.stringify({ stacked, stackedAfter }));
    await p2.evaluate(() => window.veditor.dock.reset());
    await p2.waitForTimeout(500);
    await p2.click('#btnPlay');
    await p2.waitForTimeout(1500);
    const r2 = await readPlay();
    check('project kept and Play works after switching menu pages', r2.playing && r2.t > paused.t + 1.0 && r2.px[2] > 100 && r2.actives === 1, JSON.stringify({ pausedAt: paused.t, r2 }));
    await p2.keyboard.press('Space');
    await p2.screenshot({ path: join(outDir, 'real-user.png') });
    check('no page errors (real-user run)', errs2.length === 0, errs2.join(' ; ').slice(0, 500));
  } catch (e) {
    failures++; console.error('❌ real-user run crashed:', e);
  } finally {
    await b2.close();
  }
}
// ---- server-side conversion: when the host can run ffmpeg, the tab does not have to ----
// Serves the same dist/ through PHP (as SiteGround does) so public/api/convert.php is live, and
// checks the whole contract: the host converts, the editor prefers it, and when the host says no
// the import still succeeds in the browser.
{
  const phpBin = spawnSync('sh', ['-c', 'command -v php'], { encoding: 'utf8' }).stdout.trim();
  // A full ffmpeg is what a real host has; the Playwright build only demuxes WebM, so the source
  // given to the server is chosen to match whatever this machine can actually read.
  const systemFfmpeg = spawnSync('sh', ['-c', 'command -v ffmpeg'], { encoding: 'utf8' }).stdout.trim();
  const hostFfmpeg = systemFfmpeg || findFfmpeg();
  const demuxers = hostFfmpeg ? spawnSync(hostFfmpeg, ['-hide_banner', '-demuxers'], { encoding: 'utf8' }).stdout || '' : '';
  const readsMp4 = /mov,mp4|mp4,/.test(demuxers);
  const srcMp4 = join(outDir, 'phone-clip.mp4'); // the H.264 file the main run produced
  if (!phpBin || !hostFfmpeg || !existsSync(srcMp4)) {
    console.log(`⏭  server-side conversion not tested (php: ${phpBin || 'missing'}, ffmpeg: ${hostFfmpeg || 'missing'}, fixture: ${existsSync(srcMp4)})`);
  } else {
    const jobs = join(outDir, 'convert-jobs');
    rmSync(jobs, { recursive: true, force: true }); mkdirSync(jobs, { recursive: true });
    const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
    const phpBase = `http://127.0.0.1:${port}`;
    const php = spawn(phpBin, ['-d', 'upload_max_filesize=64M', '-d', 'post_max_size=64M', '-S', `127.0.0.1:${port}`, '-t', dist, join(root, 'test/php-router.php')], {
      env: { ...process.env, VEDITOR_FFMPEG: hostFfmpeg, VEDITOR_WORKDIR: jobs, VEDITOR_MAX_JOBS: '2', PHP_CLI_SERVER_WORKERS: '6' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const phpLog = [];
    php.stdout.on('data', (d) => phpLog.push(String(d)));
    php.stderr.on('data', (d) => phpLog.push(String(d)));
    let health = null;
    for (let i = 0; i < 60 && !health; i++) {
      try { const r = await fetch(`${phpBase}/api/convert.php?action=health`); if (r.ok) health = await r.json(); } catch { /* not up yet */ }
      if (!health) await new Promise((r) => setTimeout(r, 250));
    }
    const b4 = await chromium.launch({ channel: 'chromium' });
    const p4 = await b4.newPage({ viewport: { width: 1400, height: 900 }, locale: 'tr-TR' });
    const errs4 = [];
    p4.on('pageerror', (e) => errs4.push(e.message));
    try {
      check('the host advertises what it can encode', !!health?.ok && !!health.ffmpeg && !!health.formats?.webm?.video && health.maxBytes > 1e6,
        JSON.stringify(health || { phpLog: phpLog.slice(-3) }));

      await p4.goto(phpBase + '/video-editor');
      await p4.waitForFunction(() => window.veditor && window.veditor.tl, null, { timeout: 30000 });
      const seen = await p4.evaluate(async () => { const h = await window.veditor.server.probeServer(); return { h, format: window.veditor.server.chooseFormat(h), playable: window.veditor.server.playableFormats() }; });
      check('the editor detects the service and picks a container both sides support',
        !!seen.h?.ok && seen.h.ffmpeg === health.ffmpeg && seen.format === 'webm' && seen.playable.includes('webm'), JSON.stringify(seen));

      // 1. the real thing: upload → convert on the host → download → import the result
      const source = readsMp4 ? srcMp4 : join(fixtures, 'clipA.webm'); // this ffmpeg build may only read WebM
      const real = await p4.evaluate(async ({ bytes, name, type }) => {
        const stages = [];
        const src = new File([new Uint8Array(bytes)], name, { type });
        const out = await window.veditor.server.transcodeOnServer(src, { onProgress: (p) => stages.push(`${p.stage}:${p.where}`) });
        const added = await window.veditor.importFiles([out]);
        const m = added[0];
        return { bytes: out.size, type: out.type, name: out.name, stages: [...new Set(stages)], kind: m?.kind, duration: +(m?.duration || 0).toFixed(2), w: m?.width || 0 };
      }, { bytes: [...readFileSync(source)], name: source.split('/').pop(), type: readsMp4 ? 'video/mp4' : 'video/webm' });
      check('the host converts a real upload and the result plays',
        real.bytes > 10000 && real.type === 'video/webm' && real.name.endsWith('.webm') && real.kind === 'video' && approx(real.duration, 6, 0.4) && real.w === 640
          && real.stages.includes('uploading:server') && real.stages.includes('converting:server'),
        JSON.stringify(real));
      await new Promise((r) => setTimeout(r, 1500)); // the client releases the job once it has the file
      check('the server keeps no leftovers once the file has been collected', readdirSync(jobs).length === 0, readdirSync(jobs).join(', '));
      await p4.evaluate(() => { const { store } = window.veditor; for (const m of [...store.media.values()]) store.removeMedia(m.id); window.veditor.server.resetServerProbe(); });

      // 2. the import path must prefer the host over ffmpeg.wasm for a file the browser cannot decode.
      // The host's own ffmpeg build may not read MP4 (Playwright's cannot), so the job protocol is
      // answered here with a real converted file – what the decision, upload and download code sees.
      const converted = readFileSync(join(fixtures, 'clipA.webm'));
      await p4.route('**/api/convert.php?action=start*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, job: 'a'.repeat(24) }) }));
      await p4.route('**/api/convert.php?action=status*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, state: 'done', progress: 1 }) }));
      await p4.route('**/api/convert.php?action=result*', (route) => route.fulfill({ status: 200, contentType: 'video/webm', body: converted }));
      await p4.route('**/api/convert.php?action=cancel*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
      await p4.setInputFiles('#fileInput', srcMp4);
      await p4.waitForFunction(() => window.veditor.store.media.size === 1, null, { timeout: 120000 });
      await p4.waitForFunction(() => [...window.veditor.store.media.values()].every((m) => !m.analyzing), null, { timeout: 120000 });
      const onServer = await p4.evaluate(() => { const m = [...window.veditor.store.media.values()][0]; return { name: m.name, kind: m.kind, duration: +m.duration.toFixed(2), w: m.width, transcoded: !!m.transcoded, by: m.convertedBy, thumbs: m.thumbnails.length }; });
      check('a file the browser cannot decode goes to the host, not to the tab',
        onServer.by === 'server' && onServer.transcoded && onServer.name === 'phone-clip.mp4' && onServer.kind === 'video' && approx(onServer.duration, 6, 0.4) && onServer.w === 640 && onServer.thumbs >= 4,
        JSON.stringify(onServer));

      // 3. a host with ffmpeg but only an encoder this browser cannot play (what veditor.krea.tr has:
      //    ffmpeg without libvpx) must be skipped before the upload, not after it
      await p4.evaluate(() => { const { store } = window.veditor; for (const m of [...store.media.values()]) store.removeMedia(m.id); window.veditor.server.resetServerProbe(); });
      let uploads = 0;
      await p4.unroute('**/api/convert.php?action=start*');
      await p4.route('**/api/convert.php?action=health*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, ffmpeg: '9.0', reason: null, formats: { mp4: { video: 'libx264', audio: 'aac' } }, maxBytes: 268435456, maxJobs: 2, tokenRequired: false }) }));
      await p4.route('**/api/convert.php?action=start*', (route) => { uploads++; route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"reason":"no-encoder"}' }); });
      await p4.setInputFiles('#fileInput', srcMp4);
      await p4.waitForFunction(() => window.veditor.store.media.size === 1, null, { timeout: 240000 });
      await p4.waitForFunction(() => [...window.veditor.store.media.values()].every((m) => !m.analyzing), null, { timeout: 120000 });
      const unplayable = await p4.evaluate(() => { const m = [...window.veditor.store.media.values()][0]; return { by: m.convertedBy, w: m.width, format: window.veditor.server.chooseFormat({ ok: true, formats: { mp4: {} } }) }; });
      check('a host that can only write a format this browser cannot play is skipped before the upload',
        unplayable.by === 'browser' && unplayable.w === 640 && uploads === 0 && unplayable.format === null, JSON.stringify({ ...unplayable, uploads }));

      // 4. the host may also be down, busy or misconfigured: the import must still succeed in the tab
      await p4.evaluate(() => { const { store } = window.veditor; for (const m of [...store.media.values()]) store.removeMedia(m.id); window.veditor.server.resetServerProbe(); });
      await p4.unroute('**/api/convert.php?action=health*');
      await p4.unroute('**/api/convert.php?action=start*');
      await p4.route('**/api/convert.php?action=start*', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'no ffmpeg', reason: 'ffmpeg-missing' }) }));
      await p4.setInputFiles('#fileInput', srcMp4);
      await p4.waitForFunction(() => window.veditor.store.media.size === 1, null, { timeout: 240000 });
      await p4.waitForFunction(() => [...window.veditor.store.media.values()].every((m) => !m.analyzing), null, { timeout: 120000 });
      const fellBack = await p4.evaluate(() => { const m = [...window.veditor.store.media.values()][0]; return { kind: m.kind, duration: +m.duration.toFixed(2), w: m.width, by: m.convertedBy }; });
      check('when the host refuses the job the browser converts it instead', fellBack.by === 'browser' && fellBack.kind === 'video' && approx(fellBack.duration, 6, 0.4) && fellBack.w === 640, JSON.stringify(fellBack));
      check('no page errors (server conversion run)', errs4.length === 0, errs4.join(' ; ').slice(0, 300));
    } catch (e) {
      failures++; console.error('❌ server conversion run crashed:', e, phpLog.slice(-5).join(''));
    } finally {
      await b4.close();
      php.kill('SIGTERM');
    }
  }
}
// ---- a restrictive Content-Security-Policy must be reported, not mistaken for broken files ----
{
  const cspServer = http.createServer((req, res) => {
    let p = join(dist, decodeURIComponent(req.url.split('?')[0]));
    if (!existsSync(p) || statSync(p).isDirectory()) p = join(dist, 'index.html');
    res.writeHead(200, {
      'content-type': MIME[extname(p)] || 'application/octet-stream',
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'", // what hosting panels install by default
    });
    res.end(readFileSync(p));
  }).listen(0);
  const cspBase = `http://127.0.0.1:${cspServer.address().port}`;
  const b3 = await chromium.launch({ channel: 'chromium' });
  const p3 = await b3.newPage({ viewport: { width: 1400, height: 900 }, locale: 'tr-TR' });
  try {
    await p3.goto(cspBase + '/video-editor');
    await p3.waitForFunction(() => window.veditor && window.veditor.tl, null, { timeout: 30000 });
    await p3.setInputFiles('#fileInput', join(fixtures, 'clipA.webm'));
    await p3.waitForFunction(() => [...document.querySelectorAll('[data-sonner-toast]')].some((t) => /CSP/i.test(t.textContent)), null, { timeout: 30000 }).catch(() => null);
    const state = await p3.evaluate(() => ({ media: window.veditor.store.media.size, toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent) }));
    const cspToasts = state.toasts.filter((t) => /CSP/i.test(t));
    check('a blocking Content-Security-Policy is explained instead of looking like a broken file',
      state.media === 0 && cspToasts.length >= 1 && cspToasts.some((t) => /blob:/.test(t)),
      JSON.stringify({ media: state.media, toast: (cspToasts[0] || state.toasts[0] || '').slice(0, 110) }));
  } catch (e) {
    failures++; console.error('❌ CSP run crashed:', e);
  } finally {
    await b3.close(); cspServer.close();
  }
}

server.close();
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
