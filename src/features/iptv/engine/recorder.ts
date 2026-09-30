// ===================== Recording a stream or a shared screen =====================
// Whatever is on screen – a channel or the display capture – is a MediaStream, so one recorder
// serves both. The result is a WebM file with a real Duration written into it (browsers leave it
// out of a live recording), which is what makes it seekable and importable into the editor.
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

export interface Recording { blob: Blob; url: string; fileName: string; durationMs: number; mimeType: string }

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

/** The playing picture as a stream. Chrome and Firefox spell it differently. */
export function captureFrom(video: HTMLVideoElement): MediaStream | null {
  type Capturable = HTMLVideoElement & { captureStream?: () => MediaStream; mozCaptureStream?: () => MediaStream };
  const el = video as Capturable;
  try { return el.captureStream?.() ?? el.mozCaptureStream?.() ?? null; }
  catch { return null; }
}
