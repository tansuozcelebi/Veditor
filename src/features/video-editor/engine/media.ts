// ===================== Media import & analysis (metadata, thumbnails, waveforms) =====================
import { uid, IMAGE_DEFAULT_DURATION, type Store } from './state';
import type { MediaItem, MediaKind, Thumbnail } from './types';

const THUMB_COUNT = 12;
const THUMB_H = 72;
export const PEAKS_PER_SECOND = 40;

export function kindOfFile(file: File): MediaKind | null {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('image/')) return 'image';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv', 'avi'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'weba'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)) return 'image';
  return null;
}

function once(el: EventTarget, ev: string, { timeout = 15000, errorEvent = 'error' } = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const ok = () => { if (done) return; done = true; cleanup(); resolve(); };
    const bad = () => { if (done) return; done = true; cleanup(); reject(new Error(ev + ' failed')); };
    const to = setTimeout(() => { if (done) return; done = true; cleanup(); reject(new Error(ev + ' timeout')); }, timeout);
    const cleanup = () => { clearTimeout(to); el.removeEventListener(ev, ok); el.removeEventListener(errorEvent, bad); };
    el.addEventListener(ev, ok); el.addEventListener(errorEvent, bad);
  });
}

/** Resolve real duration for streams reporting Infinity (e.g. MediaRecorder WebM). */
async function ensureFiniteDuration(el: HTMLMediaElement): Promise<number> {
  if (isFinite(el.duration) && el.duration > 0) return el.duration;
  el.currentTime = 1e101;
  await new Promise<void>((res) => {
    const to = setTimeout(res, 8000);
    const h = () => { if (isFinite(el.duration)) { clearTimeout(to); el.removeEventListener('durationchange', h); res(); } };
    el.addEventListener('durationchange', h);
  });
  const d = el.duration;
  el.currentTime = 0;
  return isFinite(d) ? d : 0;
}

/** Load basic metadata; returns media object (without thumbnails / peaks yet). */
export async function loadMedia(file: File): Promise<MediaItem> {
  const kind = kindOfFile(file);
  if (!kind) throw new Error('unsupported');
  const url = URL.createObjectURL(file);
  const m: MediaItem = { id: uid(), name: file.name, kind, file, url, size: file.size, type: file.type, duration: 0, width: 0, height: 0, thumbnails: [], peaks: null, poster: null, analyzing: true };
  if (kind === 'image') {
    const img = new Image();
    img.src = url;
    await once(img, 'load');
    m.width = img.naturalWidth; m.height = img.naturalHeight; m.duration = IMAGE_DEFAULT_DURATION; m.poster = url; m.image = img;
    m.analyzing = false;
  } else {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio') as HTMLVideoElement;
    el.preload = 'metadata'; el.muted = true; el.playsInline = true;
    el.src = url;
    await once(el, 'loadedmetadata');
    m.duration = await ensureFiniteDuration(el);
    if (kind === 'video') { m.width = el.videoWidth; m.height = el.videoHeight; }
    el.removeAttribute('src'); el.load();
  }
  return m;
}

/** Generate thumbnails for a video (sequential seeks on an offscreen element). */
export async function generateThumbnails(m: MediaItem, onProgress?: (thumbs: Thumbnail[]) => void): Promise<Thumbnail[]> {
  if (m.kind !== 'video' || !m.duration) return [];
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true;
  video.src = m.url;
  try { await once(video, 'loadedmetadata'); } catch { return []; }
  const w = Math.max(16, Math.round(THUMB_H * (m.width / m.height || 16 / 9)));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = THUMB_H;
  const ctx = canvas.getContext('2d')!;
  const thumbs: Thumbnail[] = [];
  const count = Math.min(THUMB_COUNT, Math.max(1, Math.ceil(m.duration)));
  for (let i = 0; i < count; i++) {
    const t = Math.min(m.duration - 0.05, (i + 0.5) * (m.duration / count));
    try {
      video.currentTime = Math.max(0, t);
      await once(video, 'seeked', { timeout: 6000 });
      ctx.drawImage(video, 0, 0, w, THUMB_H);
      thumbs.push({ time: t, url: canvas.toDataURL('image/jpeg', 0.7) });
      if (i === 0) m.poster = thumbs[0].url;
      onProgress && onProgress(thumbs);
    } catch (e) { console.warn('thumbnail failed', e); break; }
  }
  video.removeAttribute('src'); video.load();
  return thumbs;
}

/** Compute normalized waveform peaks at low sample rate (memory friendly). */
export async function generatePeaks(m: MediaItem): Promise<Float32Array | null> {
  if (m.kind === 'image' || !m.duration) return null;
  const rate = 8000;
  const len = Math.max(1, Math.ceil(m.duration * rate));
  let buffer: AudioBuffer;
  try {
    const off = new OfflineAudioContext(1, len, rate);
    const ab = await m.file.arrayBuffer();
    buffer = await off.decodeAudioData(ab);
  } catch (e) {
    console.warn('waveform decode failed', m.name, e);
    return null;
  }
  const data = buffer.getChannelData(0);
  const n = Math.ceil(buffer.duration * PEAKS_PER_SECOND);
  const per = Math.floor(rate / PEAKS_PER_SECOND);
  const peaks = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let max = 0;
    const s = i * per, e = Math.min(data.length, s + per);
    for (let j = s; j < e; j++) { const v = Math.abs(data[j]); if (v > max) max = v; }
    peaks[i] = max;
  }
  // normalise softly
  let gmax = 0; for (let i = 0; i < n; i++) if (peaks[i] > gmax) gmax = peaks[i];
  if (gmax > 0) for (let i = 0; i < n; i++) peaks[i] = Math.min(1, peaks[i] / gmax);
  m.hasAudio = gmax > 0.0005;
  return peaks;
}

/** Full import pipeline: metadata → add to store → background analysis. */
export async function importFiles(store: Store, files: File[], { onMedia, onError }: { onMedia?: (m: MediaItem) => void; onError?: (file: File, e: Error) => void } = {}): Promise<MediaItem[]> {
  const added: MediaItem[] = [];
  for (const file of files) {
    try {
      const m = await loadMedia(file);
      store.addMedia(m);
      added.push(m);
      onMedia && onMedia(m);
      // background analysis (don't block UI)
      (async () => {
        try {
          if (m.kind === 'video') m.thumbnails = await generateThumbnails(m, () => store.emit('media'));
          m.peaks = await generatePeaks(m);
        } finally {
          m.analyzing = false;
          store.emit('media');
          store.emit('mediaAnalyzed', m);
        }
      })();
    } catch (e) {
      console.error(e);
      onError && onError(file, e as Error);
    }
  }
  return added;
}
