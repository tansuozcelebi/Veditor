// ===================== Codec fallback: convert on our own server =====================
// The in-browser converter (ffmpeg.wasm) works everywhere but runs on a single thread inside
// WebAssembly, so a long HEVC clip takes minutes. When the site's own host can run ffmpeg
// (public/api/convert.php), the same conversion happens natively in a fraction of the time and the
// browser only uploads and downloads. This module talks to that endpoint; when the host cannot
// convert – no ffmpeg, processes disabled, file too big, offline – the caller falls back to wasm.
import type { TranscodeProgress } from './transcode';

/** Same origin as the app: the API ships in public/api and is deployed with the build. */
export const SERVER_API_URL = `${import.meta.env.BASE_URL}api/convert.php`;

/** Containers a browser can be asked to play, best first: VP8/VP9 WebM works even without proprietary codecs. */
export const FORMATS = ['webm', 'mp4'] as const;
export type ServerFormat = (typeof FORMATS)[number];

export interface ServerHealth {
  ok: boolean;
  ffmpeg: string | null;
  /** Why the host cannot convert: ffmpeg-missing | processes-disabled | workdir-not-writable | ffmpeg-not-runnable | no-encoder */
  reason: string | null;
  /** What this host can write, per container – a build without libvpx offers mp4 only, or nothing. */
  formats: Partial<Record<ServerFormat, { video: string; audio: string | null; tested?: boolean }>>;
  maxBytes: number;
  maxJobs: number;
  tokenRequired: boolean;
}

const MIME: Record<ServerFormat, string> = { webm: 'video/webm', mp4: 'video/mp4' };

/** Containers this browser can decode – there is no point converting into one it cannot play. */
export function playableFormats(): ServerFormat[] {
  const v = document.createElement('video');
  return FORMATS.filter((f) => (f === 'webm'
    ? v.canPlayType('video/webm; codecs="vp8"') || v.canPlayType('video/webm; codecs="vp9"')
    : v.canPlayType('video/mp4; codecs="avc1.42E01E"')));
}

/** The container to ask this host for: the first one both sides support, or null when there is none. */
export function chooseFormat(health: ServerHealth | null): ServerFormat | null {
  if (!health?.ok) return null;
  return playableFormats().find((f) => health.formats?.[f]) ?? null;
}

export type ServerFailReason = 'unreachable' | 'unavailable' | 'too-large' | 'busy' | 'unsupported' | 'unauthorised' | 'failed' | 'aborted';

export class ServerConvertError extends Error {
  reason: ServerFailReason;
  log: string[];
  constructor(reason: ServerFailReason, message: string, log: string[] = []) {
    super(log.length ? `${message}\n${log.slice(-6).join('\n')}` : message);
    this.name = 'ServerConvertError';
    this.reason = reason;
    this.log = log;
  }
}

/** Set by the host app when the endpoint is protected (config.php → 'token'). */
let token: string | null = null;
export function setServerToken(value: string | null) { token = value; probe = null; }
const authHeaders = (): Record<string, string> => (token ? { 'X-Veditor-Token': token } : {});

let probe: Promise<ServerHealth | null> | null = null;

/**
 * Asks the host once whether it can convert. Returns null when the endpoint is missing or not PHP
 * at all (a static host answers the request with index.html, which is not JSON).
 */
export function probeServer(): Promise<ServerHealth | null> {
  probe ??= (async () => {
    try {
      const res = await fetch(`${SERVER_API_URL}?action=health`, { headers: authHeaders(), cache: 'no-store' });
      if (!res.ok) return null;
      if (!/application\/json/i.test(res.headers.get('content-type') || '')) return null; // SPA fallback, not our API
      const data = await res.json() as ServerHealth;
      return typeof data?.ok === 'boolean' ? data : null;
    } catch {
      return null; // offline, blocked, or no such file
    }
  })();
  return probe;
}

/** Forgets the cached answer, so the next import asks again (used after a server failure). */
export function resetServerProbe() { probe = null; }

/** True when this file should go to the server rather than to the in-browser converter. */
export async function canConvertOnServer(file: File): Promise<boolean> {
  const health = await probeServer();
  return !!health?.ok && file.size <= health.maxBytes && chooseFormat(health) !== null;
}

interface StartResponse { ok: boolean; job?: string; format?: ServerFormat; error?: string; reason?: string; maxBytes?: number }
interface StatusResponse { ok: boolean; state: 'running' | 'done' | 'error' | 'cancelled'; progress: number; error?: string; log?: string[] }

function reasonOf(status: number, body: StartResponse | null): ServerFailReason {
  switch (body?.reason) {
    case 'too-large': return 'too-large';
    case 'busy': return 'busy';
    case 'unsupported': return 'unsupported';
    case 'ffmpeg-missing': case 'no-encoder': case 'processes-disabled': return 'unavailable';
  }
  if (status === 401) return 'unauthorised';
  if (status === 413) return 'too-large';
  if (status === 429) return 'busy';
  if (status === 415) return 'unsupported';
  if (status === 503) return 'unavailable';
  return 'failed';
}

