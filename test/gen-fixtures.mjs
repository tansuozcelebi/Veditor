// Generates deterministic test media using headless Chromium (canvas + MediaRecorder),
// then remuxes through the Playwright-bundled ffmpeg so the files carry proper duration metadata.
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const dir = new URL('./fixtures/', import.meta.url).pathname;
mkdirSync(dir, { recursive: true });

function findFfmpeg() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(root)) for (const d of readdirSync(root)) if (d.startsWith('ffmpeg')) { const p = join(root, d, 'ffmpeg-linux'); if (existsSync(p)) return p; }
  return 'ffmpeg';
}
const ffmpeg = findFfmpeg();

const browser = await chromium.launch({ channel: 'chromium', args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
await page.goto('about:blank');

async function recordClip({ w, h, seconds, withAudio, paint }) {
  const b64 = await page.evaluate(async ({ w, h, seconds, withAudio, paintSrc }) => {
    const paint = new Function('g', 'w', 'h', 't', 'f', paintSrc);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; document.body.appendChild(canvas);
    const g = canvas.getContext('2d');
    const stream = canvas.captureStream(30);
    if (withAudio) {
      const ac = new AudioContext(); const osc = ac.createOscillator(); osc.frequency.value = 300; const gain = ac.createGain(); gain.gain.value = 0.3;
      const dest = ac.createMediaStreamDestination(); osc.connect(gain).connect(dest); osc.start(); await ac.resume();
      stream.addTrack(dest.stream.getAudioTracks()[0]);
    }
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' + (withAudio ? ',opus' : ''), videoBitsPerSecond: 800000 });
    const chunks = []; rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    let f = 0; const t0 = performance.now();
    await new Promise((res) => {
      const tick = () => { const t = (performance.now() - t0) / 1000; paint(g, w, h, t / seconds, f++); if (t < seconds) requestAnimationFrame(tick); else res(); };
      rec.start(200); tick();
    });
    rec.stop(); await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
    return btoa(s);
  }, { w, h, seconds, withAudio, paintSrc: paint });
  return Buffer.from(b64, 'base64');
}

function remux(raw, name, seconds) {
  const tmp = join(dir, name + '.raw.webm'); writeFileSync(tmp, raw);
  const out = join(dir, name);
  const r = spawnSync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', tmp, '-t', String(seconds), '-c:v', 'libvpx', '-b:v', '600k', '-auto-alt-ref', '0', '-c:a', 'copy', out]);
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
  spawnSync('rm', ['-f', tmp]);
  console.log('wrote', out, raw.length, 'bytes');
}

// clip A: 6 s, 640x360, blue background, moving white bar, red progress strip, embedded 300 Hz tone
remux(await recordClip({ w: 640, h: 360, seconds: 6, withAudio: true, paint: `
  g.fillStyle='#143ca0'; g.fillRect(0,0,w,h);
  g.fillStyle='#fff'; g.fillRect(t*w-12,0,24,h);
  g.fillStyle='#ff2828'; g.fillRect(0,h-30,t*w,30);
  g.fillStyle='#fff'; g.font='bold 40px sans-serif'; g.fillText('A '+f, 20, 60);` }), 'clipA.webm', 6);
// clip B: 4 s, 320x180 checkerboard, no audio
remux(await recordClip({ w: 320, h: 180, seconds: 4, withAudio: false, paint: `
  for (let y=0;y<h;y+=40) for (let x=0;x<w;x+=40) { const c=((x/40+y/40+Math.floor(f/15))%2)===0; g.fillStyle=c?'#1eb43c':'#f0c81e'; g.fillRect(x,y,40,40); }
  g.fillStyle='#000'; g.font='bold 30px sans-serif'; g.fillText('B '+f, 10, 40);` }), 'clipB.webm', 4);
// logo.png
{
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 200; c.height = 200; const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 200, 200); g.fillStyle = '#dc28c8'; g.fillRect(8, 8, 184, 184);
    return c.toDataURL('image/png').split(',')[1];
  });
  writeFileSync(join(dir, 'logo.png'), Buffer.from(b64, 'base64')); console.log('wrote logo.png');
}
await browser.close();
// tone.wav: 5 s stereo 440 / 660 Hz, 44.1 kHz 16-bit
{
  const rate = 44100, secs = 5, ch = 2, n = rate * secs;
  const data = Buffer.alloc(n * ch * 2);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / 2000, (n - i) / 2000);
    const l = Math.sin((2 * Math.PI * 440 * i) / rate) * 0.5 * env, r = Math.sin((2 * Math.PI * 660 * i) / rate) * 0.5 * env;
    data.writeInt16LE(Math.round(l * 32767), i * 4); data.writeInt16LE(Math.round(r * 32767), i * 4 + 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8); header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(ch, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * ch * 2, 28); header.writeUInt16LE(ch * 2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  writeFileSync(join(dir, 'tone.wav'), Buffer.concat([header, data]));
  console.log('wrote tone.wav');
}
