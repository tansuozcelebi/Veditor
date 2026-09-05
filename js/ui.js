// ===================== UI: library, inspector, dialogs, toasts, context menu =====================
import { t, applyStatic } from './i18n.js';
import { RESOLUTIONS, TRANSITION_TYPES, FONT_FAMILIES, formatTime, formatDurationShort, formatBytes, clamp } from './state.js';
import { supportedFormats } from './exporter.js';
import { importFiles } from './media.js';

// ---------- toasts ----------
export function toast(msg, type = 'info', ms = 3200) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, ms);
  return el;
}

// ---------- modal ----------
export function openModal({ title, body, footer = [], onClose, closable = true }) {
  const root = document.getElementById('modalRoot');
  const bd = document.createElement('div'); bd.className = 'modal-backdrop';
  const modal = document.createElement('div'); modal.className = 'modal';
  const head = document.createElement('div'); head.className = 'modal-head';
  head.innerHTML = `<h3></h3>`; head.querySelector('h3').textContent = title;
  if (closable) { const x = document.createElement('button'); x.className = 'icon-btn'; x.textContent = '✕'; x.onclick = () => api.close(); head.appendChild(x); }
  const bodyEl = document.createElement('div'); bodyEl.className = 'modal-body';
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  const foot = document.createElement('div'); foot.className = 'modal-foot';
  modal.append(head, bodyEl, foot); bd.appendChild(modal); root.appendChild(bd);
  const api = {
    el: modal, body: bodyEl, foot,
    close() { if (!bd.isConnected) return; bd.remove(); onClose && onClose(); },
    setFooter(buttons) {
      foot.innerHTML = '';
      for (const b of buttons) {
        const btn = document.createElement('button'); btn.className = 'btn ' + (b.cls || ''); btn.textContent = b.label;
        btn.onclick = () => b.onClick(api); if (b.disabled) btn.disabled = true; foot.appendChild(btn); b.el = btn;
      }
    },
  };
  api.setFooter(footer);
  const esc = (e) => { if (e.key === 'Escape' && closable) { api.close(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);
  applyStatic(modal);
  return api;
}
export function confirmDialog(message, { title = t('common.confirm'), danger = false } = {}) {
  return new Promise((res) => {
    const m = openModal({
      title, body: `<p>${escapeHtml(message)}</p>`,
      footer: [
        { label: t('common.cancel'), cls: 'ghost', onClick: (api) => { api.close(); res(false); } },
        { label: t('common.yes'), cls: danger ? 'danger' : 'primary', onClick: (api) => { api.close(); res(true); } },
      ],
      onClose: () => res(false),
    });
    m.foot.lastChild.focus();
  });
}
export function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------- context menu ----------
export function showContextMenu(items, x, y) {
  const el = document.getElementById('contextMenu');
  el.innerHTML = '';
  for (const it of items) {
    if (it === '-') { el.appendChild(document.createElement('hr')); continue; }
    const b = document.createElement('button'); b.textContent = it.label; if (it.danger) b.className = 'danger';
    b.onclick = () => { hide(); it.onClick(); };
    el.appendChild(b);
  }
  el.hidden = false;
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + 'px';
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + 'px';
  const hide = () => { el.hidden = true; document.removeEventListener('pointerdown', onDoc, true); document.removeEventListener('keydown', onKey); };
  const onDoc = (e) => { if (!el.contains(e.target)) hide(); };
  const onKey = (e) => { if (e.key === 'Escape') hide(); };
  setTimeout(() => { document.addEventListener('pointerdown', onDoc, true); document.addEventListener('keydown', onKey); });
}

// ---------- library ----------
export class Library {
  constructor(store, els, hooks) {
    this.store = store; this.els = els; this.hooks = hooks;
    this.selectedId = null;
    store.on('media', () => this.render());
    els.importBtn.onclick = () => els.fileInput.click();
    els.fileInput.onchange = () => { this.importFiles([...els.fileInput.files]); els.fileInput.value = ''; };
    const dz = els.drop;
    dz.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); dz.classList.add('drag-over'); } });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', (e) => { dz.classList.remove('drag-over'); if (e.dataTransfer.files.length) { e.preventDefault(); this.importFiles([...e.dataTransfer.files]); } });
    this.render();
  }
  async importFiles(files) {
    if (!files.length) return [];
    const added = await importFiles(this.store, files, {
      onError: (file, e) => toast(t(e.message === 'unsupported' ? 'library.unsupported' : 'library.loadError', { name: file.name }), 'error'),
    });
    if (added.length) toast(t('library.imported', { n: added.length }), 'success');
    return added;
  }
  select(id) { this.selectedId = id; this.render(); const el = this.els.list.querySelector(`[data-id="${id}"]`); el && el.scrollIntoView({ block: 'nearest' }); }
  render() {
    const { list, empty } = this.els;
    const items = [...this.store.media.values()];
    empty.hidden = items.length > 0;
    list.innerHTML = '';
    for (const m of items) {
      const card = document.createElement('div');
      card.className = 'media-card' + (m.id === this.selectedId ? ' selected' : '');
      card.dataset.id = m.id; card.draggable = true;
      const thumb = document.createElement('div'); thumb.className = `thumb ${m.kind}`;
      if (m.poster) thumb.style.backgroundImage = `url("${m.poster}")`; else thumb.textContent = m.kind === 'audio' ? '🎵' : '🎬';
      const badge = document.createElement('span'); badge.className = `badge ${m.kind}`; badge.textContent = t('kind.' + m.kind);
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.innerHTML = `<div class="name"></div><div class="sub"><span>${formatDurationShort(m.duration)}</span><span>${m.width ? m.width + '×' + m.height : formatBytes(m.size)}</span></div>`;
      meta.querySelector('.name').textContent = m.name; meta.querySelector('.name').title = m.name;
      const actions = document.createElement('div'); actions.className = 'actions';
      const add = document.createElement('button'); add.textContent = '＋'; add.title = t('library.addToTimeline');
      add.onclick = (e) => { e.stopPropagation(); this.hooks.onAdd(m.id); };
      const del = document.createElement('button'); del.textContent = '✕'; del.title = t('library.remove');
      del.onclick = async (e) => { e.stopPropagation(); if (await confirmDialog(t('library.removeConfirm'), { danger: true })) this.store.removeMedia(m.id); };
      actions.append(add, del);
      card.append(thumb, badge, meta, actions);
      if (m.analyzing) { const l = document.createElement('div'); l.className = 'loading'; l.textContent = t('library.analyzing'); card.appendChild(l); }
      card.addEventListener('click', () => { this.selectedId = m.id; this.render(); });
      card.addEventListener('dblclick', () => this.hooks.onAdd(m.id));
      card.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('application/x-veditor-media', m.id);
        e.dataTransfer.effectAllowed = 'copy';
        this.hooks.onDragStart && this.hooks.onDragStart(m);
      });
      list.appendChild(card);
    }
  }
}

