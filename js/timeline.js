// ===================== Timeline: tracks, clips, drag / trim / snap, ruler, playhead =====================
import { clamp, formatDurationShort } from './state.js';
import { PEAKS_PER_SECOND } from './media.js';
import { t } from './i18n.js';

const MIN_CLIP = 0.05;
const SNAP_PX = 8;
const HEADER_W = 190;
const LANE_H = { video: 68, audio: 56 };
const PPS_MIN = 2, PPS_MAX = 400;

export class Timeline {
  constructor(store, player, els, hooks = {}) {
    this.store = store; this.player = player; this.els = els; this.hooks = hooks;
    this.pps = 40;
    this.snap = true;
    this.clipEls = new Map();
    this.headerEls = new Map();
    this.laneEls = new Map();
    this._drag = null;
    this._bind();
    store.on('change', () => this.render());
    store.on('selection', () => this._applySelection());
    store.on('media', () => this._refreshClipContents());
    player.on('time', (tm) => this._positionPlayhead(tm, true));
    new ResizeObserver(() => this.render()).observe(els.body);
    this.render();
  }

  // ---------- geometry ----------
  timeToX(tm) { return tm * this.pps; }
  xToTime(x) { return Math.max(0, x / this.pps); }
  contentWidth() {
    const dur = this.store.projectDuration();
    return Math.max(this.els.body.clientWidth - HEADER_W, this.timeToX(dur) + 600);
  }
  /** Timeline time from a client X coordinate. */
  timeFromClientX(cx) {
    const r = this.els.lanes.getBoundingClientRect();
    return this.xToTime(cx - r.left);
  }
  trackFromClientY(cy) {
    for (const [id, lane] of this.laneEls) {
      const r = lane.getBoundingClientRect();
      if (cy >= r.top && cy < r.bottom) return this.store.getTrack(id);
    }
    return null;
  }
  setZoomSlider(v) { // 0..100 → log scale
    this.pps = PPS_MIN * Math.pow(PPS_MAX / PPS_MIN, clamp(v, 0, 100) / 100);
    this.render();
  }
  zoomSliderValue() { return 100 * Math.log(this.pps / PPS_MIN) / Math.log(PPS_MAX / PPS_MIN); }
  zoomBy(f, anchorTime) {
    const old = this.pps;
    this.pps = clamp(this.pps * f, PPS_MIN, PPS_MAX);
    if (anchorTime != null) {
      const body = this.els.body;
      body.scrollLeft += this.timeToX(anchorTime) - anchorTime * old;
    }
    this.render();
    this.hooks.onZoom && this.hooks.onZoom(this.zoomSliderValue());
  }
  zoomFit() {
    const dur = this.store.projectDuration() || 10;
    this.pps = clamp((this.els.body.clientWidth - HEADER_W - 60) / dur, PPS_MIN, PPS_MAX);
    this.els.body.scrollLeft = 0;
    this.render();
    this.hooks.onZoom && this.hooks.onZoom(this.zoomSliderValue());
  }

  // ---------- rendering ----------
  render() {
    const { store, els } = this;
    const width = this.contentWidth();
    els.lanesInner.style.width = width + 'px';
    els.rulerWrap.style.width = width + 'px';
    // tracks
    const seenT = new Set();
    store.project.tracks.forEach((tr, i) => {
      seenT.add(tr.id);
      let h = this.headerEls.get(tr.id), lane = this.laneEls.get(tr.id);
      if (!h) { h = this._makeHeader(tr); this.headerEls.set(tr.id, h); }
      if (!lane) { lane = this._makeLane(tr); this.laneEls.set(tr.id, lane); }
      this._updateHeader(h, tr);
      lane.className = `lane ${tr.kind}${tr.locked ? ' locked' : ''}`;
      if (els.headers.children[i] !== h) els.headers.insertBefore(h, els.headers.children[i] || null);
      if (els.lanesInner.children[i] !== lane) els.lanesInner.insertBefore(lane, els.lanesInner.children[i] || null);
    });
    for (const [id, h] of this.headerEls) if (!seenT.has(id)) { h.remove(); this.headerEls.delete(id); }
    for (const [id, l] of this.laneEls) if (!seenT.has(id)) { l.remove(); this.laneEls.delete(id); }
    // clips
    const seenC = new Set();
    for (const c of store.project.clips) {
      seenC.add(c.id);
      const lane = this.laneEls.get(c.trackId); if (!lane) continue;
      let el = this.clipEls.get(c.id);
      if (!el) { el = this._makeClipEl(c); this.clipEls.set(c.id, el); }
      if (el.parentElement !== lane) lane.appendChild(el);
      this._updateClipEl(el, c);
    }
    for (const [id, el] of this.clipEls) if (!seenC.has(id)) { el.remove(); this.clipEls.delete(id); }
    this._applySelection();
    this._drawRuler();
    this._positionPlayhead(this.player.currentTime, false);
  }

