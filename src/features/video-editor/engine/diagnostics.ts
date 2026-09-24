// ===================== Import diagnostics =====================
// Everything the editor does with media happens in the browser, so when an import fails the useful
// evidence (what the file is, what the decoder said, whether the page's policy allowed it at all)
// only exists at that moment. These helpers write it to the console in a readable form.
import { cspViolations, isLocalMediaBlock } from './csp';
import { chooseFormat, probeServer } from './serverTranscode';

const PREFIX = 'color:#e11d48;font-weight:bold';

export function log(step: string, detail?: unknown) {
  if (detail === undefined) console.log(`%c[veditor]%c ${step}`, PREFIX, '');
  else console.log(`%c[veditor]%c ${step}`, PREFIX, '', detail);
}

/** One import, logged as a collapsed group with a timing for each step. */
export function trace(title: string) {
  const t0 = performance.now();
  const lines: [string, unknown][] = [];
  let open = false;
  const since = () => `${Math.round(performance.now() - t0)} ms`;
  return {
    step(step: string, detail?: unknown) { lines.push([`${step} (+${since()})`, detail]); },
    end(ok: boolean, summary?: unknown) {
      console[ok ? 'groupCollapsed' : 'group'](`%c[veditor]%c import ${ok ? '✔' : '✖'} ${title} – ${since()}`, PREFIX, '');
      open = true;
      for (const [s, d] of lines) d === undefined ? console.log(s) : console.log(s, d);
      if (summary !== undefined) console.log('result', summary);
      if (!ok) {
        const blocks = cspViolations().filter(isLocalMediaBlock);
        if (blocks.length) console.warn('the page\'s Content-Security-Policy blocked local sources:', blocks);
        console.log('run window.veditor.diagnostics() for the full environment report');
      }
      console.groupEnd();
      open = false;
    },
    get open() { return open; },
  };
}

export interface Diagnostics {
  userAgent: string;
  /** Codecs this browser build can decode on its own. */
  canPlay: Record<string, string>;
  /** Whether a blob: URL can be played at all – the usual casualty of a restrictive page policy. */
  blobMedia: 'ok' | 'blocked-by-policy' | 'failed';
  mediaRecorder: string[];
  webAssembly: boolean;
  codecCore: 'reachable' | 'unreachable';
  /** Whether this deployment can convert unsupported codecs on the host instead of in the tab. */
  serverConvert: { available: boolean; ffmpeg: string | null; reason: string | null; maxBytes: number | null; format: string | null; formats: string[] };
  cspViolations: readonly { directive: string; blockedURI: string }[];
}

/** A 0.1 s silent WAV – small, valid, and decodable by every browser, so only the policy can stop it. */
function silentWav(): Blob {
  const rate = 8000, samples = 800, size = 44 + samples * 2;
  const b = new ArrayBuffer(size), v = new DataView(b);
  const ascii = (off: number, s: string) => [...s].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); v.setUint32(4, size - 8, true); ascii(8, 'WAVEfmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, 'data'); v.setUint32(40, samples * 2, true);
  return new Blob([b], { type: 'audio/wav' });
}

async function probeBlobMedia(): Promise<Diagnostics['blobMedia']> {
  const before = cspViolations().length;
  const url = URL.createObjectURL(silentWav());
  const el = document.createElement('audio');
  el.preload = 'metadata'; el.src = url;
  const outcome = await new Promise<Diagnostics['blobMedia']>((resolve) => {
    const done = (r: Diagnostics['blobMedia']) => { clearTimeout(to); resolve(r); };
    const to = setTimeout(() => done('failed'), 5000);
    el.addEventListener('loadedmetadata', () => done('ok'), { once: true });
    el.addEventListener('error', () => done(cspViolations().slice(before).some(isLocalMediaBlock) ? 'blocked-by-policy' : 'failed'), { once: true });
  });
  el.removeAttribute('src'); URL.revokeObjectURL(url);
  return outcome;
}

/** Full environment report: what this browser can decode, and whether the page lets the editor use it. */
export async function diagnostics(coreUrl?: string): Promise<Diagnostics> {
  const v = document.createElement('video'), a = document.createElement('audio');
  const canPlay: Record<string, string> = {
    'mp4 (H.264)': v.canPlayType('video/mp4; codecs="avc1.42E01E"') || 'no',
    'mp4 (HEVC)': v.canPlayType('video/mp4; codecs="hvc1"') || 'no',
    'webm (VP8)': v.canPlayType('video/webm; codecs="vp8"') || 'no',
    'webm (VP9)': v.canPlayType('video/webm; codecs="vp9"') || 'no',
    'quicktime': v.canPlayType('video/quicktime') || 'no',
    'mp3': a.canPlayType('audio/mpeg') || 'no',
    'aac': a.canPlayType('audio/mp4; codecs="mp4a.40.2"') || 'no',
    'opus': a.canPlayType('audio/webm; codecs="opus"') || 'no',
  };
  const mediaRecorder = typeof MediaRecorder === 'undefined' ? []
    : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/mp4', 'audio/webm;codecs=opus'].filter((m) => MediaRecorder.isTypeSupported(m));
  let codecCore: Diagnostics['codecCore'] = 'unreachable';
  if (coreUrl) { try { codecCore = (await fetch(coreUrl, { method: 'HEAD' })).ok ? 'reachable' : 'unreachable'; } catch { /* stays unreachable */ } }
  const health = await probeServer().catch(() => null);
  return {
    userAgent: navigator.userAgent,
    canPlay,
    blobMedia: await probeBlobMedia(),
    mediaRecorder,
    webAssembly: typeof WebAssembly === 'object',
    codecCore,
    serverConvert: {
      available: !!health?.ok && chooseFormat(health) !== null,
      ffmpeg: health?.ffmpeg ?? null,
      reason: !health ? 'no conversion service on this host' : health.reason ?? (chooseFormat(health) ? null : 'the host writes no format this browser can play'),
      maxBytes: health?.maxBytes ?? null,
      format: chooseFormat(health),
      formats: Object.keys(health?.formats ?? {}),
    },
    cspViolations: cspViolations(),
  };
}

/** Prints the report and, when local playback is blocked, says what to change. */
export async function logDiagnostics(coreUrl?: string): Promise<Diagnostics> {
  const d = await diagnostics(coreUrl);
  console.groupCollapsed('%c[veditor]%c environment', PREFIX, '');
  console.log('browser', d.userAgent);
  console.table(d.canPlay);
  console.log('blob: playback', d.blobMedia, '| WebAssembly', d.webAssembly, '| codec core', d.codecCore);
  console.log('MediaRecorder formats', d.mediaRecorder);
  console.log('server conversion', d.serverConvert.available
    ? `available (ffmpeg ${d.serverConvert.ffmpeg}, → ${d.serverConvert.format}, up to ${Math.floor((d.serverConvert.maxBytes || 0) / 1024 / 1024)} MB)`
    : `unavailable (${d.serverConvert.reason}) – conversions run in this tab`);
  if (d.cspViolations.length) console.warn('Content-Security-Policy violations so far', d.cspViolations);
  if (d.blobMedia === 'blocked-by-policy') {
    console.error("[veditor] This page's Content-Security-Policy blocks blob: URLs, so no local file can be opened. " +
      "The server must send: media-src 'self' blob: data:; img-src 'self' data: blob:; worker-src 'self' blob:; script-src … 'wasm-unsafe-eval' blob:");
  }
  console.groupEnd();
  return d;
}
