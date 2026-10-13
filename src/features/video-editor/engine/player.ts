// ===================== Playback engine: canvas compositor + Web Audio mixer =====================
import { clamp, type Store } from './state';
import { ensureFont } from './fonts';
import type { Clip, Track, TransitionType } from './types';

export interface MediaNode { el: HTMLVideoElement | HTMLAudioElement | HTMLImageElement | null; gain: GainNode | null; src?: MediaElementAudioSourceNode; kind: string; mediaId: string; trackId: string | null; ready: boolean; lastSeek: number }
/** `next` is set on a predecessor that is drawn only because `next` is transitioning in over it. */
export interface VisualEntry { clip: Clip; track: Track; extended: boolean; next?: Clip }
export type ShapeKind = 'iris' | 'diamond' | 'clock' | 'barn-h' | 'barn-v' | 'blinds-h' | 'blinds-v';
export interface TransitionFx {
  alpha: number; dx: number; dy: number; scale: number; scaleX: number; rotate: number;
  wipe: { from: 'left' | 'right' | 'top' | 'bottom'; p: number } | null;
  shape: { kind: ShapeKind; p: number } | null;
  blur: number; pixel: number;
  /** A colour laid over the picture (dip to black / white). */
  overlay: { color: string; alpha: number } | null;
}
export interface Rect { x: number; y: number; w: number; h: number }
interface TextLayout { lines: string[]; fontPx: number; lh: number; blockW: number; blockH: number; cx: number; cy: number; left: number; pad: number; bx: number; by: number; bw: number; bh: number }

const blankFx = (): TransitionFx => ({ alpha: 1, dx: 0, dy: 0, scale: 1, scaleX: 1, rotate: 0, wipe: null, shape: null, blur: 0, pixel: 0, overlay: null });

/**
 * One transition's contribution to a clip's look. p: 0 = fully transitioned-out, 1 = fully shown;
 * dir: +1 for in, -1 for out; hasPrev: the clip blends out of an adjacent predecessor on its track.
 */
export function applyTransition(fx: TransitionFx, type: TransitionType, p: number, dir: number, hasPrev: boolean) {
  const blend = hasPrev && dir > 0;
  switch (type) {
    case 'fade': fx.alpha *= p; break;
    case 'fade-black': case 'fade-white': {
      // dip: the outgoing picture goes to the colour, the incoming one comes back out of it
      const color = type === 'fade-black' ? '#000000' : '#ffffff';
      if (blend) fx.alpha *= p >= 0.5 ? 1 : 0; else fx.alpha *= clamp(p * 2, 0, 1);
      fx.overlay = { color, alpha: clamp((1 - p) * 2, 0, 1) };
      break;
    }
    case 'slide-left': case 'push-left': fx.dx += (1 - p) * dir; break;   // in: from the right; out: to the left
    case 'slide-right': case 'push-right': fx.dx -= (1 - p) * dir; break;
    case 'slide-up': case 'push-up': fx.dy += (1 - p) * dir; break;
    case 'slide-down': case 'push-down': fx.dy -= (1 - p) * dir; break;
    // reveal: the incoming clip stays put and is uncovered as the predecessor slides off it
    case 'reveal-left': if (dir > 0) fx.wipe = { from: 'right', p }; else fx.dx -= 1 - p; break;
    case 'reveal-right': if (dir > 0) fx.wipe = { from: 'left', p }; else fx.dx += 1 - p; break;
    case 'wipe-left': fx.wipe = { from: dir > 0 ? 'right' : 'left', p }; break;
    case 'wipe-right': fx.wipe = { from: dir > 0 ? 'left' : 'right', p }; break;
    case 'wipe-up': fx.wipe = { from: dir > 0 ? 'bottom' : 'top', p }; break;
    case 'wipe-down': fx.wipe = { from: dir > 0 ? 'top' : 'bottom', p }; break;
    case 'barn-h': case 'barn-v': case 'iris': case 'diamond': case 'clock': case 'blinds-h': case 'blinds-v':
      fx.shape = { kind: type, p }; break;
    case 'zoom': fx.scale *= 0.6 + 0.4 * p; fx.alpha *= p; break;
    case 'zoom-out': fx.scale *= 1 + 0.6 * (1 - p); fx.alpha *= p; break;
    case 'cross-zoom': fx.scale *= 1 + 0.5 * (1 - p); fx.blur += (1 - p) * 16; fx.alpha *= p; break;
    case 'spin': fx.rotate += (1 - p) * Math.PI * dir; fx.scale *= 0.2 + 0.8 * p; fx.alpha *= clamp(p * 1.5, 0, 1); break;
    case 'flip': fx.scaleX *= blend ? (p < 0.5 ? 0 : (p - 0.5) * 2) : p; break;
    case 'blur': fx.blur += (1 - p) * 24; fx.alpha *= 0.3 + 0.7 * p; break;
    case 'pixelate': fx.pixel = Math.max(fx.pixel, (1 - p) * 48); fx.alpha *= blend ? p : clamp(p * 2, 0, 1); break;
    default: break;
  }
}