  _makeHeader(tr) {
    const h = document.createElement('div');
    h.innerHTML = `<div class="th-name"><span></span></div><div class="th-btns">
      <button data-act="muted" class="mute" title="Mute">M</button>
      <button data-act="solo" class="solo" title="Solo">S</button>
      <button data-act="locked" title="Lock">🔒</button>
      <button data-act="hidden" title="Hide" ${tr.kind === 'audio' ? 'hidden' : ''}>👁</button></div>`;
    h.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (b) { const act = b.dataset.act; this.store.updateTrack(tr.id, { [act]: !this.store.getTrack(tr.id)[act] }); return; }
      this.store.selectTrack(tr.id);
    });
    h.querySelector('.th-name').addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const span = h.querySelector('.th-name span');
      const input = document.createElement('input'); input.value = this.store.getTrack(tr.id).name;
      span.replaceWith(input); input.focus(); input.select();
      const done = () => { const v = input.value.trim(); if (v) this.store.updateTrack(tr.id, { name: v }); this.render(); };
      input.addEventListener('blur', done);
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); if (ev.key === 'Escape') { input.value = this.store.getTrack(tr.id).name; input.blur(); } ev.stopPropagation(); });
    });
    return h;
  }
  _updateHeader(h, tr) {
    h.className = `track-header ${tr.kind}${this.store.selection.trackId === tr.id ? ' selected' : ''}`;
    const span = h.querySelector('.th-name span'); if (span) span.textContent = tr.name;
    for (const b of h.querySelectorAll('button')) b.classList.toggle('on', !!tr[b.dataset.act]);
  }
  _makeLane(tr) {
    const lane = document.createElement('div');
    lane.dataset.trackId = tr.id;
    lane.addEventListener('pointerdown', (e) => {
      if (e.target !== lane || e.button !== 0) return;
      this.store.clearSelection();
      this._scrubStart(e);
    });
    lane.addEventListener('dragover', (e) => {
      const kind = this._dragKind(e);
      if (!kind) return;
      e.preventDefault();
      const track = this.store.getTrack(tr.id);
      const ok = kind === 'files' || (this.store.canPlaceKind(kind, track.kind) && !track.locked);
      lane.classList.toggle('drop-ok', ok); lane.classList.toggle('drop-bad', !ok);
      e.dataTransfer.dropEffect = ok ? 'copy' : 'none';
    });
    lane.addEventListener('dragleave', () => lane.classList.remove('drop-ok', 'drop-bad'));
    lane.addEventListener('drop', (e) => {
      lane.classList.remove('drop-ok', 'drop-bad');
      const time = this.timeFromClientX(e.clientX);
      const mediaId = e.dataTransfer.getData('application/x-veditor-media');
      if (mediaId) { e.preventDefault(); this.hooks.onDropMedia && this.hooks.onDropMedia(mediaId, tr.id, this.snap ? this._snapTime(time, []) : time); return; }
      if (e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); this.hooks.onDropFiles && this.hooks.onDropFiles([...e.dataTransfer.files], tr.id, time); }
    });
    return lane;
  }
  _dragKind(e) {
    const types = [...(e.dataTransfer?.types || [])];
    if (types.includes('application/x-veditor-media')) return this._dragMediaKind || 'video';
    if (types.includes('Files')) return 'files';
    return null;
  }
  setDraggingMediaKind(kind) { this._dragMediaKind = kind; }

  _makeClipEl(c) {
    const el = document.createElement('div');
    el.dataset.clipId = c.id;
    el.innerHTML = `<div class="thumbs"></div><canvas class="wave"></canvas><div class="fade in"></div><div class="fade out"></div><div class="clip-label"></div><div class="handle l"></div><div class="handle r"></div>`;
    el.addEventListener('pointerdown', (e) => this._clipPointerDown(e, c.id));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (!this.store.selection.clipIds.has(c.id)) this.store.selectClips([c.id]);
      this.hooks.onClipContextMenu && this.hooks.onClipContextMenu(c.id, e.clientX, e.clientY);
    });
    return el;
  }
  _updateClipEl(el, c) {
    const m = this.store.media.get(c.mediaId);
    const track = this.store.getTrack(c.trackId);
    const kind = m ? m.kind : 'video';
    const visualKind = track && track.kind === 'audio' ? 'audio' : kind;
    el.className = `clip ${visualKind}${c.muted ? ' muted' : ''}`;
    el.style.left = this.timeToX(c.start) + 'px';
    el.style.width = Math.max(2, this.timeToX(c.duration)) + 'px';
    el.querySelector('.clip-label').textContent = c.name || (m ? m.name : '?');
    el.querySelector('.fade.in').style.width = this.timeToX(c.fadeIn) + 'px';
    el.querySelector('.fade.out').style.width = this.timeToX(c.fadeOut) + 'px';
    this._renderClipContent(el, c, m, track);
  }
  _renderClipContent(el, c, m, track) {
    if (!m || !track) return;
    const w = Math.max(2, this.timeToX(c.duration));
    const thumbsEl = el.querySelector('.thumbs'), wave = el.querySelector('.wave');
    const showThumbs = track.kind === 'video' && (m.kind === 'video' || m.kind === 'image');
    const showWave = !!m.peaks && (track.kind === 'audio' || m.kind === 'audio');
    thumbsEl.hidden = !showThumbs; wave.hidden = !showWave;
    if (showThumbs) {
      const key = `${Math.round(w)}|${c.offset.toFixed(3)}|${m.thumbnails.length}|${m.kind}`;
      if (thumbsEl.dataset.key !== key) {
        thumbsEl.dataset.key = key;
        thumbsEl.innerHTML = '';
        const h = LANE_H.video - 10;
        const tw = Math.max(24, Math.round(h * ((m.width / m.height) || 16 / 9)));
        const count = Math.min(400, Math.ceil(w / tw));
        for (let i = 0; i < count; i++) {
          const img = document.createElement('img');
          img.style.width = tw + 'px';
          img.draggable = false;
          if (m.kind === 'image') img.src = m.url;
          else if (m.thumbnails.length) {
            const st = c.offset + (i * tw) / this.pps;
            let best = m.thumbnails[0];
            for (const th of m.thumbnails) if (Math.abs(th.time - st) < Math.abs(best.time - st)) best = th;
            img.src = best.url;
          }
          thumbsEl.appendChild(img);
        }
      }
    }
    if (showWave) {
      const key = `${Math.round(w)}|${c.offset.toFixed(3)}|${c.duration.toFixed(3)}`;
      if (wave.dataset.key !== key) { wave.dataset.key = key; this._drawWave(wave, c, m, w, LANE_H[track.kind] - 10); }
    }
  }
  _drawWave(canvas, c, m, w, h) {
    const cw = Math.min(4000, Math.ceil(w));
    canvas.width = cw; canvas.height = h;
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, cw, h);
    const peaks = m.peaks; if (!peaks) return;
    const i0 = c.offset * PEAKS_PER_SECOND;
    const perPx = (c.duration * PEAKS_PER_SECOND) / cw;
    g.fillStyle = 'rgba(255,255,255,.75)';
    const mid = h / 2;
    for (let x = 0; x < cw; x++) {
      const a = Math.floor(i0 + x * perPx), b = Math.max(a + 1, Math.floor(i0 + (x + 1) * perPx));
      let p = 0;
      for (let i = a; i < b && i < peaks.length; i++) if (peaks[i] > p) p = peaks[i];
      const bh = Math.max(1, p * (h - 4));
      g.fillRect(x, mid - bh / 2, 1, bh);
    }
  }
  _refreshClipContents() {
    for (const [id, el] of this.clipEls) { const c = this.store.getClip(id); if (c) this._updateClipEl(el, c); }
  }
  _applySelection() {
    for (const [id, el] of this.clipEls) el.classList.toggle('selected', this.store.selection.clipIds.has(id));
    for (const [id, h] of this.headerEls) h.classList.toggle('selected', this.store.selection.trackId === id);
  }

  _drawRuler() {
    const canvas = this.els.ruler, width = this.contentWidth(), h = 28;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr; canvas.height = h * dpr; canvas.style.width = width + 'px';
    const g = canvas.getContext('2d'); g.scale(dpr, dpr);
    g.clearRect(0, 0, width, h);
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    const step = steps.find((s) => s * this.pps >= 70) || 3600;
    const subdiv = step >= 60 ? 6 : step >= 1 ? 5 : 2;
    const sub = step / subdiv;
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.fillStyle = '#9a9aa1'; g.font = '11px sans-serif'; g.textBaseline = 'top';
    const total = width / this.pps;
    g.beginPath();
    for (let i = 0; i * sub <= total; i++) {
      const tm = Math.round(i * sub * 1000) / 1000; // integer stepping avoids floating-point drift
      const x = Math.round(this.timeToX(tm)) + 0.5;
      const major = i % subdiv === 0;
      g.moveTo(x, major ? h - 12 : h - 5); g.lineTo(x, h);
      if (major) g.fillText(step < 1 ? tm.toFixed(1) + 's' : formatDurationShort(tm), x + 3, 4);
    }
    g.stroke();
    // project end marker
    const end = this.store.projectDuration();
    if (end > 0) { const x = Math.round(this.timeToX(end)) + 0.5; g.strokeStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  }
  _positionPlayhead(tm, autoScroll) {
    const { body, playhead } = this.els;
    const x = HEADER_W + this.timeToX(tm);
    playhead.style.left = x + 'px';
    playhead.style.height = Math.max(body.scrollHeight, body.clientHeight) + 'px';
    if (autoScroll && this.player.playing) {
      const visL = body.scrollLeft + HEADER_W, visR = body.scrollLeft + body.clientWidth;
      if (x > visR - 20 || x < visL) body.scrollLeft = Math.max(0, x - HEADER_W - 40);
    }
  }

  // ---------- interactions ----------
  _bind() {
    const { rulerWrap, body } = this.els;
    rulerWrap.addEventListener('pointerdown', (e) => { if (e.button === 0) this._scrubStart(e); });
    body.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const anchor = this.timeFromClientX(e.clientX);
        this.zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, anchor);
      } else if (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(e.deltaX) && body.scrollHeight <= body.clientHeight + 1) {
        body.scrollLeft += e.deltaY; e.preventDefault();
      }
    }, { passive: false });
  }
  _scrubStart(e) {
    const target = e.currentTarget;
    const move = (ev) => { this.player.seek(this.timeFromClientX(ev.clientX)); };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); };
    target.setPointerCapture(e.pointerId);
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
    if (this.player.playing) this.player.pause();
    move(e);
  }

  _snapPoints(excludeIds) {
    const pts = [0, this.player.currentTime];
    for (const c of this.store.project.clips) if (!excludeIds.includes(c.id)) pts.push(c.start, c.start + c.duration);
    return pts;
  }
  _snapTime(tm, excludeIds) {
    if (!this.snap) return tm;
    const thr = SNAP_PX / this.pps;
    let best = tm, bd = thr;
    for (const p of this._snapPoints(excludeIds)) { const d = Math.abs(p - tm); if (d < bd) { bd = d; best = p; } }
    return best;
  }
  _showSnapLine(tm) {
    let line = this._snapLine;
    if (tm == null) { if (line) line.hidden = true; return; }
    if (!line) { line = document.createElement('div'); line.className = 'snap-line'; this.els.lanesInner.appendChild(line); this._snapLine = line; }
    line.hidden = false; line.style.left = this.timeToX(tm) + 'px';
  }

  _clipPointerDown(e, clipId) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const store = this.store;
    const clip = store.getClip(clipId); if (!clip) return;
    const track = store.getTrack(clip.trackId);
    if (e.ctrlKey || e.metaKey) { store.toggleClip(clipId); return; }
    if (!store.selection.clipIds.has(clipId)) store.selectClips([clipId]);
    if (track.locked) { this.hooks.onMessage && this.hooks.onMessage(t('track.locked')); return; }
    const el = this.clipEls.get(clipId);
    const mode = e.target.classList.contains('handle') ? (e.target.classList.contains('l') ? 'trimL' : 'trimR') : 'move';
    const drag = {
      mode, clipId, startX: e.clientX, startY: e.clientY, moved: false,
      orig: { ...clip }, snapshot: store.snapshot(),
      maxDur: store.maxClipDuration(clip),
    };
    this._drag = drag;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev) => this._dragMove(ev, drag, el);
    const onUp = (ev) => {
      el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp);
      el.classList.remove('dragging');
      this._showSnapLine(null);
      this._drag = null;
      if (drag.moved) { store.pushHistory(drag.snapshot); store.changed('drag'); }
    };
    el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
  }
  _dragMove(ev, drag, el) {
    const store = this.store;
    const clip = store.getClip(drag.clipId); if (!clip) return;
    const dx = ev.clientX - drag.startX;
    if (!drag.moved && Math.abs(dx) < 3 && Math.abs(ev.clientY - drag.startY) < 3) return;
    drag.moved = true;
    el.classList.add('dragging');
    const dt = dx / this.pps;
    const o = drag.orig;
    const thr = SNAP_PX / this.pps;
    let snapAt = null;
    if (drag.mode === 'move') {
      let start = Math.max(0, o.start + dt);
      if (this.snap) {
        const pts = this._snapPoints([clip.id]);
        let bd = thr;
        for (const p of pts) {
          const d1 = Math.abs(p - start), d2 = Math.abs(p - (start + o.duration));
          if (d1 < bd) { bd = d1; start = p; snapAt = p; }
          if (d2 < bd) { bd = d2; start = p - o.duration; snapAt = p; }
        }
        start = Math.max(0, start);
      }
      const media = store.media.get(clip.mediaId);
      let target = this.trackFromClientY(ev.clientY);
      if (!target || target.locked || !media || !store.canPlaceKind(media.kind, target.kind)) target = store.getTrack(o.trackId);
      let pos = store.findPlacement(target.id, start, o.duration, [clip.id]);
      if (target.id !== o.trackId && (pos == null || Math.abs(pos - start) > Math.max(0.5, o.duration))) {
        target = store.getTrack(o.trackId);
        pos = store.findPlacement(target.id, start, o.duration, [clip.id]);
      }
      if (pos == null) return;
      if (Math.abs(pos - start) > 1e-6) snapAt = null;
      clip.trackId = target.id; clip.start = pos;
      const lane = this.laneEls.get(target.id);
      if (el.parentElement !== lane) lane.appendChild(el);
    } else if (drag.mode === 'trimL') {
      const end = o.start + o.duration;
      let start = o.start + dt;
      if (this.snap) { const s = this._snapTime(start, [clip.id]); if (s !== start) { start = s; snapAt = s; } }
      const gap = store.gapAt(o.trackId, o.start, [clip.id]) || { lo: 0 };
      const minStart = Math.max(gap.lo, 0, o.start - o.offset);
      start = clamp(start, minStart, end - MIN_CLIP);
      if (Math.abs(start - (snapAt ?? start)) > 1e-6) snapAt = null;
      clip.start = start; clip.offset = o.offset + (start - o.start); clip.duration = end - start;
    } else {
      let end = o.start + o.duration + dt;
      if (this.snap) { const s = this._snapTime(end, [clip.id]); if (s !== end) { end = s; snapAt = s; } }
      const gap = store.gapAt(o.trackId, o.start, [clip.id]) || { hi: Infinity };
      const maxEnd = Math.min(gap.hi, o.start + drag.maxDur);
      end = clamp(end, o.start + MIN_CLIP, maxEnd);
      if (Math.abs(end - (snapAt ?? end)) > 1e-6) snapAt = null;
      clip.duration = end - o.start;
    }
    this._showSnapLine(snapAt);
    this._updateClipEl(el, clip);
    this._drawRuler();
    this.els.lanesInner.style.width = this.contentWidth() + 'px';
    this.els.rulerWrap.style.width = this.contentWidth() + 'px';
    this.hooks.onClipLiveChange && this.hooks.onClipLiveChange(clip);
  }
}
export { HEADER_W, LANE_H };
