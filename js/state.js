// ===================== Project state, selection and undo/redo =====================
import { t } from './i18n.js';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const EPS = 1e-6;

export const RESOLUTIONS = [
  { label: '1080p (1920×1080)', w: 1920, h: 1080 },
  { label: '720p (1280×720)', w: 1280, h: 720 },
  { label: '4K (3840×2160)', w: 3840, h: 2160 },
  { label: 'Dikey / Vertical (1080×1920)', w: 1080, h: 1920 },
  { label: 'Kare / Square (1080×1080)', w: 1080, h: 1080 },
  { label: '480p (854×480)', w: 854, h: 480 },
];
export const IMAGE_DEFAULT_DURATION = 5;

class Emitter {
  constructor() { this._l = new Map(); }
  on(ev, fn) { if (!this._l.has(ev)) this._l.set(ev, new Set()); this._l.get(ev).add(fn); return () => this.off(ev, fn); }
  off(ev, fn) { this._l.get(ev)?.delete(fn); }
  emit(ev, data) { this._l.get(ev)?.forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); }
}

export function defaultProject() {
  return {
    name: t('project.default'),
    width: 1920, height: 1080, fps: 30, background: '#000000',
    tracks: [],
    clips: [],
  };
}

export function defaultClip(patch = {}) {
  return {
    id: uid(), trackId: null, mediaId: null, name: '',
    start: 0, duration: 0, offset: 0,
    volume: 1, muted: false, fadeIn: 0, fadeOut: 0,
    opacity: 1, fit: 'contain', scale: 1, x: 0, y: 0,
    ...patch,
  };
}

export class Store extends Emitter {
  constructor() {
    super();
    this.project = defaultProject();
    this.media = new Map();
    this.selection = { clipIds: new Set(), trackId: null };
    this.history = [];
    this.future = [];
    this.maxHistory = 100;
    this.dirty = false;
    // default tracks
    this.addTrack('video', null, { silent: true });
    this.addTrack('audio', null, { silent: true });
  }

  // ---------- history ----------
  snapshot() { return JSON.stringify(this.project); }
  pushHistory(snapshot) {
    this.history.push(snapshot ?? this.snapshot());
    if (this.history.length > this.maxHistory) this.history.shift();
    this.future = [];
    this.dirty = true;
    this.emit('history');
  }
  undo() {
    if (!this.history.length) return false;
    this.future.push(this.snapshot());
    this.project = JSON.parse(this.history.pop());
    this._pruneSelection();
    this.emit('change', { reason: 'undo' });
    this.emit('history');
    return true;
  }
  redo() {
    if (!this.future.length) return false;
    this.history.push(this.snapshot());
    this.project = JSON.parse(this.future.pop());
    this._pruneSelection();
    this.emit('change', { reason: 'redo' });
    this.emit('history');
    return true;
  }
  canUndo() { return this.history.length > 0; }
  canRedo() { return this.future.length > 0; }
  changed(reason = 'edit') { this.dirty = true; this.emit('change', { reason }); }

  _pruneSelection() {
    for (const id of [...this.selection.clipIds]) if (!this.getClip(id)) this.selection.clipIds.delete(id);
    if (this.selection.trackId && !this.getTrack(this.selection.trackId)) this.selection.trackId = null;
    this.emit('selection');
  }

  // ---------- tracks ----------
  getTrack(id) { return this.project.tracks.find((tr) => tr.id === id) || null; }
  addTrack(kind, name, { silent = false, index } = {}) {
    if (!silent) this.pushHistory();
    const n = this.project.tracks.filter((tr) => tr.kind === kind).length + 1;
    const track = { id: uid(), kind, name: name || `${t(kind === 'video' ? 'track.video' : 'track.audio')} ${n}`, muted: false, solo: false, locked: false, hidden: false, volume: 1 };
    if (index == null) {
      // video tracks are grouped at the top (index 0 = top layer), audio tracks below
      if (kind === 'video') this.project.tracks.unshift(track);
      else this.project.tracks.push(track);
    } else this.project.tracks.splice(index, 0, track);
    if (!silent) this.changed('addTrack');
    return track;
  }
  removeTrack(id) {
    const tr = this.getTrack(id); if (!tr) return;
    this.pushHistory();
    this.project.clips = this.project.clips.filter((c) => c.trackId !== id);
    this.project.tracks = this.project.tracks.filter((x) => x.id !== id);
    this._pruneSelection();
    this.changed('removeTrack');
  }
  updateTrack(id, patch, { silent = false, history = true } = {}) {
    const tr = this.getTrack(id); if (!tr) return;
    if (history && !silent) this.pushHistory();
    Object.assign(tr, patch);
    if (!silent) this.changed('updateTrack');
  }
  firstTrackOfKind(kind) { return this.project.tracks.find((tr) => tr.kind === kind) || null; }

