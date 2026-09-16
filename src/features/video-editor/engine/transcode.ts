// ===================== Codec fallback: transcode with ffmpeg.wasm =====================
// Browsers only decode the codecs they were built with: Chromium builds without proprietary
// codecs reject H.264/AAC (most phone and WhatsApp videos), and nobody decodes HEVC, ProRes,
// DivX or WMV. ffmpeg.wasm (open source, GPL-2.0-or-later, loaded as a separate program in a
// worker) converts those files to VP8/Opus in WebM, which every browser can play.
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

/** Where the core lives: our own copy first (public/ffmpeg, written by scripts/copy-ffmpeg-core.mjs), CDN as a backstop. */
const CORE_VERSION = '0.12.10';
const CORE_SOURCES = [
  new URL(`${import.meta.env.BASE_URL}ffmpeg/`, location.origin).href,
  `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm/`,
  `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/esm/`,
];

export interface TranscodeProgress { ratio: number; stage: 'loading' | 'converting' }

let loading: Promise<FFmpeg> | null = null;

async function usableCoreBase(): Promise<string> {
  for (const base of CORE_SOURCES) {
    try {
      const res = await fetch(base + 'ffmpeg-core.js', { method: 'HEAD' });
      if (res.ok) return base;
    } catch { /* try the next source */ }
  }
  throw new Error('ffmpeg core unavailable');
}

/** Loads the wasm core once and keeps it for later conversions. */
export function loadFFmpeg(onProgress?: (p: TranscodeProgress) => void): Promise<FFmpeg> {
  if (!loading) {
    loading = (async () => {
      const base = await usableCoreBase();
      const ff = new FFmpeg();
      onProgress?.({ ratio: 0, stage: 'loading' });
      await ff.load({
        coreURL: await toBlobURL(base + 'ffmpeg-core.js', 'text/javascript'),
        wasmURL: await toBlobURL(base + 'ffmpeg-core.wasm', 'application/wasm'),
      });
      return ff;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

/** True once the core has been fetched, so callers can tell a first-run download from a quick conversion. */
export function isFFmpegLoaded() { return loading !== null; }

const SAFE_NAME = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(-60) || 'input';

/** Runs one ffmpeg command over a single input file and returns the produced file. */
export async function runFFmpeg(file: File, args: string[], outName: string, { onProgress, signal, type = 'video/webm' }: { onProgress?: (p: TranscodeProgress) => void; signal?: AbortSignal; type?: string } = {}): Promise<File> {
  const ff = await loadFFmpeg(onProgress);
  const input = 'in_' + SAFE_NAME(file.name);
  const onTick = ({ progress }: { progress: number }) => onProgress?.({ ratio: Math.max(0, Math.min(1, progress)), stage: 'converting' });
  const abort = () => ff.terminate();
  signal?.addEventListener('abort', abort, { once: true });
  ff.on('progress', onTick);
  try {
    await ff.writeFile(input, await fetchFile(file));
    onProgress?.({ ratio: 0, stage: 'converting' });
    const code = await ff.exec(['-i', input, ...args, '-y', outName]);
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    const data = await ff.readFile(outName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    if (!bytes.length) throw new Error('ffmpeg produced an empty file');
    const base = file.name.replace(/\.[^.]+$/, '');
    return new File([bytes as BlobPart], base + outName.slice(outName.lastIndexOf('.')), { type });
  } finally {
    ff.off('progress', onTick);
    signal?.removeEventListener('abort', abort);
    try { await ff.deleteFile(input); } catch { /* the worker may already be gone */ }
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
  }
}

/**
 * Converts a file the browser cannot decode into WebM (VP8 video + Opus audio) – the one combination
 * every browser plays. Video is capped at 1080p because encoding runs single threaded in wasm.
 */
export function transcodeToPlayable(file: File, opts: { onProgress?: (p: TranscodeProgress) => void; signal?: AbortSignal } = {}): Promise<File> {
  // Vorbis rather than Opus: the libopus encoder in @ffmpeg/core 0.12.10 traps with
  // "memory access out of bounds" on every input, while Vorbis is WebM's original audio codec
  // and plays everywhere.
  return runFFmpeg(file, [
    '-map', '0:v:0?', '-map', '0:a:0?',
    '-c:v', 'libvpx', '-b:v', '2M', '-crf', '30', '-deadline', 'realtime', '-cpu-used', '8',
    '-vf', "scale='min(1920,iw)':-2",
    '-c:a', 'libvorbis', '-q:a', '5',
  ], 'out.webm', { ...opts, type: 'video/webm' });
}