// ---------- inspector ----------
export class Inspector {
  constructor(store, player, els, hooks) {
    this.store = store; this.player = player; this.els = els; this.hooks = hooks;
    store.on('selection', () => this.render());
    store.on('change', () => this.render());
    store.on('media', () => this.render());
    this.render();
  }
  render() {
    const { store } = this;
    const body = this.els.body;
    const clips = store.selectedClips();
    if (document.activeElement && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'range') return; // don't clobber while typing
    body.innerHTML = '';
    if (clips.length === 1) { this.els.title.textContent = t('inspector.clip'); this._renderClip(clips[0], body); }
    else if (clips.length > 1) { this.els.title.textContent = t('inspector.clip'); body.innerHTML = `<p class="hint">${t('inspector.clipCount', { n: clips.length })}</p>`; this._renderActions(body, clips); }
    else if (store.selection.trackId) { this.els.title.textContent = t('inspector.track'); this._renderTrack(store.getTrack(store.selection.trackId), body); }
    else { this.els.title.textContent = t('inspector.project'); this._renderProject(body); }
  }
  _field(label, inputEl, { unit } = {}) {
    const f = document.createElement('div'); f.className = 'field';
    const l = document.createElement('label'); l.textContent = label; f.appendChild(l);
    if (inputEl.type === 'range') {
      const row = document.createElement('div'); row.className = 'row';
      const val = document.createElement('span'); val.className = 'val';
      const upd = () => { val.textContent = unit === '%' ? Math.round(inputEl.value * 100) + '%' : unit === 'pct' ? Number(inputEl.value).toFixed(1) + '%' : Number(inputEl.value).toFixed(2) + (unit || ''); };
      inputEl.addEventListener('input', upd); upd();
      row.append(inputEl, val); f.appendChild(row);
    } else f.appendChild(inputEl);
    return f;
  }
  _num(value, { min, max, step = 0.01, onChange }) {
    const i = document.createElement('input'); i.type = 'number'; i.value = Number(value).toFixed(3).replace(/\.?0+$/, ''); if (min != null) i.min = min; if (max != null) i.max = max; i.step = step;
    i.addEventListener('change', () => { let v = parseFloat(i.value); if (isNaN(v)) return; if (min != null) v = Math.max(min, v); if (max != null && isFinite(max)) v = Math.min(max, v); onChange(v); });
    return i;
  }
  _range(value, { min, max, step, onInput, onCommit }) {
    const i = document.createElement('input'); i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = value;
    let snap = null;
    i.addEventListener('pointerdown', () => { snap = this.store.snapshot(); });
    i.addEventListener('input', () => onInput(parseFloat(i.value)));
    i.addEventListener('change', () => { if (snap) { this.store.pushHistory(snap); snap = null; } onCommit ? onCommit(parseFloat(i.value)) : this.store.changed('inspector'); });
    return i;
  }
  _section(body, title) { const s = document.createElement('div'); s.className = 'section-title'; s.textContent = title; body.appendChild(s); }

