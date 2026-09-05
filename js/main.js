// ===================== Veditor – application bootstrap =====================
import { t, setLang, getLang, applyStatic } from './i18n.js';
import { Store, formatTime, uid, TEXT_DEFAULT_DURATION } from './state.js';
import { Player } from './player.js';
import { Timeline } from './timeline.js';
import { Exporter } from './exporter.js';
import { Library, Inspector, toast, showContextMenu, openExportDialog, openRecordDialog, saveProjectFile, openProjectFile } from './ui.js';

const $ = (id) => document.getElementById(id);

// ---------- core objects ----------
const store = new Store();
const player = new Player(store, $('previewCanvas'), $('mediaHost'));
const exporter = new Exporter(player, store);

const timeline = new Timeline(store, player, {
  body: $('tlBody'), rulerWrap: $('tlRulerWrap'), ruler: $('tlRuler'), headers: $('tlHeaders'),
  lanes: $('tlLanes'), lanesInner: $('tlLanesInner'), playhead: $('tlPlayhead'),
}, {
  onDropMedia: (mediaId, trackId, time) => addMediaToTimeline(mediaId, { trackId, time }),
  onDropFiles: async (files, trackId, time) => {
    const added = await library.importFiles(files);
    let tm = time;
    for (const m of added) { const c = addMediaToTimeline(m.id, { trackId, time: tm, quiet: true }); if (c) tm = c.start + c.duration; }
  },
  onClipContextMenu: (clipId, x, y) => clipContextMenu(clipId, x, y),
  onMessage: (msg) => toast(msg),
  onZoom: (v) => { $('zoomSlider').value = v; },
});

const library = new Library(store, { list: $('libraryList'), empty: $('libraryEmpty'), importBtn: $('btnImport'), fileInput: $('fileInput'), drop: $('libraryDrop') }, {
  onAdd: (mediaId) => addMediaToTimeline(mediaId, { time: player.currentTime }),
  onDragStart: (m) => timeline.setDraggingMediaKind(m.kind),
});

const inspector = new Inspector(store, player, { title: $('inspectorTitle'), body: $('inspectorBody') }, {
  split: () => splitSelected(), duplicate: () => duplicateSelected(), detachAudio: () => detachAudioSelected(), deleteSelected: () => deleteSelected(),
  onProjectChange: () => player.render(player.currentTime),
});

// ---------- editing operations ----------
/** Place media on the timeline. Chooses a compatible track when none (or an incompatible one) is given. */
function addMediaToTimeline(mediaId, { trackId = null, time = null, quiet = false } = {}) {
  const m = store.media.get(mediaId); if (!m) return null;
  let track = trackId ? store.getTrack(trackId) : null;
  if (track && (!store.canPlaceKind(m.kind, track.kind) || track.locked)) track = null;
  const wantKind = m.kind === 'audio' ? 'audio' : 'video';
  const start = time == null ? player.currentTime : Math.max(0, time);
  if (!track) {
    // prefer a track of the wanted kind that is free at the requested position
    // video: prefer the bottom-most (primary) layer first; audio: first audio track first
    let candidates = store.project.tracks.filter((tr) => tr.kind === wantKind && !tr.locked);
    if (wantKind === 'video') candidates = candidates.slice().reverse();
    // 1) a track that can host the clip at (or very near) the requested time, 2) any free track, 3) the primary track
    track = candidates.find((tr) => { const pos = store.findPlacement(tr.id, start, m.duration, []); return pos != null && Math.abs(pos - start) < 0.5; })
      || candidates.find((tr) => store.isFree(tr.id, start, m.duration)) || candidates[0] || null;
    if (!track) { track = store.addTrack(wantKind); if (!quiet) toast(t('timeline.autoTrack')); }
  }
  const pos = store.findPlacement(track.id, start, m.duration, []);
  if (pos == null) { toast(t('timeline.noSpace'), 'error'); return null; }
  const clip = store.addClip({ trackId: track.id, mediaId: m.id, name: m.name, start: pos, duration: m.duration, offset: 0 });
  store.selectClips([clip.id]);
  return clip;
}

