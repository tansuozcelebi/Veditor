// ===================== Playback engine: canvas compositor + Web Audio mixer =====================
import { clamp } from './state.js';

const DRIFT_TOLERANCE = 0.2;   // seconds before a playing element is re-synced
const SCRUB_TOLERANCE = 0.02;  // seconds when paused/scrubbing
const PREROLL = 1.5;           // seconds ahead to pre-seek upcoming clips

class Emitter {
  constructor() { this._l = {}; }
  on(ev, fn) { (this._l[ev] ||= new Set()).add(fn); return () => this._l[ev].delete(fn); }
  emit(ev, d) { this._l[ev]?.forEach((f) => f(d)); }
}

export class Player extends Emitter {
  constructor(store, canvas, host) {
    super();
    this.store = store;
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d', { alpha: false });
    this.host = host;
    this.audio = null; // AudioContext, created lazily
    this.nodes = new Map(); // clipId -> {el, gain, kind, mediaId, ready}
    this.trackGains = new Map();
    this.playing = false;
    this._time = 0;
    this._startCtx = 0;
    this._startTime = 0;
    this.viewMode = 'composite';
    this.monitorVolume = 1;
    this.monitorMuted = false;
    this.exporting = false;
    this._raf = 0;
    this._lastFrameTime = -1;
    this._loop = this._loop.bind(this);
    this._raf = requestAnimationFrame(this._loop);
    store.on('change', () => this._syncNodes());
    store.on('media', () => this._syncNodes());
  }

