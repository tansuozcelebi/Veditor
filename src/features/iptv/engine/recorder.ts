// ===================== Recording a stream or a shared screen =====================
// Whatever is on screen – a channel or the display capture – is a MediaStream, so one recorder
// serves both. The result is a WebM file with a real Duration written into it (browsers leave it
// out of a live recording), which is what makes it seekable and importable into the editor.
import Hls from 'hls.js';
import { fixWebmDuration } from '@/features/video-editor';

/** The first format this browser can write, best first. */
export function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  const candidates = [
    'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8',
    'video/webm', 'video/mp4',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m));
}

export function canRecord() { return !!pickMimeType(); }

export interface Recording {
  blob: Blob; url: string; fileName: string; durationMs: number; mimeType: string;
  /** The broadcaster's own bytes, kept as they arrived – no decoder, no re-encode, no quality lost. */
  lossless?: boolean;
}

/**
 * Records a MediaStream until stop() is called. `onTick` reports elapsed milliseconds so the UI can
 * show a running clock without polling the recorder.
 */
export function startRecording(stream: MediaStream, name: string, onTick?: (ms: number) => void): {
  stop: () => Promise<Recording>;
  cancel: () => void;
} {
  const mimeType = pickMimeType();
  if (!mimeType) throw new Error('MediaRecorder is not available');
  // A video track alone is enough; audio rides along when the stream carries it.
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 6_000_000 });
  const chunks: BlobPart[] = [];
  const startedAt = performance.now();
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const timer = onTick ? setInterval(() => onTick(performance.now() - startedAt), 250) : undefined;
  recorder.start(1000); // a chunk per second, so a long recording is not held in one buffer

  const finish = () => { clearInterval(timer); };
  const safeName = (name || 'kayit').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);

  return {
    stop: () => new Promise<Recording>((resolve, reject) => {
      recorder.onerror = (e) => { finish(); reject((e as ErrorEvent).error ?? new Error('recording failed')); };
      recorder.onstop = () => {
        finish();
        const durationMs = performance.now() - startedAt;
        const raw = new Blob(chunks, { type: mimeType });
        const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
        const done = (blob: Blob) => resolve({
          blob, url: URL.createObjectURL(blob), fileName: `${safeName}.${ext}`, durationMs, mimeType,
        });
        // the duration patch only applies to WebM; an mp4 from MediaRecorder already carries one
        if (ext === 'webm') fixWebmDuration(raw, durationMs / 1000).then(done, () => done(raw));
        else done(raw);
      };
      if (recorder.state === 'inactive') recorder.onstop?.(new Event('stop'));
      else recorder.stop();
    }),
    cancel: () => { finish(); try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* already gone */ } },
  };
}

/**
 * The playing picture as a stream. Chrome and Firefox spell it differently, and a browser refuses
 * it outright for a cross-origin video with no CORS headers – which is most public streams.
 */
export function captureFrom(video: HTMLVideoElement): { stream: MediaStream | null; blocked: boolean } {
  type Capturable = HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
  const el = video as Capturable;
  if (!el.captureStream && !el.mozCaptureStream) return { stream: null, blocked: false };
  try {
    const stream = el.captureStream?.() ?? el.mozCaptureStream?.() ?? null;
    return { stream, blocked: !stream || !stream.getTracks().length };
  } catch {
    return { stream: null, blocked: true };    // SecurityError: the element is tainted
  }
}

// ===================== Recording the stream itself, not a picture of it =====================
// MediaRecorder can only have what the page is allowed to look at, and a browser will not let a
// page look at a cross-origin video. Recording the segments hls.js has already downloaded sidesteps
// that entirely: they are the broadcaster's own bytes, so nothing is re-encoded, nothing is lost,
// no decoder runs, and the browser has nothing to withhold.

/** `.ts` for MPEG-TS, `.mp4` for fragmented MP4 – whichever the playlist actually serves. */
function sniffContainer(head: Uint8Array): { ext: 'ts' | 'mp4'; mimeType: string } {
  const box = String.fromCharCode(...head.subarray(4, 8));
  if (box === 'ftyp' || box === 'styp' || box === 'moof' || box === 'sidx') return { ext: 'mp4', mimeType: 'video/mp4' };
  return { ext: 'ts', mimeType: 'video/mp2t' };   // 0x47 sync byte, and the safe default besides
}

/**
 * Keeps every media segment hls.js loads until stop() is called.
 *
 * The quality level is held where it was for the duration: a mid-recording switch would append a
 * different resolution, and for fragmented MP4 a second initialisation segment that no player can
 * make sense of halfway through a file. Automatic switching is restored afterwards.
 */
export function startSegmentRecording(hls: Hls, name: string, onTick?: (ms: number) => void): {
  stop: () => Promise<Recording>;
  cancel: () => void;
} {
  const parts: ArrayBuffer[] = [];
  // Fragmented MP4 segments are meaningless without the initialisation segment, which hls.js loads
  // on its own path and never announces as a fragment. Each fragment names it, so it is fetched once
  // – from the browser cache, since hls.js has just read it – and written at the head of the file.
  // MPEG-TS carries its own headers and names no init segment, so nothing is fetched there.
  let initPromise: Promise<ArrayBuffer | null> | null = null;
  let seconds = 0;
  const startedAt = performance.now();
  const wasAuto = hls.autoLevelEnabled;
  const heldLevel = hls.currentLevel;
  // assigning the level it is already on is not a no-op here: it is what turns automatic switching off
  if (wasAuto && heldLevel >= 0) hls.currentLevel = heldLevel;

  type Frag = { sn: number | 'initSegment'; duration: number; initSegment?: { url?: string } | null };
  const onFrag = (_e: unknown, data: { frag: Frag; payload: ArrayBuffer }) => {
    if (!data.payload?.byteLength) return;
    if (data.frag.sn === 'initSegment') { initPromise = Promise.resolve(data.payload); return; }
    const initUrl = data.frag.initSegment?.url;
    if (!initPromise && initUrl) {
      initPromise = fetch(initUrl, { cache: 'force-cache' }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    }
    parts.push(data.payload);
    seconds += data.frag.duration || 0;
  };
  hls.on(Hls.Events.FRAG_LOADED, onFrag);
  // the clock follows the media actually captured, not the wall, so a stall is not counted as footage
  const timer = onTick ? setInterval(() => onTick(seconds * 1000), 250) : undefined;

  const detach = () => {
    clearInterval(timer);
    hls.off(Hls.Events.FRAG_LOADED, onFrag);
    if (wasAuto) { try { hls.currentLevel = -1; } catch { /* the instance may be gone already */ } }
  };
  const safeName = (name || 'kayit').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60);

  return {
    stop: async (): Promise<Recording> => {
      detach();
      if (!parts.length) throw new Error('no segments were captured');
      const { ext, mimeType } = sniffContainer(new Uint8Array(parts[0].slice(0, 8)));
      const init = await (initPromise ?? Promise.resolve(null));
      const blob = new Blob(init ? [init, ...parts] : parts, { type: mimeType });
      return {
        blob,
        url: URL.createObjectURL(blob),
        fileName: `${safeName}.${ext}`,
        // segment durations are the broadcaster's own; they beat a wall clock that counted buffering
        durationMs: Math.round((seconds || (performance.now() - startedAt) / 1000) * 1000),
        mimeType,
        lossless: true,
      };
    },
    cancel: () => { detach(); parts.length = 0; initPromise = null; },
  };
}