  _select(value, options, onChange) {
    const sel = document.createElement('select');
    for (const [v, label] of options) { const o = document.createElement('option'); o.value = v; o.textContent = label; if (String(value) === String(v)) o.selected = true; sel.appendChild(o); }
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  _toggle(label, on, onClick) { const b = document.createElement('button'); b.className = 'btn small' + (on ? ' on' : ''); b.textContent = label; b.onclick = onClick; return b; }

  _renderClip(c, body) {
    const { store } = this;
    const m = store.media.get(c.mediaId); const track = store.getTrack(c.trackId);
    const isText = c.kind === 'text';
    const upd = (patch, { silent = false } = {}) => store.updateClip(c.id, patch, { silent, history: !silent });
    if (isText) {
      this._section(body, t('text.section'));
      const ta = document.createElement('textarea'); ta.value = c.text || '';
      ta.addEventListener('change', () => upd({ text: ta.value, name: ta.value.split('\n')[0] }));
      body.appendChild(this._field(t('text.content'), ta));
      body.appendChild(this._field(t('text.font'), this._select(c.fontFamily, FONT_FAMILIES.map((f) => [f, f]), (v) => upd({ fontFamily: v }))));
      body.appendChild(this._field(t('text.size'), this._range(c.fontSize, { min: 1, max: 40, step: 0.5, onInput: (v) => upd({ fontSize: v }, { silent: true }) }), { unit: 'pct' }));
      const cg = document.createElement('div'); cg.className = 'field-grid';
      const col = document.createElement('input'); col.type = 'color'; col.value = c.color; col.addEventListener('change', () => upd({ color: col.value }));
      cg.appendChild(this._field(t('text.color'), col));
      cg.appendChild(this._field(t('text.align'), this._select(c.align, [['left', t('text.alignLeft')], ['center', t('text.alignCenter')], ['right', t('text.alignRight')]], (v) => upd({ align: v }))));
      body.appendChild(cg);
      const row = document.createElement('div'); row.className = 'toggle-row';
      row.appendChild(this._toggle('B ' + t('text.bold'), c.bold, () => upd({ bold: !c.bold })));
      row.appendChild(this._toggle('I ' + t('text.italic'), c.italic, () => upd({ italic: !c.italic })));
      row.appendChild(this._toggle('▦ ' + t('text.bg'), c.bgEnabled, () => upd({ bgEnabled: !c.bgEnabled })));
      row.appendChild(this._toggle('◗ ' + t('text.shadow'), c.shadow, () => upd({ shadow: !c.shadow })));
      body.appendChild(row);
      const bg = document.createElement('div'); bg.className = 'field-grid';
      const bgc = document.createElement('input'); bgc.type = 'color'; bgc.value = c.bgColor; bgc.addEventListener('change', () => upd({ bgColor: bgc.value }));
      bg.appendChild(this._field(t('text.bgColor'), bgc));
      bg.appendChild(this._field(t('text.bgOpacity'), this._range(c.bgOpacity, { min: 0, max: 1, step: 0.01, onInput: (v) => upd({ bgOpacity: v }, { silent: true }) }), { unit: '%' }));
      body.appendChild(bg);
      const og = document.createElement('div'); og.className = 'field-grid';
      const oc = document.createElement('input'); oc.type = 'color'; oc.value = c.outlineColor; oc.addEventListener('change', () => upd({ outlineColor: oc.value }));
      og.appendChild(this._field(t('text.outlineColor'), oc));
      og.appendChild(this._field(t('text.outline'), this._range(c.outlineWidth, { min: 0, max: 20, step: 0.5, onInput: (v) => upd({ outlineWidth: v }, { silent: true }) }), { unit: 'pct' }));
      body.appendChild(og);
      body.appendChild(this._field(t('text.lineHeight'), this._range(c.lineHeight, { min: 0.8, max: 2.5, step: 0.05, onInput: (v) => upd({ lineHeight: v }, { silent: true }) }), { unit: '×' }));
    } else {
      // name
      const name = document.createElement('input'); name.type = 'text'; name.value = c.name || (m ? m.name : '');
      name.addEventListener('change', () => upd({ name: name.value }));
      body.appendChild(this._field(t('inspector.name'), name));
      const info = document.createElement('p'); info.className = 'hint';
      info.textContent = `${t('inspector.media')}: ${m ? m.name : '?'} · ${t('inspector.track')}: ${track ? track.name : '?'}`;
      body.appendChild(info);
    }
    // timing
    this._section(body, t('inspector.timingSection'));
    const grid = document.createElement('div'); grid.className = 'field-grid';
    grid.appendChild(this._field(t('inspector.start'), this._num(c.start, { min: 0, onChange: (v) => { const pos = store.findPlacement(c.trackId, v, c.duration, [c.id]); if (pos != null) upd({ start: pos }); } })));
    grid.appendChild(this._field(t('inspector.duration'), this._num(c.duration, { min: 0.05, max: store.maxClipDuration(c), onChange: (v) => { const gap = store.gapAt(c.trackId, c.start, [c.id]); const maxD = Math.min(store.maxClipDuration(c), gap ? gap.hi - c.start : Infinity); upd({ duration: clamp(v, 0.05, maxD) }); } })));
    if (m && m.kind !== 'image') grid.appendChild(this._field(t('inspector.offset'), this._num(c.offset, { min: 0, max: Math.max(0, m.duration - 0.05), onChange: (v) => { const off = clamp(v, 0, m.duration - 0.05); upd({ offset: off, duration: Math.min(c.duration, m.duration - off) }); } })));
    body.appendChild(grid);
    // audio
    if (m && m.kind !== 'image') {
      this._section(body, t('inspector.audioSection'));
      body.appendChild(this._field(t('inspector.volume'), this._range(c.volume, { min: 0, max: 2, step: 0.01, onInput: (v) => upd({ volume: v }, { silent: true }) }), { unit: '%' }));
      const row = document.createElement('div'); row.className = 'toggle-row';
      const mute = document.createElement('button'); mute.className = 'btn small' + (c.muted ? ' on' : ''); mute.textContent = '🔇 ' + t('inspector.muted');
      mute.onclick = () => upd({ muted: !c.muted }); row.appendChild(mute); body.appendChild(row);
      const fg = document.createElement('div'); fg.className = 'field-grid';
      fg.appendChild(this._field(t('inspector.fadeIn'), this._num(c.fadeIn, { min: 0, max: c.duration, step: 0.1, onChange: (v) => upd({ fadeIn: clamp(v, 0, c.duration) }) })));
      fg.appendChild(this._field(t('inspector.fadeOut'), this._num(c.fadeOut, { min: 0, max: c.duration, step: 0.1, onChange: (v) => upd({ fadeOut: clamp(v, 0, c.duration) }) })));
      body.appendChild(fg);
    }
    // video
    if (track && track.kind === 'video') {
      this._section(body, t('inspector.videoSection'));
      body.appendChild(this._field(t('inspector.opacity'), this._range(c.opacity, { min: 0, max: 1, step: 0.01, onInput: (v) => upd({ opacity: v }, { silent: true }) }), { unit: '%' }));
      const fit = document.createElement('select');
      for (const [v, k] of [['contain', 'inspector.fitContain'], ['cover', 'inspector.fitCover'], ['stretch', 'inspector.fitStretch']]) { const o = document.createElement('option'); o.value = v; o.textContent = t(k); if (c.fit === v) o.selected = true; fit.appendChild(o); }
      fit.addEventListener('change', () => upd({ fit: fit.value }));
      body.appendChild(this._field(t('inspector.fit'), fit));
      body.appendChild(this._field(t('inspector.scale'), this._range(c.scale, { min: 0.05, max: 3, step: 0.01, onInput: (v) => upd({ scale: v }, { silent: true }) }), { unit: '×' }));
      const pg = document.createElement('div'); pg.className = 'field-grid';
      pg.appendChild(this._field(t('inspector.posX'), this._range(c.x, { min: -100, max: 100, step: 0.5, onInput: (v) => upd({ x: v }, { silent: true }) }), { unit: '%' }));
      pg.appendChild(this._field(t('inspector.posY'), this._range(c.y, { min: -100, max: 100, step: 0.5, onInput: (v) => upd({ y: v }, { silent: true }) }), { unit: '%' }));
      body.appendChild(pg);
      // layout presets (PiP etc.)
      const presets = [
        ['inspector.presetFull', { scale: 1, x: 0, y: 0 }],
        ['inspector.presetPipTL', { scale: 0.33, x: -32, y: -32 }], ['inspector.presetPipTR', { scale: 0.33, x: 32, y: -32 }],
        ['inspector.presetPipBL', { scale: 0.33, x: -32, y: 32 }], ['inspector.presetPipBR', { scale: 0.33, x: 32, y: 32 }],
        ['inspector.presetLeft', { scale: 0.5, x: -25, y: 0 }], ['inspector.presetRight', { scale: 0.5, x: 25, y: 0 }],
      ];
      const pr = document.createElement('div'); pr.className = 'field';
      pr.innerHTML = `<label>${t('inspector.layoutPresets')}</label>`;
      const row = document.createElement('div'); row.className = 'toggle-row';
      for (const [k, p] of presets) { const b = document.createElement('button'); b.className = 'btn small'; b.textContent = t(k); b.onclick = () => upd({ ...p, fit: 'contain' }); row.appendChild(b); }
      pr.appendChild(row); body.appendChild(pr);
      // transitions
      this._section(body, t('trans.section'));
      const types = TRANSITION_TYPES.map((k) => [k, t('trans.' + k)]);
      const tg = document.createElement('div'); tg.className = 'field-grid';
      tg.appendChild(this._field(t('trans.in'), this._select(c.transIn.type, types, (v) => upd({ transIn: { ...c.transIn, type: v } }))));
      tg.appendChild(this._field(t('trans.duration'), this._num(c.transIn.duration, { min: 0.1, max: Math.max(0.1, c.duration), step: 0.1, onChange: (v) => upd({ transIn: { ...c.transIn, duration: clamp(v, 0.1, c.duration) } }) })));
      tg.appendChild(this._field(t('trans.out'), this._select(c.transOut.type, types, (v) => upd({ transOut: { ...c.transOut, type: v } }))));
      tg.appendChild(this._field(t('trans.duration'), this._num(c.transOut.duration, { min: 0.1, max: Math.max(0.1, c.duration), step: 0.1, onChange: (v) => upd({ transOut: { ...c.transOut, duration: clamp(v, 0.1, c.duration) } }) })));
      body.appendChild(tg);
      const th = document.createElement('p'); th.className = 'hint'; th.textContent = t('trans.hint'); body.appendChild(th);
    }
    this._renderActions(body, [c]);
  }
  _renderActions(body, clips) {
    const row = document.createElement('div'); row.className = 'inspector-actions';
    const mk = (label, cls, fn) => { const b = document.createElement('button'); b.className = 'btn small ' + cls; b.textContent = label; b.onclick = fn; row.appendChild(b); };
    if (clips.length === 1) {
      mk('✂ ' + t('edit.split'), '', () => this.hooks.split());
      mk('⧉ ' + t('edit.duplicate'), '', () => this.hooks.duplicate());
      if (clips[0].kind !== 'text') mk('🎵 ' + t('edit.detachAudio'), '', () => this.hooks.detachAudio());
    }
    mk('🗑 ' + t('edit.delete'), 'danger', () => this.hooks.deleteSelected());
    body.appendChild(row);
  }
  _renderTrack(tr, body) {
    const { store } = this;
    if (!tr) return;
    const name = document.createElement('input'); name.type = 'text'; name.value = tr.name;
    name.addEventListener('change', () => store.updateTrack(tr.id, { name: name.value || tr.name }));
    body.appendChild(this._field(t('inspector.name'), name));
    const p = document.createElement('p'); p.className = 'hint'; p.textContent = `${t('kind.' + tr.kind)} · ${t('inspector.clipCount', { n: store.clipsOnTrack(tr.id).length })}`; body.appendChild(p);
    body.appendChild(this._field(t('inspector.volume'), this._range(tr.volume, { min: 0, max: 2, step: 0.01, onInput: (v) => store.updateTrack(tr.id, { volume: v }, { silent: true }) }), { unit: '%' }));
    const row = document.createElement('div'); row.className = 'toggle-row';
    const toggles = [['muted', 'inspector.trackMute', '🔇'], ['solo', 'inspector.trackSolo', 'S'], ['locked', 'inspector.trackLock', '🔒']];
    if (tr.kind === 'video') toggles.push(['hidden', 'inspector.trackHidden', '👁']);
    for (const [k, label, ico] of toggles) { const b = document.createElement('button'); b.className = 'btn small' + (tr[k] ? ' on' : ''); b.textContent = `${ico} ${t(label)}`; b.onclick = () => store.updateTrack(tr.id, { [k]: !tr[k] }); row.appendChild(b); }
    body.appendChild(row);
    const del = document.createElement('button'); del.className = 'btn small danger'; del.textContent = '🗑 ' + t('inspector.deleteTrack');
    del.onclick = async () => { const n = store.clipsOnTrack(tr.id).length; if (!n || await confirmDialog(t('track.deleteConfirm', { n }), { danger: true })) store.removeTrack(tr.id); };
    body.appendChild(del);
  }
  _renderProject(body) {
    const { store } = this; const p = store.project;
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = t('inspector.noSelection'); body.appendChild(hint);
    const commit = (patch) => { store.pushHistory(); Object.assign(p, patch); store.changed('project'); this.hooks.onProjectChange && this.hooks.onProjectChange(); };
    const sel = document.createElement('select');
    let matched = false;
    for (const r of RESOLUTIONS) { const o = document.createElement('option'); o.value = `${r.w}x${r.h}`; o.textContent = r.label; if (r.w === p.width && r.h === p.height) { o.selected = true; matched = true; } sel.appendChild(o); }
    const custom = document.createElement('option'); custom.value = 'custom'; custom.textContent = t('inspector.custom'); if (!matched) custom.selected = true; sel.appendChild(custom);
    sel.addEventListener('change', () => { if (sel.value === 'custom') return; const [w, h] = sel.value.split('x').map(Number); commit({ width: w, height: h }); });
    body.appendChild(this._field(t('inspector.resolution'), sel));
    const g = document.createElement('div'); g.className = 'field-grid';
    g.appendChild(this._field(t('inspector.width'), this._num(p.width, { min: 16, max: 7680, step: 2, onChange: (v) => commit({ width: Math.round(v / 2) * 2 }) })));
    g.appendChild(this._field(t('inspector.height'), this._num(p.height, { min: 16, max: 7680, step: 2, onChange: (v) => commit({ height: Math.round(v / 2) * 2 }) })));
    body.appendChild(g);
    const fps = document.createElement('select');
    for (const f of [24, 25, 30, 50, 60]) { const o = document.createElement('option'); o.value = f; o.textContent = f; if (p.fps === f) o.selected = true; fps.appendChild(o); }
    fps.addEventListener('change', () => commit({ fps: Number(fps.value) }));
    body.appendChild(this._field(t('inspector.fps'), fps));
    const bg = document.createElement('input'); bg.type = 'color'; bg.value = p.background;
    bg.addEventListener('change', () => commit({ background: bg.value }));
    body.appendChild(this._field(t('inspector.background'), bg));
    // shortcuts
    this._section(body, t('inspector.shortcuts'));
    const sc = document.createElement('div'); sc.className = 'shortcuts';
    const rows = [['Space', 'sc.play'], ['S', 'sc.split'], ['T', 'sc.text'], ['Delete', 'sc.delete'], ['Ctrl+Z', 'sc.undo'], ['Ctrl+Y', 'sc.redo'], ['Ctrl+D', 'sc.dup'], ['← / →', 'sc.frame'], ['Home / End', 'sc.home'], ['Ctrl+Scroll', 'sc.zoom']];
    for (const [k, l] of rows) sc.innerHTML += `<span class="kbd">${k}</span><span>${t(l)}</span>`;
    body.appendChild(sc);
  }
}

// ---------- export dialog ----------
export function openExportDialog(store, player, exporter) {
  const formats = supportedFormats();
  if (!formats.length) { toast(t('export.noSupport'), 'error'); return; }
  const duration = store.projectDuration();
  if (duration <= 0) { toast(t('export.empty'), 'error'); return; }
  const p = store.project;
  const body = document.createElement('div');
  body.innerHTML = `
    <div class="field"><label>${t('export.format')}</label><select id="exFormat"></select></div>
    <div class="field-grid">
      <div class="field"><label>${t('export.resolution')}</label><select id="exRes"></select></div>
      <div class="field"><label>${t('export.fps')}</label><select id="exFps"></select></div>
    </div>
    <div class="field"><label>${t('export.quality')}</label><select id="exQ">
      <option value="2000000">${t('export.qLow')}</option><option value="6000000" selected>${t('export.qMed')}</option>
      <option value="12000000">${t('export.qHigh')}</option><option value="25000000">${t('export.qUltra')}</option></select></div>
    <div class="field"><label>${t('export.filename')}</label><input id="exName" type="text" /></div>
    <label class="check"><input type="checkbox" id="exMute" /> ${t('export.muteMonitor')}</label>
    <div class="notice">${t('export.realtimeNote', { d: formatDurationShort(duration) })}</div>
    <div id="exProgressWrap" hidden><div class="progress"><div id="exBar"></div></div><p id="exStatus" class="hint"></p></div>
    <div id="exResult" class="export-result" hidden></div>`;
  const fmtSel = body.querySelector('#exFormat');
  formats.forEach((f, i) => { const o = document.createElement('option'); o.value = i; o.textContent = f.video ? f.label : `${f.label} – ${t('export.audioOnly')}`; fmtSel.appendChild(o); });
  const resSel = body.querySelector('#exRes');
  const resList = [{ label: `${p.width}×${p.height}`, w: p.width, h: p.height }, ...RESOLUTIONS.filter((r) => r.w !== p.width || r.h !== p.height)];
  resList.forEach((r, i) => { const o = document.createElement('option'); o.value = i; o.textContent = r.label; resSel.appendChild(o); });
  const fpsSel = body.querySelector('#exFps');
  for (const f of [24, 25, 30, 50, 60]) { const o = document.createElement('option'); o.value = f; o.textContent = f; if (f === p.fps) o.selected = true; fpsSel.appendChild(o); }
  const nameIn = body.querySelector('#exName'); nameIn.value = (p.name || 'export').replace(/[\\/:*?"<>|]+/g, '_');
  const prog = body.querySelector('#exProgressWrap'), bar = body.querySelector('#exBar'), status = body.querySelector('#exStatus'), result = body.querySelector('#exResult');
  let running = false, resultUrl = null;
  const modal = openModal({
    title: t('export.title'), body,
    onClose: () => { if (running) exporter.cancel(); if (resultUrl) setTimeout(() => URL.revokeObjectURL(resultUrl), 60000); },
  });
  const startBtn = { label: t('export.start'), cls: 'primary', onClick: async () => { await run(); } };
  const cancelBtn = { label: t('export.cancel'), cls: 'ghost', onClick: () => modal.close() };
  modal.setFooter([cancelBtn, startBtn]);
  async function run() {
    const format = formats[Number(fmtSel.value)];
    const res = resList[Number(resSel.value)];
    const prevW = p.width, prevH = p.height;
    if (res.w !== p.width || res.h !== p.height) { p.width = res.w; p.height = res.h; }
    running = true; prog.hidden = false; result.hidden = true; result.innerHTML = '';
    for (const el of body.querySelectorAll('select,input')) el.disabled = true;
    modal.setFooter([{ label: t('export.cancel'), cls: 'danger', onClick: () => exporter.cancel() }]);
    try {
      const out = await exporter.run({
        format, fps: Number(fpsSel.value), videoBitrate: Number(body.querySelector('#exQ').value), audioBitrate: 192000,
        muteMonitor: body.querySelector('#exMute').checked,
      }, ({ time, duration: d, progress }) => {
        bar.style.width = (progress * 100).toFixed(1) + '%';
        status.textContent = t('export.progress', { p: Math.round(progress * 100), t: formatTime(time, { ms: false }), d: formatTime(d, { ms: false }) });
        if (progress >= 1) status.textContent = t('export.finalizing');
      });
      bar.style.width = '100%';
      status.textContent = t('export.done', { size: formatBytes(out.blob.size) });
      resultUrl = URL.createObjectURL(out.blob);
      const fname = `${nameIn.value || 'export'}.${out.ext}`;
      const preview = document.createElement(format.video ? 'video' : 'audio'); preview.controls = true; preview.src = resultUrl;
      const a = document.createElement('a'); a.href = resultUrl; a.download = fname; a.className = 'btn primary'; a.textContent = '⬇ ' + t('export.download') + ` (${fname})`;
      a.style.display = 'inline-flex'; a.style.marginTop = '8px'; a.style.textDecoration = 'none';
      result.append(preview, a); result.hidden = false;
      window.__lastExport = { blob: out.blob, duration: out.duration, ext: out.ext };
      toast(t('export.done', { size: formatBytes(out.blob.size) }), 'success');
    } catch (e) {
      if (e && e.message === 'cancelled') { status.textContent = t('export.cancelled'); toast(t('export.cancelled')); }
      else { console.error(e); status.textContent = t('export.error', { e: e.message || e }); toast(t('export.error', { e: e.message || e }), 'error', 6000); }
    } finally {
      running = false;
      if (p.width !== prevW || p.height !== prevH) { p.width = prevW; p.height = prevH; }
      for (const el of body.querySelectorAll('select,input')) el.disabled = false;
      modal.setFooter([{ label: t('export.close'), cls: 'ghost', onClick: () => modal.close() }, startBtn]);
    }
  }
  return modal;
}

// ---------- voice-over recording dialog ----------
export function openRecordDialog(store, player, onRecorded) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') { toast(t('record.noMic'), 'error'); return; }
  const body = document.createElement('div');
  body.innerHTML = `
    <p class="hint">${t('record.hint')}</p>
    <label class="check"><input type="checkbox" id="recPlay" checked /> ${t('record.playWhile')}</label>
    <label class="check"><input type="checkbox" id="recAdd" checked /> ${t('record.addToTimeline')}</label>
    <div class="rec-timer" id="recTimer">00:00.0</div>
    <div class="rec-level"><div id="recLevel"></div></div>`;
  let stream, recorder, chunks = [], startAt = 0, timer = 0, analyser, raf = 0, recording = false;
  const startPos = player.currentTime;
  const cleanup = () => { cancelAnimationFrame(raf); clearInterval(timer); if (stream) stream.getTracks().forEach((tr) => tr.stop()); if (player.playing) player.pause(); };
  const modal = openModal({ title: t('record.dialogTitle'), body, onClose: cleanup });
  const timerEl = body.querySelector('#recTimer'), level = body.querySelector('#recLevel');
  const startBtn = { label: '⏺ ' + t('record.start'), cls: 'primary', onClick: start };
  const stopBtn = { label: '⏹ ' + t('record.stop'), cls: 'danger', onClick: stop };
  modal.setFooter([{ label: t('common.cancel'), cls: 'ghost', onClick: () => modal.close() }, startBtn]);
  async function start() {
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { toast(t(e.name === 'NotAllowedError' ? 'record.permissionDenied' : 'record.noMic'), 'error'); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      const ext = (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
      const n = [...store.media.values()].filter((m) => m.recorded).length + 1;
      const file = new File([blob], `${t('record.button')} ${n}.${ext}`, { type: blob.type });
      const addToTimeline = body.querySelector('#recAdd').checked;
      modal.close();
      onRecorded(file, { startPos, addToTimeline });
    };
    // level meter
    try {
      const ac = player.ensureAudio(); await player.resumeAudio();
      const src = ac.createMediaStreamSource(stream); analyser = ac.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const meter = () => { analyser.getByteTimeDomainData(data); let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128); level.style.width = Math.min(100, peak * 140) + '%'; raf = requestAnimationFrame(meter); };
      meter();
    } catch { /* meter is optional */ }
    recorder.start(250);
    recording = true; startAt = performance.now();
    timer = setInterval(() => { const s = (performance.now() - startAt) / 1000; timerEl.textContent = formatTime(s, { ms: false }) + '.' + Math.floor((s % 1) * 10); }, 100);
    if (body.querySelector('#recPlay').checked) { player.seek(startPos); player.play(); }
    modal.setFooter([stopBtn]);
    body.querySelectorAll('input').forEach((i) => { i.disabled = true; });
  }
  function stop() { if (!recording) return; recording = false; clearInterval(timer); if (player.playing) player.pause(); recorder.stop(); }
  return modal;
}

// ---------- project save / open ----------
export function saveProjectFile(store) {
  const data = JSON.stringify(store.toJSON(), null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = `${(store.project.name || 'project').replace(/[\\/:*?"<>|]+/g, '_')}.veditor.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  store.dirty = false;
  toast(t('project.saved'), 'success');
}
export function openProjectFile(store, library) {
  const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
  input.onchange = async () => {
    const f = input.files[0]; if (!f) return;
    let data;
    try { data = JSON.parse(await f.text()); if (data.app !== 'veditor' || !data.project) throw new Error('bad'); }
    catch { toast(t('project.loadError'), 'error'); return; }
    const needed = data.media || [];
    const body = document.createElement('div');
    body.innerHTML = `<p class="hint">${t('project.relinkHint')}</p><div id="matchList"></div>`;
    const list = body.querySelector('#matchList');
    const matches = new Map(); // old media id -> new media
    const renderList = () => {
      list.innerHTML = '';
      for (const m of needed) {
        const row = document.createElement('div'); row.className = 'file-match';
        const hit = matches.get(m.id);
        row.innerHTML = `<span></span><span class="${hit ? 'ok' : 'missing'}">${hit ? '✓ ' + t('project.found') : '✕ ' + t('project.missing')}</span>`;
        row.firstChild.textContent = m.name; list.appendChild(row);
      }
    };
    // match already-imported media by name
    for (const m of needed) { const hit = [...store.media.values()].find((x) => x.name === m.name); if (hit) matches.set(m.id, hit); }
    renderList();
    const modal = openModal({
      title: t('project.openTitle'), body,
      footer: [
        { label: t('project.chooseFiles'), onClick: () => {
          const fi = document.createElement('input'); fi.type = 'file'; fi.multiple = true;
          fi.onchange = async () => {
            const added = await library.importFiles([...fi.files]);
            for (const m of needed) { const hit = added.find((x) => x.name === m.name); if (hit) matches.set(m.id, hit); }
            renderList();
          };
          fi.click();
        } },
        { label: t('project.load'), cls: 'primary', onClick: () => { modal.close(); load(); } },
      ],
    });
    function load() {
      const project = data.project;
      let dropped = 0;
      project.clips = (project.clips || []).filter((c) => { const hit = matches.get(c.mediaId); if (!hit) { dropped++; return false; } c.mediaId = hit.id; return true; });
      store.loadProject(project);
      toast(t('project.loaded', { n: project.clips.length }), 'success');
      if (dropped) toast(t('project.missingDropped', { n: dropped }), 'error');
    }
  };
  input.click();
}