  // ---------- audio graph ----------
  ensureAudio() {
    if (this.audio) return this.audio;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.audio = ctx;
    this.mixBus = ctx.createGain();
    this.monitorGain = ctx.createGain();
    this.recDest = ctx.createMediaStreamDestination();
    this.mixBus.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);
    this.mixBus.connect(this.recDest);
    this._applyMonitor();
    // rebuild nodes for existing clips now that the context exists (they were created muted)
    for (const id of [...this.nodes.keys()]) this._disposeNode(id);
    this._syncNodes();
    return ctx;
  }
  async resumeAudio() {
    const ctx = this.ensureAudio();
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* ignore */ } }
  }
  _applyMonitor() {
    if (!this.monitorGain) return;
    const v = this.monitorMuted ? 0 : this.monitorVolume;
    this.monitorGain.gain.setTargetAtTime(v, this.audio.currentTime, 0.01);
  }
  setMonitorVolume(v) { this.monitorVolume = clamp(v, 0, 1); this._applyMonitor(); }
  setMonitorMuted(m) { this.monitorMuted = !!m; this._applyMonitor(); }

  _trackGain(trackId) {
    let g = this.trackGains.get(trackId);
    if (!g && this.audio) { g = this.audio.createGain(); g.connect(this.mixBus); this.trackGains.set(trackId, g); }
    return g;
  }

  /** Create/destroy media elements to match the clip list. */
  _syncNodes() {
    const clips = this.store.project.clips;
    const alive = new Set();
    for (const c of clips) {
      const m = this.store.media.get(c.mediaId);
      if (!m) continue;
      alive.add(c.id);
      let n = this.nodes.get(c.id);
      if (n && n.mediaId !== c.mediaId) { this._disposeNode(c.id); n = null; }
      if (!n) n = this._createNode(c, m);
      // (re)connect track gain if track changed
      if (n.gain && n.trackId !== c.trackId) {
        try { n.gain.disconnect(); } catch { /* ignore */ }
        const tg = this._trackGain(c.trackId);
        if (tg) n.gain.connect(tg);
        n.trackId = c.trackId;
      }
    }
    for (const id of [...this.nodes.keys()]) if (!alive.has(id)) this._disposeNode(id);
    // drop gains for removed tracks
    for (const id of [...this.trackGains.keys()]) if (!this.store.getTrack(id)) { try { this.trackGains.get(id).disconnect(); } catch { /* ignore */ } this.trackGains.delete(id); }
  }
  _createNode(clip, m) {
    const n = { el: null, gain: null, kind: m.kind, mediaId: m.id, trackId: null, ready: false, lastSeek: -1 };
    if (m.kind === 'image') {
      n.el = m.image || Object.assign(new Image(), { src: m.url });
      n.ready = true;
    } else {
      const el = document.createElement(m.kind === 'video' ? 'video' : 'audio');
      el.preload = 'auto'; el.playsInline = true; el.crossOrigin = 'anonymous';
      el.src = m.url;
      el.addEventListener('loadeddata', () => { n.ready = true; });
      this.host.appendChild(el);
      n.el = el;
      if (this.audio) {
        try {
          n.src = this.audio.createMediaElementSource(el);
          n.gain = this.audio.createGain();
          n.gain.gain.value = 0;
          n.src.connect(n.gain);
        } catch (e) { console.warn('audio source failed', e); }
      } else {
        el.muted = true; // no audio graph yet: keep silent until the context exists
      }
      el.load();
    }
    this.nodes.set(clip.id, n);
    return n;
  }
  _disposeNode(id) {
    const n = this.nodes.get(id); if (!n) return;
    try { n.gain?.disconnect(); n.src?.disconnect(); } catch { /* ignore */ }
    if (n.el && n.el.tagName !== 'IMG') { try { n.el.pause(); n.el.removeAttribute('src'); n.el.load(); n.el.remove(); } catch { /* ignore */ } }
    this.nodes.delete(id);
  }

  // ---------- transport ----------
  get currentTime() {
    if (this.playing && this.audio) return this._startTime + (this.audio.currentTime - this._startCtx);
    return this._time;
  }
  get duration() { return this.store.projectDuration(); }
  async play() {
    if (this.playing) return;
    await this.resumeAudio();
    if (this._time >= this.duration - 1e-3) this._time = 0;
    this._startCtx = this.audio.currentTime;
    this._startTime = this._time;
    this.playing = true;
    this.emit('play');
  }
  pause() {
    if (!this.playing) return;
    this._time = this.currentTime;
    this.playing = false;
    for (const n of this.nodes.values()) if (n.el && n.el.pause && !n.el.paused) n.el.pause();
    this.emit('pause');
    this.emit('time', this._time);
  }
  toggle() { return this.playing ? this.pause() : this.play(); }
  seek(t) {
    t = clamp(t, 0, Math.max(0, this.duration));
    if (this.playing) { this._startTime = t; this._startCtx = this.audio.currentTime; }
    else this._time = t;
    this.emit('time', t);
  }
  stepFrame(dir) { this.pause(); this.seek(this.currentTime + dir / this.store.project.fps); }

  /** Wait until every media element used by clips has data (used before exporting). */
  async prepare(timeoutMs = 8000) {
    this.ensureAudio();
    this._syncNodes();
    const waits = [];
    for (const [, n] of this.nodes) {
      if (n.ready || !n.el || n.el.tagName === 'IMG') continue;
      waits.push(new Promise((res) => {
        const to = setTimeout(res, timeoutMs);
        const h = () => { clearTimeout(to); n.el.removeEventListener('loadeddata', h); res(); };
        n.el.addEventListener('loadeddata', h);
        if (n.el.readyState >= 2) h();
      }));
    }
    await Promise.all(waits);
  }

  // ---------- per-frame ----------
  _loop() {
    this._raf = requestAnimationFrame(this._loop);
    const t = this.currentTime;
    this._syncElements(t);
    this.render(t);
    if (this.playing) {
      this.emit('time', t);
      if (t >= this.duration) {
        this.pause();
        this._time = this.duration;
        this.emit('time', this._time);
        this.emit('ended');
      }
    }
  }

  _soloActive() { return this.store.project.tracks.some((tr) => tr.solo); }

  _clipGain(clip, track, t, solo) {
    if (clip.muted || track.muted) return 0;
    if (solo && !track.solo) return 0;
    let g = clip.volume;
    const local = t - clip.start;
    if (clip.fadeIn > 0 && local < clip.fadeIn) g *= clamp(local / clip.fadeIn, 0, 1);
    const rem = clip.duration - local;
    if (clip.fadeOut > 0 && rem < clip.fadeOut) g *= clamp(rem / clip.fadeOut, 0, 1);
    return g;
  }

  _syncElements(t) {
    const solo = this._soloActive();
    const now = this.audio ? this.audio.currentTime : 0;
    for (const track of this.store.project.tracks) {
      const tg = this._trackGain(track.id);
      if (tg) tg.gain.value = track.volume;
    }
    for (const clip of this.store.project.clips) {
      const n = this.nodes.get(clip.id);
      if (!n || !n.el || n.kind === 'image') continue;
      const el = n.el;
      const track = this.store.getTrack(clip.trackId);
      if (!track) continue;
      const active = t >= clip.start && t < clip.start + clip.duration;
      const localT = clip.offset + (t - clip.start);
      if (active) {
        const g = this._clipGain(clip, track, t, solo);
        if (n.gain) n.gain.gain.setTargetAtTime(g, now, 0.005);
        if (this.playing) {
          if (el.paused) {
            if (Math.abs(el.currentTime - localT) > SCRUB_TOLERANCE) el.currentTime = localT;
            el.play().catch(() => { /* autoplay policy: will retry next frame */ });
          } else if (Math.abs(el.currentTime - localT) > DRIFT_TOLERANCE) {
            el.currentTime = localT;
          }
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - localT) > SCRUB_TOLERANCE && n.lastSeek !== localT) { n.lastSeek = localT; el.currentTime = localT; }
        }
      } else {
        if (!el.paused) el.pause();
        if (n.gain) n.gain.gain.value = 0;
        // preroll: park the element on its first frame shortly before it becomes active
        if (t < clip.start && clip.start - t < PREROLL && Math.abs(el.currentTime - clip.offset) > SCRUB_TOLERANCE && n.lastSeek !== clip.offset) {
          n.lastSeek = clip.offset; el.currentTime = clip.offset;
        }
      }
    }
  }

  /** Active visual clips ordered bottom→top (track order reversed). */
  _visualClips(t) {
    const out = [];
    const tracks = this.store.project.tracks;
    for (let i = tracks.length - 1; i >= 0; i--) {
      const tr = tracks[i];
      if (tr.kind !== 'video' || tr.hidden) continue;
      for (const c of this.store.project.clips) {
        if (c.trackId !== tr.id) continue;
        if (t >= c.start && t < c.start + c.duration) { out.push({ clip: c, track: tr }); break; }
      }
    }
    return out;
  }

  render(t) {
    const { width: W, height: H, background } = this.store.project;
    const canvas = this.canvas, g = this.ctx2d;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    g.fillStyle = background || '#000';
    g.fillRect(0, 0, W, H);
    const visual = this._visualClips(t);
    if (this.viewMode === 'grid' && visual.length > 1) {
      const n = visual.length;
      const cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
      const cw = W / cols, ch = H / rows;
      // top track first in grid
      visual.slice().reverse().forEach(({ clip, track }, i) => {
        const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
        this._drawClip(clip, { x: x + 2, y: y + 2, w: cw - 4, h: ch - 4 }, true);
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.fillRect(x + 8, y + 8, Math.min(cw - 16, 12 + track.name.length * 12), 26);
        g.fillStyle = '#fff'; g.font = `${Math.round(Math.min(cw, ch) * 0.05 + 8)}px sans-serif`; g.textBaseline = 'middle';
        g.fillText(track.name, x + 14, y + 21);
      });
    } else {
      for (const { clip } of visual) this._drawClip(clip, { x: 0, y: 0, w: W, h: H }, false);
    }
  }

  _drawClip(clip, dest, forceContain) {
    const n = this.nodes.get(clip.id);
    if (!n || !n.el) return;
    const el = n.el;
    let sw, sh;
    if (el.tagName === 'VIDEO') { if (el.readyState < 2) return; sw = el.videoWidth; sh = el.videoHeight; }
    else if (el.tagName === 'IMG') { if (!el.complete) return; sw = el.naturalWidth; sh = el.naturalHeight; }
    else return;
    if (!sw || !sh) return;
    const fit = forceContain ? 'contain' : clip.fit;
    let dw, dh;
    if (fit === 'stretch') { dw = dest.w; dh = dest.h; }
    else {
      const r = fit === 'cover' ? Math.max(dest.w / sw, dest.h / sh) : Math.min(dest.w / sw, dest.h / sh);
      dw = sw * r; dh = sh * r;
    }
    // the channel grid is a monitoring view: show every channel full-size, ignoring its layout transform
    const scale = forceContain ? 1 : clip.scale, ox = forceContain ? 0 : clip.x, oy = forceContain ? 0 : clip.y;
    dw *= scale; dh *= scale;
    const cx = dest.x + dest.w / 2 + (ox / 100) * dest.w;
    const cy = dest.y + dest.h / 2 + (oy / 100) * dest.h;
    const g = this.ctx2d;
    g.save();
    g.globalAlpha = clamp(clip.opacity, 0, 1);
    if (forceContain || fit === 'cover' || scale > 1) { g.beginPath(); g.rect(dest.x, dest.y, dest.w, dest.h); g.clip(); }
    try { g.drawImage(el, cx - dw / 2, cy - dh / 2, dw, dh); } catch { /* frame not ready */ }
    g.restore();
  }

  destroy() { cancelAnimationFrame(this._raf); for (const id of [...this.nodes.keys()]) this._disposeNode(id); }
}
