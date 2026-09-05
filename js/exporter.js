// ===================== Export (MediaRecorder: canvas + mixed audio) =====================
import { fixWebmDuration } from './webm-fix.js';

const CANDIDATES = [
  { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', label: 'MP4 (H.264 / AAC)', ext: 'mp4', video: true },
  { mime: 'video/mp4;codecs=avc1,mp4a.40.2', label: 'MP4 (H.264 / AAC)', ext: 'mp4', video: true },
  { mime: 'video/mp4', label: 'MP4', ext: 'mp4', video: true },
  { mime: 'video/webm;codecs=vp9,opus', label: 'WebM (VP9 / Opus)', ext: 'webm', video: true },
  { mime: 'video/webm;codecs=h264,opus', label: 'WebM (H.264 / Opus)', ext: 'webm', video: true },
  { mime: 'video/webm;codecs=vp8,opus', label: 'WebM (VP8 / Opus)', ext: 'webm', video: true },
  { mime: 'video/webm', label: 'WebM', ext: 'webm', video: true },
  { mime: 'audio/mp4;codecs=mp4a.40.2', label: 'M4A (AAC)', ext: 'm4a', video: false },
  { mime: 'audio/webm;codecs=opus', label: 'WebM Audio (Opus)', ext: 'weba', video: false },
  { mime: 'audio/webm', label: 'WebM Audio', ext: 'weba', video: false },
];

export function supportedFormats() {
  if (typeof MediaRecorder === 'undefined') return [];
  const seen = new Set();
  return CANDIDATES.filter((c) => {
    if (!MediaRecorder.isTypeSupported(c.mime)) return false;
    const key = c.label; if (seen.has(key)) return false; seen.add(key); return true;
  });
}

export class Exporter {
  constructor(player, store) { this.player = player; this.store = store; this.active = false; this._cancel = false; }
  cancel() { this._cancel = true; }

  /**
   * @param {object} opts {format, fps, videoBitrate, audioBitrate, muteMonitor}
   * @param {(info:{time:number,duration:number,progress:number})=>void} onProgress
   * @returns {Promise<{blob:Blob, ext:string, duration:number}>}
   */
  async run(opts, onProgress) {
    const { player, store } = this;
    if (this.active) throw new Error('busy');
    const duration = store.projectDuration();
    if (duration <= 0) throw new Error('empty');
    this.active = true; this._cancel = false;
    const prevMuted = player.monitorMuted;
    let recorder, timer;
    const chunks = [];
    try {
      player.pause();
      await player.resumeAudio();
      await player.prepare();
      player.seek(0);
      player.exporting = true;
      if (opts.muteMonitor) player.setMonitorMuted(true);
      // Prime element positions and give decoders a moment to render the first frame.
      player._syncElements(0); player.render(0);
      await new Promise((r) => setTimeout(r, 250));

      const tracks = [];
      if (opts.format.video) tracks.push(...player.canvas.captureStream(opts.fps).getVideoTracks());
      tracks.push(...player.recDest.stream.getAudioTracks());
      const stream = new MediaStream(tracks);
      const rOpts = { mimeType: opts.format.mime };
      if (opts.format.video && opts.videoBitrate) rOpts.videoBitsPerSecond = opts.videoBitrate;
      if (opts.audioBitrate) rOpts.audioBitsPerSecond = opts.audioBitrate;
      recorder = new MediaRecorder(stream, rOpts);
      recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((res) => { recorder.onstop = res; });
      const errored = new Promise((_, rej) => { recorder.onerror = (e) => rej(e.error || new Error('recorder error')); });

      recorder.start(500);
      const started = performance.now();
      await player.play();

      await Promise.race([
        new Promise((res) => {
          const off = player.on('ended', () => { off(); res(); });
          timer = setInterval(() => {
            const t = player.currentTime;
            onProgress && onProgress({ time: Math.min(t, duration), duration, progress: Math.min(1, t / duration) });
            if (this._cancel) { off(); res(); }
          }, 200);
        }),
        errored,
      ]);
      clearInterval(timer);
      player.pause();
      // small tail so the encoder flushes the last frames/samples
      await new Promise((r) => setTimeout(r, 300));
      if (recorder.state !== 'inactive') recorder.stop();
      await stopped;
      if (this._cancel) throw new Error('cancelled');
      let blob = new Blob(chunks, { type: opts.format.mime.split(';')[0] });
      const realDuration = Math.min(duration, (performance.now() - started) / 1000);
      if (opts.format.ext === 'webm' || opts.format.ext === 'weba') blob = await fixWebmDuration(blob, realDuration);
      return { blob, ext: opts.format.ext, duration: realDuration };
    } finally {
      clearInterval(timer);
      try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch { /* ignore */ }
      player.exporting = false;
      player.setMonitorMuted(prevMuted);
      player.pause();
      player.seek(0);
      this.active = false;
    }
  }
}
