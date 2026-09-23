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

/** Carries the tail of ffmpeg's own output, which names the codec or pixel format it refused. */
export class FFmpegError extends Error {
  log: string[];
  constructor(message: string, log: string[]) {
    super(log.length ? `${message}\n${log.slice(-6).join('\n')}` : message);
    this.name = 'FFmpegError';
    this.log = log;
  }
}

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

/**
 * Throws the wasm instance away. A run that ran out of memory leaves the heap unusable, and every
 * later conversion would fail for a reason that has nothing to do with its own file.
 */
export async function resetFFmpeg() {
  const pending = loading;
  loading = null;
  try { (await pending)?.terminate(); } catch { /* already gone */ }
}

const SAFE_NAME = (name: string) => name.replace(/[^\w.-]+/g, '_').slice(-60) || 'input';

export interface StreamSummary { input: { video?: string; audio?: string }; output: { video?: string; audio?: string } }

/** Picks the "Stream #0:0: Video: hevc (…)" lines out of ffmpeg's report, per input and output. */
function readStreams(lines: string[]): StreamSummary {
  const summary: StreamSummary = { input: {}, output: {} };
  let side: 'input' | 'output' | null = null;
  for (const line of lines) {
    if (/^\s*Input #/.test(line)) side = 'input';
    else if (/^\s*Output #/.test(line)) side = 'output';
    const m = side && line.match(/Stream #\d+:\d+.*?: (Video|Audio): ([^,]+)/);
    if (m && side) {
      const kind = m[1].toLowerCase() as 'video' | 'audio';
      summary[side][kind] ??= m[2].trim();
    }
  }
  return summary;
}

/** Runs one ffmpeg command over a single input file and returns the produced file. */
export async function runFFmpeg(file: File, args: string[], outName: string, { onProgress, signal, type = 'video/webm', onStreams }: { onProgress?: (p: TranscodeProgress) => void; signal?: AbortSignal; type?: string; onStreams?: (s: StreamSummary) => void } = {}): Promise<File> {
  const ff = await loadFFmpeg(onProgress);
  const input = 'in_' + SAFE_NAME(file.name);
  const onTick = ({ progress }: { progress: number }) => onProgress?.({ ratio: Math.max(0, Math.min(1, progress)), stage: 'converting' });
  const abort = () => ff.terminate();
  // ffmpeg explains itself on stderr; keep the tail so a failure is readable instead of "exited with 1"
  const logTail: string[] = [];
  const onLog = ({ message }: { message: string }) => { logTail.push(message); if (logTail.length > 400) logTail.shift(); };
  signal?.addEventListener('abort', abort, { once: true });
  ff.on('progress', onTick);
  ff.on('log', onLog);
  try {
    await ff.writeFile(input, await fetchFile(file));
    onProgress?.({ ratio: 0, stage: 'converting' });
    const code = await ff.exec(['-i', input, ...args, '-y', outName]);
    if (code !== 0) throw new FFmpegError(`ffmpeg exited with ${code}`, logTail.slice());
    // ffmpeg can finish "successfully" having dropped a stream it could not decode; compare what it
    // read with what it wrote, so a video that arrives without a picture is reported, not imported.
    const streams = readStreams(logTail);
    onStreams?.(streams);
    if (streams.input.video && !streams.output.video) throw new FFmpegError('the converted file has no video stream', logTail.slice());
    const data = await ff.readFile(outName);
    const bytes = data instanceof Uint8Array ? data : new TextEncoder().encode(String(data));
    if (!bytes.length) throw new Error('ffmpeg produced an empty file');
    const base = file.name.replace(/\.[^.]+$/, '');
    return new File([bytes as BlobPart], base + outName.slice(outName.lastIndexOf('.')), { type });
  } finally {
    ff.off('progress', onTick);
    ff.off('log', onLog);
    signal?.removeEventListener('abort', abort);
    try { await ff.deleteFile(input); } catch { /* the worker may already be gone */ }
    try { await ff.deleteFile(outName); } catch { /* ignore */ }
  }
}

/** Encoder settings shared by every attempt: VP8 video, Vorbis audio, 8-bit 4:2:0 at up to 1080p. */
const videoArgs = (maxWidth: number) => [
  '-c:v', 'libvpx', '-b:v', '2M', '-crf', '30', '-deadline', 'realtime', '-cpu-used', '8',
  // HDR/10-bit sources (iPhone HEVC, ProRes) and 4:2:2 material decode to pixel formats VP8 cannot
  // take, so convert them down explicitly instead of relying on the encoder to cope.
  '-vf', `scale='min(${maxWidth},iw)':-2,format=yuv420p`, '-pix_fmt', 'yuv420p',
];

/** wasm has a hard memory ceiling; 4K sources can hit it, and the message is always one of these. */
const OUT_OF_MEMORY = /memory access out of bounds|out of memory|allocation failed|Aborted/i;
// Vorbis rather than Opus: the libopus encoder in @ffmpeg/core 0.12.10 traps with
// "memory access out of bounds" on every input, while Vorbis is WebM's original audio codec.
const AUDIO_ARGS = ['-c:a', 'libvorbis', '-q:a', '5'];

/**
 * Converts a file the browser cannot decode into WebM (VP8 + Vorbis) – the one combination every
 * browser plays. If the audio stream defeats the converter, the video is still rescued on a second
 * pass without it, because a silent clip beats no clip at all.
 */
export async function transcodeToPlayable(file: File, opts: { onProgress?: (p: TranscodeProgress) => void; signal?: AbortSignal; onStreams?: (s: StreamSummary) => void } = {}): Promise<File> {
  const attempts = [
    { args: ['-map', '0:v:0?', '-map', '0:a:0?', ...videoArgs(1920), ...AUDIO_ARGS], note: 'video + audio, up to 1080p' },
    { args: ['-map', '0:v:0?', '-map', '0:a:0?', ...videoArgs(1280), ...AUDIO_ARGS], note: 'video + audio, up to 720p (less memory)' },
    { args: ['-map', '0:v:0?', '-an', ...videoArgs(1280), '-an'], note: 'video only (the audio stream could not be converted)' },
  ];
  let last: unknown;
  for (const [i, attempt] of attempts.entries()) {
    try {
      return await runFFmpeg(file, attempt.args, 'out.webm', { ...opts, type: 'video/webm' });
    } catch (e) {
      last = e;
      if (opts.signal?.aborted || i === attempts.length - 1) break;
      // a crashed or exhausted instance would fail the next attempt for the wrong reason
      if (OUT_OF_MEMORY.test(String((e as Error)?.message))) await resetFFmpeg();
      console.warn(`[veditor] conversion "${attempt.note}" failed, retrying as "${attempts[i + 1].note}"`, e);
    }
  }
  await resetFFmpeg(); // never leave a poisoned instance behind for the next file
  throw last;
}