/** POSTs the file with upload progress – fetch() cannot report that, XHR can. */
function upload(file: File, formats: ServerFormat[], onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<{ job: string; format: ServerFormat }> {
  return new Promise<{ job: string; format: ServerFormat }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    xhr.open('POST', `${SERVER_API_URL}?action=start`);
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onerror = () => reject(new ServerConvertError('unreachable', 'the conversion service could not be reached'));
    xhr.onabort = () => reject(new ServerConvertError('aborted', 'cancelled'));
    xhr.onload = () => {
      signal?.removeEventListener('abort', abort);
      let body: StartResponse | null = null;
      try { body = JSON.parse(xhr.responseText) as StartResponse; } catch { /* not our API */ }
      // the server answers with the container it chose out of the list we sent
      if (xhr.status === 200 && body?.ok && body.job) { resolve({ job: body.job, format: body.format && FORMATS.includes(body.format) ? body.format : formats[0] }); return; }
      if (!body) { reject(new ServerConvertError('unreachable', `the conversion service answered with ${xhr.status}`)); return; }
      reject(new ServerConvertError(reasonOf(xhr.status, body), body.error || `conversion refused (${xhr.status})`));
    };
    signal?.addEventListener('abort', abort, { once: true });
    const form = new FormData();
    form.append('formats', formats.join(',')); // fields before the file, so the server sees them first
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

async function cancelJob(job: string) {
  try { await fetch(`${SERVER_API_URL}?action=cancel&job=${encodeURIComponent(job)}`, { method: 'POST', headers: authHeaders(), keepalive: true }); } catch { /* best effort */ }
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const to = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(to); reject(new ServerConvertError('aborted', 'cancelled')); };
  signal?.addEventListener('abort', stop, { once: true });
});

/** Downloads the finished file, reporting progress when the server declares its size. */
async function download(job: string, name: string, format: ServerFormat, signal?: AbortSignal, onProgress?: (ratio: number) => void): Promise<File> {
  const res = await fetch(`${SERVER_API_URL}?action=result&job=${encodeURIComponent(job)}`, { headers: authHeaders(), signal });
  if (!res.ok) throw new ServerConvertError('failed', `the converted file could not be downloaded (${res.status})`);
  const total = Number(res.headers.get('content-length') || 0);
  let blob: Blob;
  if (res.body && total > 0) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress?.(Math.min(1, got / total));
    }
    blob = new Blob(chunks as BlobPart[], { type: MIME[format] });
  } else {
    blob = await res.blob();
  }
  if (!blob.size) throw new ServerConvertError('failed', 'the server returned an empty file');
  return new File([blob], name.replace(/\.[^.]+$/, '') + '.' + format, { type: MIME[format] });
}

/**
 * Converts one file on the host: upload → poll → download. Throws a ServerConvertError whose
 * `reason` tells the caller whether it is worth retrying in the browser (almost always yes).
 */
export async function transcodeOnServer(file: File, { onProgress, signal }: { onProgress?: (p: TranscodeProgress) => void; signal?: AbortSignal } = {}): Promise<File> {
  const health = await probeServer();
  if (!health) throw new ServerConvertError('unreachable', 'no conversion service on this host');
  if (!health.ok) throw new ServerConvertError('unavailable', health.reason || 'the host cannot convert');
  if (file.size > health.maxBytes) throw new ServerConvertError('too-large', `the host accepts at most ${Math.floor(health.maxBytes / 1024 / 1024)} MB`);
  // Never spend an upload on a host whose output this browser could not play anyway.
  const wanted = playableFormats().filter((f) => health.formats?.[f]);
  if (!wanted.length) throw new ServerConvertError('unavailable', `the host writes ${Object.keys(health.formats || {}).join(', ') || 'nothing'}, which this browser cannot play`);
  if (signal?.aborted) throw new ServerConvertError('aborted', 'cancelled');

  const report = (stage: TranscodeProgress['stage'], ratio: number) => onProgress?.({ ratio: Math.max(0, Math.min(1, ratio)), stage, where: 'server' });
  report('uploading', 0);
  const { job, format } = await upload(file, wanted, (r) => report('uploading', r), signal);
  let cancelled = false;
  const onAbort = () => { cancelled = true; void cancelJob(job); };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    report('converting', 0);
    // Poll gently: often at first so a short clip feels instant, then slower for long ones.
    for (let tick = 0; ; tick++) {
      await wait(tick < 5 ? 700 : tick < 30 ? 1500 : 3000, signal);
      let status: StatusResponse;
      try {
        const res = await fetch(`${SERVER_API_URL}?action=status&job=${encodeURIComponent(job)}`, { headers: authHeaders(), cache: 'no-store', signal });
        if (res.status === 404) throw new ServerConvertError('failed', 'the conversion job disappeared on the server');
        status = await res.json() as StatusResponse;
      } catch (e) {
        if (e instanceof ServerConvertError) throw e;
        if (signal?.aborted) throw new ServerConvertError('aborted', 'cancelled');
        continue; // a single dropped poll is not a failure; the next one will tell us
      }
      if (status.state === 'done') break;
      if (status.state === 'error') throw new ServerConvertError('failed', status.error || 'conversion failed', status.log || []);
      if (status.state === 'cancelled') throw new ServerConvertError('aborted', 'cancelled');
      report('converting', status.progress || 0);
    }
    report('downloading', 0);
    const out = await download(job, file.name, format, signal, (r) => report('downloading', r));
    report('downloading', 1);
    return out;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    if (!cancelled) void cancelJob(job); // free the work directory straight away
  }
}
