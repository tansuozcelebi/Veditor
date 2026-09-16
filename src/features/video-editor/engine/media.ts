// ===================== Media import & analysis (metadata, thumbnails, waveforms) =====================
import { uid, IMAGE_DEFAULT_DURATION, type Store } from './state';
import type { MediaItem, MediaKind, Thumbnail } from './types';

const THUMB_COUNT = 12;
/** Above this file size the waveform is skipped: decoding it would need the entire file in memory. */
export const PEAKS_MAX_BYTES = 400 * 1024 * 1024;
const THUMB_H = 72;
export const PEAKS_PER_SECOND = 40;

/** Why an import failed – used to show the user something more useful than "could not load". */
export type ImportFailReason = 'unsupported' | 'codec' | 'timeout' | 'read' | 'decode';
export class MediaImportError extends Error {
  reason: ImportFailReason;
  constructor(reason: ImportFailReason, detail = '') {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'MediaImportError';
    this.reason = reason;
  }
}

const VIDEO_EXT = ['mp4', 'm4v', 'mov', 'qt', 'webm', 'mkv', 'ogv', 'ogm', 'avi', 'divx', 'wmv', 'asf', 'flv', 'f4v', 'mts', 'm2ts', 'ts', 'mpg', 'mpeg', 'mpe', 'm2v', '3gp', '3g2', 'hevc', 'h264', 'mxf', 'vob'];
const AUDIO_EXT = ['mp3', 'wav', 'wave', 'ogg', 'oga', 'opus', 'm4a', 'm4b', 'aac', 'flac', 'weba', 'wma', 'aif', 'aiff', 'aifc', 'caf', 'amr', 'mka', 'ac3', 'mid', 'midi'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic', 'heif', 'tif', 'tiff', 'ico'];
/** File-picker filter: MIME groups plus explicit extensions, because the OS maps many camera formats to no MIME type at all. */
export const ACCEPT_ATTRIBUTE = ['video/*', 'audio/*', 'image/*', ...VIDEO_EXT, ...AUDIO_EXT, ...IMAGE_EXT].map((e) => (e.includes('/') ? e : '.' + e)).join(',');

export function kindOfFile(file: File): MediaKind | null {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('video/')) return 'video';
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('image/')) return 'image';
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  return null;
}