/** The visible region of a shape transition at progress p (0 = nothing, 1 = everything). */
function shapePath(g: CanvasRenderingContext2D, kind: ShapeKind, p: number, d: Rect) {
  const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
  switch (kind) {
    case 'iris': g.arc(cx, cy, p * Math.hypot(d.w, d.h) / 2, 0, Math.PI * 2); break;
    case 'diamond': {
      const r = p * (d.w + d.h) / 2;
      g.moveTo(cx, cy - r); g.lineTo(cx + r, cy); g.lineTo(cx, cy + r); g.lineTo(cx - r, cy); g.closePath();
      break;
    }
    case 'clock': {
      const r = Math.hypot(d.w, d.h);
      g.moveTo(cx, cy); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); g.closePath();
      break;
    }
    case 'barn-h': g.rect(cx - (d.w * p) / 2, d.y, d.w * p, d.h); break;
    case 'barn-v': g.rect(d.x, cy - (d.h * p) / 2, d.w, d.h * p); break;
    case 'blinds-h': { const n = 10, s = d.h / n; for (let i = 0; i < n; i++) g.rect(d.x, d.y + i * s, d.w, s * p); break; }
    case 'blinds-v': { const n = 12, s = d.w / n; for (let i = 0; i < n; i++) g.rect(d.x + i * s, d.y, s * p, d.h); break; }
  }
}

const DRIFT_TOLERANCE = 0.2;   // seconds before a playing element is re-synced
const SCRUB_TOLERANCE = 0.02;  // seconds when paused/scrubbing
const PREROLL = 1.5;           // seconds ahead to pre-seek upcoming clips