/** Add a text layer at the playhead on the top-most free video track (creating one if needed). */
function addTextClip(time = player.currentTime, text = t('text.default')) {
  const dur = TEXT_DEFAULT_DURATION;
  let track = store.project.tracks.find((tr) => tr.kind === 'video' && !tr.locked && store.isFree(tr.id, time, dur));
  if (!track) track = store.addTrack('video');
  const clip = store.addClip({ kind: 'text', trackId: track.id, name: text.split('\n')[0], text, start: Math.max(0, time), duration: dur, transIn: { type: 'fade', duration: 0.4 }, transOut: { type: 'fade', duration: 0.4 } });
  store.selectClips([clip.id]);
  toast(t('text.added'), 'success');
  return clip;
}
/** Apply a 0.5 s cross dissolve to the selected clips (transition-in on each; the predecessor is blended automatically). */
function crossfadeSelected() {
  const clips = store.selectedClips().filter((c) => store.getTrack(c.trackId)?.kind === 'video');
  if (!clips.length) return;
  store.pushHistory();
  for (const c of clips) store.updateClip(c.id, { transIn: { type: 'fade', duration: Math.min(0.5, c.duration / 2) } }, { silent: true });
  store.changed('transition');
  toast(t('trans.applied'), 'success');
}
function splitSelected() {
  const clips = store.selectedClips();
  const tm = player.currentTime;
  let did = false;
  for (const c of clips) { const r = store.splitClipAt(c.id, tm); if (r) did = true; }
  if (!did) { // no selection: split whatever clip is under the playhead on every unlocked track
    if (!clips.length) {
      const under = store.project.clips.filter((c) => tm > c.start + 0.01 && tm < c.start + c.duration - 0.01 && !store.getTrack(c.trackId)?.locked);
      for (const c of under) if (store.splitClipAt(c.id, tm)) did = true;
    }
    if (!did) toast(t('edit.splitNone'));
  }
}
function deleteSelected() {
  const ids = [...store.selection.clipIds].filter((id) => !store.getTrack(store.getClip(id)?.trackId)?.locked);
  if (ids.length) store.removeClips(ids);
}
function duplicateSelected() { for (const c of store.selectedClips()) { const d = store.duplicateClip(c.id); if (d) store.selectClips([d.id]); } }
/** Copy the audio of a video clip to an audio track and mute the original clip's audio. */
function detachAudioSelected() {
  const clips = store.selectedClips();
  const c = clips[0];
  const m = c && store.media.get(c.mediaId);
  const tr = c && store.getTrack(c.trackId);
  if (!c || !m || m.kind !== 'video' || tr.kind !== 'video') { toast(t('edit.detachNoAudio'), 'error'); return; }
  let target = store.project.tracks.find((x) => x.kind === 'audio' && !x.locked && store.isFree(x.id, c.start, c.duration));
  if (!target) target = store.addTrack('audio');
  store.pushHistory();
  const a = store.addClip({ trackId: target.id, mediaId: m.id, name: m.name, start: c.start, duration: c.duration, offset: c.offset, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut }, { silent: true });
  store.updateClip(c.id, { muted: true }, { silent: true });
  store.changed('detach');
  store.selectClips([a.id]);
  toast(t('edit.detachDone'), 'success');
}
function clipContextMenu(clipId, x, y) {
  const c = store.getClip(clipId); if (!c) return;
  showContextMenu([
    { label: '✂ ' + t('menu.split'), onClick: () => splitSelected() },
    { label: '⧉ ' + t('menu.duplicate'), onClick: () => duplicateSelected() },
    ...(c.kind !== 'text' ? [{ label: '🎵 ' + t('menu.detach'), onClick: () => detachAudioSelected() }] : []),
    { label: '⟋ ' + t('menu.crossfade'), onClick: () => crossfadeSelected() },
    { label: (c.muted ? '🔊 ' + t('menu.unmute') : '🔇 ' + t('menu.mute')), onClick: () => store.updateClip(c.id, { muted: !c.muted }) },
    { label: '🔍 ' + t('menu.selectMedia'), onClick: () => library.select(c.mediaId) },
    '-',
    { label: '🗑 ' + t('menu.delete'), danger: true, onClick: () => deleteSelected() },
  ], x, y);
}

