// End-to-end smoke test: serves the app, drives it in headless Chromium and verifies
// import → timeline editing → playback → voice-over recording → export (validated with ffmpeg).
import http from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
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
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

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

  const layout = await page.evaluate(() => ({ docW: document.documentElement.scrollWidth, vw: window.innerWidth, inspector: document.getElementById('inspectorPanel').getBoundingClientRect().right, lang: document.documentElement.lang, title: document.getElementById('inspectorTitle').textContent }));
  check('layout fits the viewport (inspector visible, no horizontal overflow)', layout.docW <= layout.vw && layout.inspector <= layout.vw && layout.inspector > layout.vw - 320, JSON.stringify(layout));
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

  check('no page errors', errors.length === 0, errors.join(' ; ').slice(0, 500));
} catch (e) {
  failures++; console.error('❌ test crashed:', e);
} finally {
  await browser.close(); server.close();
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failures ? 1 : 0);