  // ---------- clips ----------
  getClip(id) { return this.project.clips.find((c) => c.id === id) || null; }
  clipsOnTrack(trackId) { return this.project.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.start - b.start); }
  clipEnd(c) { return c.start + c.duration; }
  addClip(data, { silent = false } = {}) {
    if (!silent) this.pushHistory();
    const clip = defaultClip(data);
    this.project.clips.push(clip);
    if (!silent) this.changed('addClip');
    return clip;
  }
  removeClips(ids, { silent = false } = {}) {
    const set = new Set(ids);
    if (!set.size) return;
    if (!silent) this.pushHistory();
    this.project.clips = this.project.clips.filter((c) => !set.has(c.id));
    this._pruneSelection();
    if (!silent) this.changed('removeClips');
  }
  updateClip(id, patch, { silent = false, history = true } = {}) {
    const c = this.getClip(id); if (!c) return null;
    if (history && !silent) this.pushHistory();
    Object.assign(c, patch);
    if (!silent) this.changed('updateClip');
    return c;
  }

  /** Whether kind of media can be placed on given track kind. */
  canPlaceKind(mediaKind, trackKind) {
    if (trackKind === 'video') return mediaKind === 'video' || mediaKind === 'image';
    return mediaKind === 'audio' || mediaKind === 'video';
  }
  /** Is [start, start+duration) free on track (ignoring excluded clip ids)? */
  isFree(trackId, start, duration, excludeIds = []) {
    const ex = new Set(excludeIds);
    const end = start + duration;
    return !this.project.clips.some((c) => c.trackId === trackId && !ex.has(c.id) && c.start < end - EPS && this.clipEnd(c) > start + EPS);
  }
  /** Find the largest gap [lo, hi] on track containing `start` (or the gap after the last clip). */
  gapAt(trackId, start, excludeIds = []) {
    const ex = new Set(excludeIds);
    const clips = this.clipsOnTrack(trackId).filter((c) => !ex.has(c.id));
    let lo = 0, hi = Infinity;
    for (const c of clips) {
      const e = this.clipEnd(c);
      if (e <= start + EPS) lo = Math.max(lo, e);
      else if (c.start >= start - EPS) { hi = Math.min(hi, c.start); }
      else return null; // start lies inside a clip
    }
    return { lo, hi };
  }
  /** Find placement near desired start: returns a start value or null if it cannot fit. */
  findPlacement(trackId, desiredStart, duration, excludeIds = []) {
    desiredStart = Math.max(0, desiredStart);
    if (this.isFree(trackId, desiredStart, duration, excludeIds)) return desiredStart;
    const gap = this.gapAt(trackId, desiredStart, excludeIds);
    if (gap && gap.hi - gap.lo >= duration - EPS) return clamp(desiredStart, gap.lo, gap.hi - duration);
    // search gaps around
    const ex = new Set(excludeIds);
    const clips = this.clipsOnTrack(trackId).filter((c) => !ex.has(c.id));
    let candidates = [];
    let prevEnd = 0;
    for (const c of clips) {
      if (c.start - prevEnd >= duration - EPS) candidates.push({ lo: prevEnd, hi: c.start - duration });
      prevEnd = Math.max(prevEnd, this.clipEnd(c));
    }
    candidates.push({ lo: prevEnd, hi: Infinity });
    let best = null, bestDist = Infinity;
    for (const g of candidates) {
      const s = clamp(desiredStart, g.lo, g.hi);
      const d = Math.abs(s - desiredStart);
      if (d < bestDist) { best = s; bestDist = d; }
    }
    return best;
  }
  /** Max duration for a clip given media (Infinity for images). */
  maxClipDuration(clip) {
    const m = this.media.get(clip.mediaId);
    if (!m || m.kind === 'image') return Infinity;
    return Math.max(0, m.duration - clip.offset);
  }
  splitClipAt(id, time) {
    const c = this.getClip(id); if (!c) return null;
    if (time <= c.start + 0.01 || time >= this.clipEnd(c) - 0.01) return null;
    this.pushHistory();
    const first = c.duration;
    const d1 = time - c.start;
    c.duration = d1;
    // fades are kept on the outer edges only
    const right = defaultClip({ ...c, id: uid(), start: time, duration: first - d1, offset: c.offset + d1, fadeIn: 0 });
    c.fadeOut = 0;
    this.project.clips.push(right);
    this.changed('split');
    return right;
  }
  duplicateClip(id) {
    const c = this.getClip(id); if (!c) return null;
    const start = this.findPlacement(c.trackId, this.clipEnd(c), c.duration, []);
    if (start == null) return null;
    this.pushHistory();
    const copy = defaultClip({ ...c, id: uid(), start });
    this.project.clips.push(copy);
    this.changed('duplicate');
    return copy;
  }
  projectDuration() { return this.project.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0); }

  // ---------- media ----------
  addMedia(m) { this.media.set(m.id, m); this.emit('media'); return m; }
  removeMedia(id) {
    const m = this.media.get(id); if (!m) return;
    const clipIds = this.project.clips.filter((c) => c.mediaId === id).map((c) => c.id);
    if (clipIds.length) this.removeClips(clipIds);
    this.media.delete(id);
    if (m.url) { try { URL.revokeObjectURL(m.url); } catch { /* ignore */ } }
    this.emit('media');
  }

  // ---------- selection ----------
  selectClips(ids, { add = false } = {}) {
    if (!add) this.selection.clipIds = new Set();
    for (const id of ids) if (this.getClip(id)) this.selection.clipIds.add(id);
    if (ids.length) this.selection.trackId = null;
    this.emit('selection');
  }
  toggleClip(id) {
    if (this.selection.clipIds.has(id)) this.selection.clipIds.delete(id); else this.selection.clipIds.add(id);
    this.selection.trackId = null;
    this.emit('selection');
  }
  selectTrack(id) { this.selection.clipIds = new Set(); this.selection.trackId = id; this.emit('selection'); }
  clearSelection() { this.selection.clipIds = new Set(); this.selection.trackId = null; this.emit('selection'); }
  selectedClips() { return [...this.selection.clipIds].map((id) => this.getClip(id)).filter(Boolean); }

  // ---------- project (de)serialisation ----------
  toJSON() {
    return {
      app: 'veditor', version: 1,
      project: this.project,
      media: [...this.media.values()].map((m) => ({ id: m.id, name: m.name, kind: m.kind, duration: m.duration, width: m.width, height: m.height, size: m.size, type: m.type })),
    };
  }
  loadProject(project) {
    this.project = { ...defaultProject(), ...project };
    this.project.clips = (this.project.clips || []).map((c) => defaultClip(c));
    this.history = []; this.future = [];
    this.selection = { clipIds: new Set(), trackId: null };
    this.dirty = false;
    this.emit('history');
    this.emit('selection');
    this.emit('change', { reason: 'load' });
  }
}

// ---------- helpers ----------
export function formatTime(sec, { ms = true, fps = null } = {}) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n, l = 2) => String(n).padStart(l, '0');
  let out = (h ? pad(h) + ':' : '') + pad(m) + ':' + pad(s);
  if (fps) out += '.' + pad(Math.floor((sec - Math.floor(sec)) * fps));
  else if (ms) out += '.' + pad(Math.floor((sec - Math.floor(sec)) * 1000), 3);
  return out;
}
export function formatDurationShort(sec) {
  if (!isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  const h = Math.floor(m / 60);
  return (h ? h + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(s).padStart(2, '0');
}
export function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