// ---------- transport UI ----------
const btnPlay = $('btnPlay');
function refreshPlayBtn() { btnPlay.textContent = player.playing ? '⏸' : '▶'; }
player.on('play', refreshPlayBtn); player.on('pause', refreshPlayBtn); player.on('ended', refreshPlayBtn);
btnPlay.onclick = () => player.toggle();
$('btnGoStart').onclick = () => player.seek(0);
$('btnGoEnd').onclick = () => player.seek(player.duration);
$('btnBack5').onclick = () => player.seek(player.currentTime - 5);
$('btnFwd5').onclick = () => player.seek(player.currentTime + 5);
$('btnPrevFrame').onclick = () => player.stepFrame(-1);
$('btnNextFrame').onclick = () => player.stepFrame(1);
$('viewMode').onchange = (e) => { player.viewMode = e.target.value; };
$('monitorVolume').oninput = (e) => { player.ensureAudio(); player.setMonitorVolume(Number(e.target.value)); };
$('btnMonitorMute').onclick = () => { player.ensureAudio(); player.setMonitorMuted(!player.monitorMuted); $('btnMonitorMute').textContent = player.monitorMuted ? '🔇' : '🔊'; };
$('btnFullscreen').onclick = () => { const st = $('previewStage'); if (document.fullscreenElement) document.exitFullscreen(); else st.requestFullscreen?.(); };
$('previewCanvas').addEventListener('click', () => player.toggle());

const timeCur = $('timeCurrent'), timeTot = $('timeTotal');
let lastShown = -1;
player.on('time', (tm) => { if (Math.abs(tm - lastShown) >= 0.001) { lastShown = tm; timeCur.textContent = formatTime(tm); } });
function refreshTotal() { timeTot.textContent = formatTime(store.projectDuration()); }
store.on('change', refreshTotal); refreshTotal();

// ---------- timeline toolbar ----------
$('btnUndo').onclick = () => store.undo();
$('btnRedo').onclick = () => store.redo();
$('btnSplit').onclick = splitSelected;
$('btnDelete').onclick = deleteSelected;
$('btnDuplicate').onclick = duplicateSelected;
$('btnDetachAudio').onclick = detachAudioSelected;
$('btnAddVideoTrack').onclick = () => { const tr = store.addTrack('video'); store.selectTrack(tr.id); };
$('btnAddAudioTrack').onclick = () => { const tr = store.addTrack('audio'); store.selectTrack(tr.id); };
$('btnAddText').onclick = () => addTextClip();
$('snapToggle').onchange = (e) => { timeline.snap = e.target.checked; };
$('zoomSlider').oninput = (e) => timeline.setZoomSlider(Number(e.target.value));
$('btnZoomIn').onclick = () => timeline.zoomBy(1.3, player.currentTime);
$('btnZoomOut').onclick = () => timeline.zoomBy(1 / 1.3, player.currentTime);
$('btnZoomFit').onclick = () => timeline.zoomFit();
function refreshHistoryBtns() { $('btnUndo').disabled = !store.canUndo(); $('btnRedo').disabled = !store.canRedo(); }
store.on('history', refreshHistoryBtns); refreshHistoryBtns();
function refreshSelectionBtns() {
  const n = store.selection.clipIds.size;
  $('btnDelete').disabled = n === 0; $('btnDuplicate').disabled = n === 0;
  $('btnDetachAudio').disabled = n !== 1 || store.selectedClips()[0]?.kind === 'text';
}
store.on('selection', refreshSelectionBtns); refreshSelectionBtns();