export function hexToRgba(hex: string, alpha = 1) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return `rgba(0,0,0,${alpha})`;
  const v = parseInt(m[1], 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${alpha})`;
}

type Fn = (d?: any) => void;
class Emitter {
  private _l: Record<string, Set<Fn>> = {};
  on(ev: string, fn: Fn) { (this._l[ev] ||= new Set()).add(fn); return () => { this._l[ev].delete(fn); }; }
  emit(ev: string, d?: any) { this._l[ev]?.forEach((f) => f(d)); }
}

export class Player extends Emitter {
  store: Store;
  canvas: HTMLCanvasElement;
  ctx2d: CanvasRenderingContext2D;
  host: HTMLElement;
  audio: AudioContext | null = null; // created lazily on the first user gesture
  mixBus!: GainNode; monitorGain!: GainNode; recDest!: MediaStreamAudioDestinationNode;
  nodes = new Map<string, MediaNode>();
  trackGains = new Map<string, GainNode>();
  playing = false;
  viewMode: 'composite' | 'grid' = 'composite';
  monitorVolume = 1;
  monitorMuted = false;
  exporting = false;
  private _time = 0;
  private _startCtx = 0;
  private _startTime = 0;
  private _raf = 0;
  private _unsub: (() => void)[] = [];
  private _attached = false;
  private _pixCanvas: HTMLCanvasElement | null = null;
  private _reflCanvas: HTMLCanvasElement | null = null;
  constructor(store: Store, canvas: HTMLCanvasElement, host: HTMLElement) {
    super();
    this.store = store;
    this.canvas = canvas;
    this.ctx2d = canvas.getContext('2d', { alpha: false })!;
    this.host = host;
    this._loop = this._loop.bind(this);
    // attach() starts the render loop; the React provider (or play()) calls it, so an unused
    // instance never leaks an animation-frame loop
  }

  /**
   * Start the render loop and follow store changes. Idempotent, and the inverse of destroy():
   * React StrictMode (and route remounts) run effect cleanups and re-run the effects on the same
   * engine instance, so a destroyed player must be able to come back to life.
   */
  attach() {
    if (this._attached) return;
    this._attached = true;
    this._unsub.push(this.store.on('change', () => this._syncNodes()), this.store.on('media', () => this._syncNodes()));
    this._syncNodes();
    this._raf = requestAnimationFrame(this._loop);
  }

  // ---------- audio graph ----------
  ensureAudio() {
    if (this.audio) return this.audio;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.audio = ctx;
    this.mixBus = ctx.createGain();
    this.monitorGain = ctx.createGain();
    this.recDest = ctx.createMediaStreamDestination();
    this.mixBus.connect(this.monitorGain);
    this.monitorGain.connect(ctx.destination);
    this.mixBus.connect(this.recDest);
    this._applyMonitor();
    // attach the audio graph to elements that were created before the context existed
    // (they were kept muted); re-using them avoids reloading and re-decoding the media
    this._syncNodes();
    return ctx;
  }
  async resumeAudio() {
    const ctx = this.ensureAudio();
    if (ctx.state !== 'running') { try { await ctx.resume(); } catch { /* ignore */ } }
  }
  _applyMonitor() {
    if (!this.monitorGain || !this.audio) return;
    const v = this.monitorMuted ? 0 : this.monitorVolume;
    this.monitorGain.gain.setTargetAtTime(v, this.audio!.currentTime, 0.01);
  }
  setMonitorVolume(v: number) { this.monitorVolume = clamp(v, 0, 1); this._applyMonitor(); }
  setMonitorMuted(m: boolean) { this.monitorMuted = !!m; this._applyMonitor(); }

  _trackGain(trackId: string | null): GainNode | undefined {
    if (!trackId) return undefined;
    let g = this.trackGains.get(trackId);
    if (!g && this.audio) { g = this.audio.createGain(); g.connect(this.mixBus); this.trackGains.set(trackId, g); }
    return g;
  }

  /** Create/destroy media elements to match the clip list. */
  _syncNodes() {
    const clips = this.store.project.clips;
    const alive = new Set();
    for (const c of clips) {
      // a web font is fetched the first time a text layer asks for it; the next frame picks it up
      if (c.kind === 'text') void ensureFont(c.fontFamily);
      const m = c.mediaId ? this.store.media.get(c.mediaId) : null;
      if (!m) continue;
      alive.add(c.id);
      let n: MediaNode | undefined | null = this.nodes.get(c.id);
      if (n && n.mediaId !== c.mediaId) { this._disposeNode(c.id); n = null; }
      if (!n) n = this._createNode(c, m);
      if (this.audio && n.el && n.kind !== 'image' && !n.src) this._attachAudio(n);
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
    for (const id of [...this.trackGains.keys()]) if (!this.store.getTrack(id)) { try { this.trackGains.get(id)!.disconnect(); } catch { /* ignore */ } this.trackGains.delete(id); }
  }
  _createNode(clip: Clip, m: import('./types').MediaItem): MediaNode {
    const n: MediaNode = { el: null, gain: null, kind: m.kind, mediaId: m.id, trackId: null, ready: false, lastSeek: -1 };
    if (m.kind === 'image') {
      n.el = m.image || Object.assign(new Image(), { src: m.url });
      n.ready = true;
    } else {
      const el = document.createElement(m.kind === 'video' ? 'video' : 'audio') as HTMLVideoElement;
      el.preload = 'auto'; el.playsInline = true; el.crossOrigin = 'anonymous';
      el.src = m.url;
      el.addEventListener('loadeddata', () => { n.ready = true; });
      this.host.appendChild(el);
      n.el = el;
      el.muted = true; // silent until the element is routed through the audio graph
      if (this.audio) this._attachAudio(n);
      el.load();
    }
    this.nodes.set(clip.id, n);
    return n;
  }
  /** Route an element through its own GainNode into the mix bus. */
  _attachAudio(n: MediaNode) {
    try {
      n.src = this.audio!.createMediaElementSource(n.el as HTMLMediaElement);
      n.gain = this.audio!.createGain();
      n.gain.gain.value = 0;
      n.src.connect(n.gain);
      (n.el as HTMLMediaElement).muted = false;
      n.trackId = null; // force (re)connection to the track gain in _syncNodes
    } catch (e) { console.warn('audio source failed', e); }
  }
  _disposeNode(id: string) {
    const n = this.nodes.get(id); if (!n) return;
    try { n.gain?.disconnect(); n.src?.disconnect(); } catch { /* ignore */ }
    if (n.el && n.el.tagName !== 'IMG') { const el = n.el as HTMLMediaElement; try { el.pause(); el.removeAttribute('src'); el.load(); el.remove(); } catch { /* ignore */ } }
    this.nodes.delete(id);
  }

  // ---------- transport ----------
  get currentTime(): number {
    if (this.playing && this.audio) return this._startTime + (this.audio.currentTime - this._startCtx);
    return this._time;
  }
  get duration() { return this.store.projectDuration(); }
  async play() {
    if (this.playing) return;
    this.attach();
    await this.resumeAudio();
    if (this._time >= this.duration - 1e-3) this._time = 0;
    this._startCtx = this.audio!.currentTime;
    this._startTime = this._time;
    this.playing = true;
    this.emit('play');
  }
  pause() {
    if (!this.playing) return;
    this._time = this.currentTime;
    this.playing = false;
    for (const n of this.nodes.values()) { const el = n.el as HTMLMediaElement | null; if (el && el.pause && !el.paused) el.pause(); }
    this.emit('pause');
    this.emit('time', this._time);
  }
  toggle() { return this.playing ? this.pause() : this.play(); }
  seek(t: number) {
    t = clamp(t, 0, Math.max(0, this.duration));
    if (this.playing) { this._startTime = t; this._startCtx = this.audio!.currentTime; }
    else this._time = t;
    this.emit('time', t);
  }
  stepFrame(dir: number) { this.pause(); this.seek(this.currentTime + dir / this.store.project.fps); }

  /** Wait until every media element used by clips has data (used before exporting). */
  async prepare(timeoutMs = 8000) {
    this.ensureAudio();
    this._syncNodes();
    const waits: Promise<void>[] = [];
    for (const [, n] of this.nodes) {
      if (n.ready || !n.el || n.el.tagName === 'IMG') continue;
      const el = n.el as HTMLMediaElement;
      waits.push(new Promise<void>((res) => {
        const to = setTimeout(res, timeoutMs);
        const h = () => { clearTimeout(to); el.removeEventListener('loadeddata', h); res(); };
        el.addEventListener('loadeddata', h);
        if (el.readyState >= 2) h();
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

  _clipGain(clip: Clip, track: Track, t: number, solo: boolean) {
    if (clip.muted || track.muted) return 0;
    if (solo && !track.solo) return 0;
    let g = clip.volume;
    const local = t - clip.start;
    if (clip.fadeIn > 0 && local < clip.fadeIn) g *= clamp(local / clip.fadeIn, 0, 1);
    const rem = clip.duration - local;
    if (clip.fadeOut > 0 && rem < clip.fadeOut) g *= clamp(rem / clip.fadeOut, 0, 1);
    return g;
  }

  /**
   * Transition bookkeeping for one frame: for every clip that is directly followed by a clip
   * with a transition-in, the predecessor keeps running ("extended") for the transition duration
   * so both can be blended. Returns { ext: Map<clipId, {until, next}>, fadeIn: Map<clipId, prev> }.
   */
  _transitionInfo() {
    const ext = new Map<string, { until: number; next: Clip }>(), fadeIn = new Map<string, Clip>();
    for (const c of this.store.project.clips) {
      if (!c.transIn || c.transIn.type === 'none' || !(c.transIn.duration > 0)) continue;
      const prev = this.store.adjacentPrev(c);
      if (!prev) continue;
      ext.set(prev.id, { until: c.start + c.transIn.duration, next: c });
      fadeIn.set(c.id, prev);
    }
    return { ext, fadeIn };
  }

  _syncElements(t: number) {
    const solo = this._soloActive();
    const now = this.audio ? this.audio.currentTime : 0;
    for (const track of this.store.project.tracks) {
      const tg = this._trackGain(track.id);
      if (tg) tg.gain.value = track.volume;
    }
    const { ext, fadeIn } = this._transitionInfo();
    for (const clip of this.store.project.clips) {
      const n = this.nodes.get(clip.id);
      if (!n || !n.el || n.kind === 'image') continue;
      const el = n.el as HTMLMediaElement;
      const track = this.store.getTrack(clip.trackId);
      if (!track) continue;
      const end = clip.start + clip.duration;
      const e = ext.get(clip.id);
      const extended = e && t >= end && t < e.until;
      const active = (t >= clip.start && t < end) || extended;
      const localT = clip.offset + (t - clip.start);
      if (active) {
        let g = this._clipGain(clip, track, extended ? end - 1e-6 : t, solo);
        // audio cross-fade with the neighbouring clip during a transition
        if (extended) g *= clamp(1 - (t - end) / (e.until - end), 0, 1);
        const prev = fadeIn.get(clip.id);
        if (prev && t < clip.start + clip.transIn.duration) g *= clamp((t - clip.start) / clip.transIn.duration, 0, 1);
        if (n.gain) n.gain.gain.setTargetAtTime(g, now, 0.005);
        // a clip extended by a transition may run past the end of its media: hold the last frame instead of looping
        const pastEnd = isFinite(el.duration) && localT >= el.duration - 0.01;
        if (this.playing) {
          if (el.paused) {
            if (!pastEnd) {
              if (Math.abs(el.currentTime - localT) > SCRUB_TOLERANCE) el.currentTime = localT;
              el.play().catch(() => { /* autoplay policy: will retry next frame */ });
            }
          } else if (!pastEnd && Math.abs(el.currentTime - localT) > DRIFT_TOLERANCE) {
            el.currentTime = localT;
          }
        } else {
          if (!el.paused) el.pause();
          const target = pastEnd ? el.duration : localT;
          if (Math.abs(el.currentTime - target) > SCRUB_TOLERANCE && n.lastSeek !== target) { n.lastSeek = target; el.currentTime = target; }
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

  /** Active visual clips ordered bottom→top (track order reversed). A predecessor that is being
   *  blended into the next clip by a transition is included just below it, flagged `extended`. */
  _visualClips(t: number): VisualEntry[] {
    const out: VisualEntry[] = [];
    const tracks = this.store.project.tracks;
    for (let i = tracks.length - 1; i >= 0; i--) {
      const tr = tracks[i];
      if (tr.kind !== 'video' || tr.hidden) continue;
      for (const c of this.store.project.clips) {
        if (c.trackId !== tr.id) continue;
        if (t >= c.start && t < c.start + c.duration) {
          const prev = this.store.adjacentPrev(c);
          if (prev && c.transIn.type !== 'none' && c.transIn.duration > 0 && t < c.start + c.transIn.duration) out.push({ clip: prev, track: tr, extended: true, next: c });
          out.push({ clip: c, track: tr, extended: false });
          break;
        }
      }
    }
    return out;
  }

  /**
   * Visual effect of a clip's own transitions at time t. `p` runs 0 → 1 as the clip appears (in)
   * and 1 → 0 as it leaves (out); `dir` is +1 for in and -1 for out. When the clip blends out of an
   * adjacent predecessor, a few transitions behave differently (the predecessor does part of the work).
   */
  _transitionFx(clip: Clip, t: number): TransitionFx {
    const fx = blankFx();
    const tIn = clip.transIn, tOut = clip.transOut;
    if (tIn && tIn.type !== 'none' && tIn.duration > 0 && t < clip.start + tIn.duration) {
      applyTransition(fx, tIn.type, clamp((t - clip.start) / tIn.duration, 0, 1), 1, !!this.store.adjacentPrev(clip));
    }
    const end = clip.start + clip.duration;
    if (tOut && tOut.type !== 'none' && tOut.duration > 0 && t > end - tOut.duration) applyTransition(fx, tOut.type, clamp((end - t) / tOut.duration, 0, 1), -1, false);
    return fx;
  }

  /** What happens to the predecessor while `next` transitions in over it (it is pushed away, dips, zooms…). */
  _outgoingFx(next: Clip, t: number): TransitionFx {
    const fx = blankFx();
    const tr = next.transIn;
    if (!tr || tr.type === 'none' || !(tr.duration > 0)) return fx;
    const p = clamp((t - next.start) / tr.duration, 0, 1);
    switch (tr.type) {
      case 'fade-black': fx.overlay = { color: '#000000', alpha: clamp(p * 2, 0, 1) }; break;
      case 'fade-white': fx.overlay = { color: '#ffffff', alpha: clamp(p * 2, 0, 1) }; break;
      case 'push-left': case 'reveal-left': fx.dx -= p; break;
      case 'push-right': case 'reveal-right': fx.dx += p; break;
      case 'push-up': fx.dy -= p; break;
      case 'push-down': fx.dy += p; break;
      case 'cross-zoom': fx.scale *= 1 + 0.5 * p; fx.blur += p * 16; break;
      case 'flip': fx.scaleX *= Math.max(0, 1 - 2 * p); break;
      case 'pixelate': fx.pixel = Math.max(fx.pixel, p * 48); break;
      default: break;
    }
    return fx;
  }

  /** Apply transition geometry/clipping to the 2D context (must be inside save/restore). */
  _applyFx(g: CanvasRenderingContext2D, fx: TransitionFx, dest: Rect) {
    if (fx.wipe) {
      g.beginPath();
      const { from, p } = fx.wipe;
      const w = dest.w * p, h = dest.h * p;
      if (from === 'left') g.rect(dest.x, dest.y, w, dest.h);
      else if (from === 'right') g.rect(dest.x + dest.w - w, dest.y, w, dest.h);
      else if (from === 'top') g.rect(dest.x, dest.y, dest.w, h);
      else g.rect(dest.x, dest.y + dest.h - h, dest.w, h);
      g.clip();
    }
    if (fx.shape && fx.shape.p < 0.999) { g.beginPath(); shapePath(g, fx.shape.kind, fx.shape.p, dest); g.clip(); }
    if (fx.dx || fx.dy) g.translate(fx.dx * dest.w, fx.dy * dest.h);
    if (fx.scale !== 1 || fx.scaleX !== 1 || fx.rotate) {
      const cx = dest.x + dest.w / 2, cy = dest.y + dest.h / 2;
      g.translate(cx, cy);
      if (fx.rotate) g.rotate(fx.rotate);
      g.scale(fx.scale * fx.scaleX, fx.scale);
      g.translate(-cx, -cy);
    }
    if (fx.blur > 0.5 && 'filter' in g) g.filter = `blur(${Math.round(fx.blur * (dest.w / 1920))}px)`;
  }

  render(t: number) {
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
        this._drawClip(clip, { x: x + 2, y: y + 2, w: cw - 4, h: ch - 4 }, true, t);
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.fillRect(x + 8, y + 8, Math.min(cw - 16, 12 + track.name.length * 12), 26);
        g.fillStyle = '#fff'; g.font = `${Math.round(Math.min(cw, ch) * 0.05 + 8)}px sans-serif`; g.textBaseline = 'middle';
        g.fillText(track.name, x + 14, y + 21);
      });
    } else {
      for (const { clip, next } of visual) this._drawClip(clip, { x: 0, y: 0, w: W, h: H }, false, t, next);
    }
  }

  /** Where a media clip lands inside `dest` before any transition: fit, scale and position applied. */
  _mediaRect(clip: Clip, dest: Rect, forceContain: boolean): (Rect & { el: CanvasImageSource }) | null {
    const n = this.nodes.get(clip.id);
    if (!n || !n.el) return null;
    const el = n.el;
    let sw: number, sh: number;
    if (el instanceof HTMLVideoElement) { if (el.readyState < 2) return null; sw = el.videoWidth; sh = el.videoHeight; }
    else if (el instanceof HTMLImageElement) { if (!el.complete) return null; sw = el.naturalWidth; sh = el.naturalHeight; }
    else return null;
    if (!sw || !sh) return null;
    const fit = forceContain ? 'contain' : clip.fit;
    let dw: number, dh: number;
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
    return { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh, el: el as CanvasImageSource };
  }

  /** The rectangle a clip occupies in the composition (project pixels), for on-canvas editing. */
  clipBounds(clip: Clip): Rect | null {
    const dest = { x: 0, y: 0, w: this.store.project.width, h: this.store.project.height };
    if (clip.kind === 'text') {
      const L = this._textLayout(clip, dest, false);
      return L ? { x: L.bx, y: L.by, w: L.bw, h: L.bh } : null;
    }
    const r = this._mediaRect(clip, dest, false);
    if (r) return { x: r.x, y: r.y, w: r.w, h: r.h };
    // not decoded yet: fall back to the media's own aspect ratio
    const m = clip.mediaId ? this.store.media.get(clip.mediaId) : null;
    if (!m || !m.width || !m.height) return null;
    const k = Math.min(dest.w / m.width, dest.h / m.height) * clip.scale;
    const w = clip.fit === 'stretch' ? dest.w * clip.scale : m.width * k, h = clip.fit === 'stretch' ? dest.h * clip.scale : m.height * k;
    return { x: dest.w / 2 + (clip.x / 100) * dest.w - w / 2, y: dest.h / 2 + (clip.y / 100) * dest.h - h / 2, w, h };
  }

  _drawClip(clip: Clip, dest: Rect, forceContain: boolean, t: number = this.currentTime, next?: Clip) {
    // a predecessor being blended away follows the incoming clip's transition, not its own
    const fx = next ? this._outgoingFx(next, t) : this._transitionFx(clip, t);
    const trackOpacity = this.store.getTrack(clip.trackId)?.opacity ?? 1;
    if (clip.kind === 'text') { this._drawText(clip, dest, forceContain, fx, trackOpacity); return; }
    const r = this._mediaRect(clip, dest, forceContain);
    if (!r) return;
    const g = this.ctx2d;
    g.save();
    g.globalAlpha = clamp(clip.opacity * trackOpacity * fx.alpha, 0, 1);
    if (g.globalAlpha <= 0.001) { g.restore(); return; }
    const moves = fx.dx || fx.dy || fx.scale !== 1 || fx.scaleX !== 1 || fx.rotate;
    if (forceContain || clip.fit === 'cover' || clip.scale > 1 || moves) { g.beginPath(); g.rect(dest.x, dest.y, dest.w, dest.h); g.clip(); }
    this._applyFx(g, fx, dest);
    try {
      if (fx.pixel > 1.5) {
        // pixelate: draw tiny, then blow up without smoothing
        const block = Math.max(2, fx.pixel * (dest.w / 1920));
        const pw = Math.max(1, Math.ceil(r.w / block)), ph = Math.max(1, Math.ceil(r.h / block));
        const pc = (this._pixCanvas ||= document.createElement('canvas'));
        if (pc.width !== pw || pc.height !== ph) { pc.width = pw; pc.height = ph; }
        const pg = pc.getContext('2d')!;
        pg.imageSmoothingEnabled = true;
        pg.drawImage(r.el, 0, 0, pw, ph);
        g.imageSmoothingEnabled = false;
        g.drawImage(pc, 0, 0, pw, ph, r.x, r.y, r.w, r.h);
        g.imageSmoothingEnabled = true;
      } else g.drawImage(r.el, r.x, r.y, r.w, r.h);
      if (fx.overlay && fx.overlay.alpha > 0) {
        g.filter = 'none';
        g.globalAlpha = clamp(clip.opacity * trackOpacity * fx.alpha * fx.overlay.alpha, 0, 1);
        g.fillStyle = fx.overlay.color;
        g.fillRect(r.x, r.y, r.w, r.h);
      }
    } catch { /* frame not ready */ }
    g.restore();
  }

  /** Word-wrap text to a maximum pixel width using the current context font. */
  _wrapText(g: CanvasRenderingContext2D, text: string, maxWidth: number) {
    const lines: string[] = [];
    for (const para of String(text).split(/\r?\n/)) {
      const words = para.split(/\s+/).filter(Boolean);
      if (!words.length) { lines.push(''); continue; }
      let line = words[0];
      for (let i = 1; i < words.length; i++) {
        const test = line + ' ' + words[i];
        if (g.measureText(test).width <= maxWidth) line = test; else { lines.push(line); line = words[i]; }
      }
      lines.push(line);
    }
    return lines;
  }

  _textFont(clip: Clip, fontPx: number) {
    return `${clip.italic ? 'italic ' : ''}${clip.bold ? 'bold ' : ''}${fontPx}px "${clip.fontFamily || 'Arial'}", sans-serif`;
  }
  _setTextStyle(g: CanvasRenderingContext2D, clip: Clip, fontPx: number) {
    g.font = this._textFont(clip, fontPx);
    g.textBaseline = 'middle';
    const ls = (clip.letterSpacing || 0) / 100 * fontPx;
    if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${ls}px`;
  }

  /** Line breaks and geometry of a text layer; `bx/by/bw/bh` is the block including its padding. */
  _textLayout(clip: Clip, dest: Rect, forceContain: boolean): TextLayout | null {
    const text = clip.text || '';
    if (!text.trim()) return null;
    const g = this.ctx2d;
    const scale = forceContain ? 1 : clip.scale, ox = forceContain ? 0 : clip.x, oy = forceContain ? 0 : clip.y;
    const fontPx = Math.max(4, dest.h * (clip.fontSize / 100) * scale);
    g.save();
    this._setTextStyle(g, clip, fontPx);
    const lines = this._wrapText(g, text, dest.w * 0.9);
    const blockW = Math.max(...lines.map((l) => g.measureText(l).width), 1);
    g.restore();
    const lh = fontPx * (clip.lineHeight || 1.2);
    const blockH = lines.length * lh;
    const cx = dest.x + dest.w / 2 + (ox / 100) * dest.w;
    const cy = dest.y + dest.h / 2 + (oy / 100) * dest.h;
    const left = cx - blockW / 2;
    const pad = fontPx * 0.35, vpad = clip.bgEnabled ? pad * 0.6 : fontPx * 0.08;
    return { lines, fontPx, lh, blockW, blockH, cx, cy, left, pad, bx: left - pad, by: cy - blockH / 2 - vpad, bw: blockW + pad * 2, bh: blockH + vpad * 2 };
  }

  /** Background box, outline and fill of a text block, in absolute coordinates of `g`. */
  _paintText(g: CanvasRenderingContext2D, clip: Clip, L: TextLayout, withShadow: boolean) {
    if (clip.bgEnabled) {
      g.fillStyle = hexToRgba(clip.bgColor || '#000000', clip.bgOpacity ?? 0.6);
      g.fillRect(L.left - L.pad, L.cy - L.blockH / 2 - L.pad * 0.6, L.blockW + L.pad * 2, L.blockH + L.pad * 1.2);
    }
    if (withShadow && clip.shadow) {
      g.shadowColor = hexToRgba(clip.shadowColor || '#000000', clip.shadowOpacity ?? 0.6);
      g.shadowBlur = L.fontPx * (clip.shadowBlur ?? 15) / 100;
      g.shadowOffsetX = L.fontPx * (clip.shadowX ?? 4) / 100;
      g.shadowOffsetY = L.fontPx * (clip.shadowY ?? 4) / 100;
    }
    const align: CanvasTextAlign = clip.align || 'center';
    g.textAlign = align;
    const ax = align === 'left' ? L.left : align === 'right' ? L.left + L.blockW : L.cx;
    L.lines.forEach((line, i) => {
      const y = L.cy - L.blockH / 2 + L.lh * (i + 0.5);
      if (clip.outlineWidth > 0) {
        g.lineJoin = 'round'; g.lineWidth = L.fontPx * (clip.outlineWidth / 100) * 2; g.strokeStyle = clip.outlineColor || '#000';
        g.strokeText(line, ax, y);
      }
      g.fillStyle = clip.color || '#fff';
      g.fillText(line, ax, y);
    });
    g.shadowColor = 'transparent'; g.shadowBlur = 0; g.shadowOffsetX = 0; g.shadowOffsetY = 0;
  }

  /** Render a text layer clip with optional background box, outline, shadow, reflection and transitions. */
  _drawText(clip: Clip, dest: Rect, forceContain: boolean, fx: TransitionFx, trackOpacity = 1) {
    const L = this._textLayout(clip, dest, forceContain);
    if (!L) return;
    const g = this.ctx2d;
    const dip = fx.overlay ? 1 - fx.overlay.alpha : 1;
    const alpha = clamp(clip.opacity * trackOpacity * fx.alpha * dip, 0, 1);
    if (alpha <= 0.001) return;
    g.save();
    g.globalAlpha = alpha;
    g.beginPath(); g.rect(dest.x, dest.y, dest.w, dest.h); g.clip();
    this._applyFx(g, fx, dest);
    if (clip.reflection && (clip.reflectionOpacity ?? 0) > 0) this._paintReflection(g, clip, L);
    this._setTextStyle(g, clip, L.fontPx);
    this._paintText(g, clip, L, true);
    g.restore();
  }

  /** A mirrored copy of the block below it, fading out with distance – the classic "wet floor" look. */
  _paintReflection(g: CanvasRenderingContext2D, clip: Clip, L: TextLayout) {
    const bw = Math.ceil(L.bw), bh = Math.ceil(L.bh);
    if (bw < 1 || bh < 1 || bw > 16384 || bh > 16384) return;
    const off = (this._reflCanvas ||= document.createElement('canvas'));
    if (off.width !== bw || off.height !== bh) { off.width = bw; off.height = bh; }
    const o = off.getContext('2d')!;
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'source-over';
    o.globalAlpha = 1;
    o.clearRect(0, 0, bw, bh);
    o.setTransform(1, 0, 0, 1, -L.bx, -L.by);
    this._setTextStyle(o, clip, L.fontPx);
    this._paintText(o, clip, L, false);
    // the fade: strongest at the text's own bottom edge (which becomes the top of the mirror image)
    o.setTransform(1, 0, 0, 1, 0, 0);
    o.globalCompositeOperation = 'destination-in';
    const len = clamp((clip.reflectionLength ?? 60) / 100, 0.05, 1);
    const grad = o.createLinearGradient(0, bh, 0, bh * (1 - len));
    grad.addColorStop(0, `rgba(0,0,0,${clamp(clip.reflectionOpacity ?? 0.4, 0, 1)})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    o.fillStyle = grad;
    o.fillRect(0, 0, bw, bh);
    o.globalCompositeOperation = 'source-over';
    const gap = L.blockH * (clip.reflectionGap ?? 0) / 100;
    g.save();
    g.translate(L.bx, L.by + L.bh + gap);
    g.scale(1, -1);
    g.drawImage(off, 0, -L.bh, L.bw, L.bh);
    g.restore();
  }

  /** Stop everything and release media/audio resources. The player can be revived with attach(). */
  destroy() {
    if (this.playing) this.pause();
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this._unsub.forEach((u) => u());
    this._unsub = [];
    this._attached = false;
    for (const id of [...this.nodes.keys()]) this._disposeNode(id);
    for (const g of this.trackGains.values()) { try { g.disconnect(); } catch { /* ignore */ } }
    this.trackGains.clear();
    if (this.audio) { try { void this.audio.close(); } catch { /* ignore */ } this.audio = null; }
  }
}