/** Last resort for files the OS gave neither a MIME type nor a known extension: look at the header bytes. */
async function sniffKind(file: File): Promise<MediaKind | null> {
  let head: Uint8Array;
  try { head = new Uint8Array(await file.slice(0, 64).arrayBuffer()); } catch { return null; }
  const ascii = (from: number, len: number) => String.fromCharCode(...head.subarray(from, from + len));
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return 'video';                       // Matroska / WebM (audio-only files still work)
  if (ascii(4, 4) === 'ftyp') {                                             // ISO-BMFF: mp4, mov, m4a, 3gp, heic
    const brand = ascii(8, 4).toLowerCase();
    if (brand.startsWith('m4a') || brand.startsWith('m4b')) return 'audio';
    if (brand.startsWith('hei') || brand.startsWith('mif1') || brand.startsWith('avif')) return 'image';
    return 'video';
  }
  if (ascii(0, 4) === 'RIFF') { const form = ascii(8, 4); return form === 'AVI ' ? 'video' : form === 'WEBP' ? 'image' : 'audio'; }
  if (ascii(0, 4) === 'OggS') return 'video';                               // may be ogv or oga – the element sorts it out
  if (ascii(0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return 'audio'; // mp3
  if (ascii(0, 4) === 'fLaC' || ascii(0, 4) === 'FORM') return 'audio';      // flac, aiff
  if (starts(0x89, 0x50, 0x4e, 0x47) || starts(0xff, 0xd8, 0xff) || ascii(0, 3) === 'GIF' || starts(0x42, 0x4d)) return 'image';
  if (starts(0x47) && head[188] === 0x47) return 'video';                    // MPEG-TS (.mts/.m2ts)
  if (starts(0x00, 0x00, 0x01, 0xba) || starts(0x00, 0x00, 0x01, 0xb3)) return 'video'; // MPEG-PS / ES
  return null;
}

/** Metadata can take a while for big files whose index sits at the end of the container. */
function metadataTimeout(size: number) { return Math.min(180_000, 20_000 + Math.round(size / (1024 * 1024)) * 250); }

function mediaElementError(el: HTMLMediaElement): MediaImportError {
  const err = el.error;
  const detail = err?.message || '';
  switch (err?.code) {
    case 1: return new MediaImportError('read', detail);   // MEDIA_ERR_ABORTED
    case 2: return new MediaImportError('read', detail);   // MEDIA_ERR_NETWORK
    case 3: return new MediaImportError('decode', detail); // MEDIA_ERR_DECODE
    case 4: return new MediaImportError('codec', detail);  // MEDIA_ERR_SRC_NOT_SUPPORTED
    default: return new MediaImportError('codec', detail);
  }
}

function once(el: EventTarget, ev: string, { timeout = 15000, errorEvent = 'error' } = {}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const ok = () => { if (done) return; done = true; cleanup(); resolve(); };
    const bad = () => { if (done) return; done = true; cleanup(); reject(new MediaImportError('codec', ev + ' failed')); };
    const to = setTimeout(() => { if (done) return; done = true; cleanup(); reject(new MediaImportError('timeout', ev + ' timeout')); }, timeout);
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
  const kind = kindOfFile(file) ?? await sniffKind(file);
  if (!kind) throw new MediaImportError('unsupported', file.type || file.name);
  const url = URL.createObjectURL(file);
  const m: MediaItem = { id: uid(), name: file.name, kind, file, url, size: file.size, type: file.type, duration: 0, width: 0, height: 0, thumbnails: [], peaks: null, poster: null, analyzing: true };
  try {
    if (kind === 'image') {
      const img = new Image();
      img.src = url;
      await once(img, 'load', { timeout: metadataTimeout(file.size) });
      m.width = img.naturalWidth; m.height = img.naturalHeight; m.duration = IMAGE_DEFAULT_DURATION; m.poster = url; m.image = img;
      m.analyzing = false;
    } else {
      // A container can hold either, and sniffing cannot always tell: load video-capable elements for both,
      // then demote to audio when the decoded stream turns out to have no picture.
      const el = document.createElement('video') as HTMLVideoElement;
      el.preload = 'metadata'; el.muted = true; el.playsInline = true;
      el.src = url;
      try {
        await once(el, 'loadedmetadata', { timeout: metadataTimeout(file.size) });
      } catch (e) {
        // the element knows why it gave up – surface that instead of a generic failure
        throw el.error ? mediaElementError(el) : (e as Error);
      }
      m.duration = await ensureFiniteDuration(el);
      // A few containers report their picture size only once the first frame is decoded; give a file that
      // claims to be video a moment before concluding that it is audio-only.
      if (!el.videoWidth && kind === 'video') await once(el, 'loadeddata', { timeout: 4000 }).catch(() => {});
      if (el.videoWidth && el.videoHeight) { m.kind = 'video'; m.width = el.videoWidth; m.height = el.videoHeight; }
      else m.kind = 'audio';
      el.removeAttribute('src'); el.load();
    }
  } catch (e) {
    URL.revokeObjectURL(url); // nothing references the blob yet, so let it go
    throw e;
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
  // decodeAudioData needs the whole file in memory; skip the waveform rather than risk killing the tab
  if (m.size > PEAKS_MAX_BYTES) { m.peaksSkipped = true; return null; }
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
        } catch (e) {
          console.warn('analysis failed', m.name, e); // the clip stays usable without thumbnails / waveform
        } finally {
          m.analyzing = false;
          store.emit('media');
          store.emit('mediaAnalyzed', m);
        }
      })();
    } catch (e) {
      // reported to the caller (and through it to the user); a warning keeps the console honest about severity
      console.warn('import failed', file.name, e);
      onError && onError(file, e as Error);
    }
  }
  return added;
}