// ---------- top bar ----------
$('projectName').addEventListener('change', (e) => { store.project.name = e.target.value.trim() || t('project.default'); store.dirty = true; document.title = `${store.project.name} – Veditor`; });
$('btnExport').onclick = () => openExportDialog(store, player, exporter);
$('btnSaveProject').onclick = () => saveProjectFile(store);
$('btnOpenProject').onclick = () => openProjectFile(store, library);
$('btnRecordVoice').onclick = () => openRecordDialog(store, player, async (file, { startPos, addToTimeline }) => {
  const added = await library.importFiles([file]);
  if (!added.length) return;
  added[0].recorded = true;
  if (addToTimeline) {
    let track = store.project.tracks.find((tr) => tr.kind === 'audio' && !tr.locked && store.isFree(tr.id, startPos, added[0].duration));
    if (!track) track = store.addTrack('audio');
    addMediaToTimeline(added[0].id, { trackId: track.id, time: startPos });
  }
  toast(t('record.saved', { d: formatTime(added[0].duration, { ms: false }) }), 'success');
});
$('langSelect').value = getLang();
$('langSelect').onchange = (e) => { setLang(e.target.value); inspector.render(); library.render(); timeline.render(); };
store.on('change', (ev) => { if (ev?.reason === 'load') { $('projectName').value = store.project.name; player.render(player.currentTime); timeline.zoomFit(); } });

// ---------- keyboard shortcuts ----------
document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if (document.querySelector('.modal-backdrop')) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  else if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
  else if ((ctrl && e.key.toLowerCase() === 'y') || (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); store.redo(); }
  else if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
  else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveProjectFile(store); }
  else if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); openExportDialog(store, player, exporter); }
  else if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); store.selectClips(store.project.clips.map((c) => c.id)); }
  else if (e.key === 's' || e.key === 'S') { e.preventDefault(); splitSelected(); }
  else if (e.key === 't' || e.key === 'T') { e.preventDefault(); addTextClip(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); e.shiftKey ? player.seek(player.currentTime - 1) : player.stepFrame(-1); }
  else if (e.key === 'ArrowRight') { e.preventDefault(); e.shiftKey ? player.seek(player.currentTime + 1) : player.stepFrame(1); }
  else if (e.key === 'Home') { e.preventDefault(); player.seek(0); }
  else if (e.key === 'End') { e.preventDefault(); player.seek(player.duration); }
  else if (e.key === 'j' || e.key === 'J') { player.seek(player.currentTime - 5); }
  else if (e.key === 'l' || e.key === 'L') { player.seek(player.currentTime + 5); }
  else if (e.key === 'k' || e.key === 'K') { player.pause(); }
  else if (e.key === '+' || e.key === '=') { timeline.zoomBy(1.3, player.currentTime); }
  else if (e.key === '-' || e.key === '_') { timeline.zoomBy(1 / 1.3, player.currentTime); }
  else if (e.key === 'Escape') { store.clearSelection(); }
  else if (e.key === 'm' || e.key === 'M') { for (const c of store.selectedClips()) store.updateClip(c.id, { muted: !c.muted }); }
});

// unsaved changes guard
window.addEventListener('beforeunload', (e) => { if (store.dirty && store.project.clips.length) { e.preventDefault(); e.returnValue = t('warn.unsaved'); } });

// initial i18n + render
applyStatic();
document.title = `${store.project.name} – Veditor`;
$('projectName').value = store.project.name;
$('zoomSlider').value = timeline.zoomSliderValue();
player.render(0);

// expose for debugging / tests
window.veditor = { store, player, timeline, exporter, library, addMediaToTimeline, addTextClip, crossfadeSelected, splitSelected, deleteSelected, detachAudioSelected, uid };
