import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { EditorProvider, useEditor, useI18n, type EditorContextValue, type EditorSession } from '../hooks/useEditor';
import { TopBar } from './TopBar';
import { MediaLibrary } from './MediaLibrary';
import { useImportFiles } from '../hooks/useImportFiles';
import { Preview } from './Preview';
import { Inspector } from './Inspector';
import { TimelinePanel } from './TimelinePanel';
import { ExportDialog } from './ExportDialog';
import { RecordDialog } from './RecordDialog';
import { OpenProjectDialog } from './OpenProjectDialog';
import { TEXT_DEFAULT_DURATION, formatTime, uid } from '../engine/state';
import { supportedFormats } from '../engine/exporter';
import type { Timeline } from '../engine/timeline';
import type { Clip, ExportResult, MediaItem, ProjectFile, Track } from '../engine/types';
import { cn } from '@/lib/utils';
import '../editor.css';

export interface VideoEditorProps {
  /** Hide the Veditor brand in the top bar (when the host app already has a header/menu). */
  embedded?: boolean;
  className?: string;
  /** Called with the exported file after a successful export. */
  onExport?: (result: ExportResult, fileName: string) => void;
  /** Called once the engine is ready; exposes store/player for host integrations. */
  onReady?: (ctx: EditorContextValue) => void;
  /**
   * Editor session (project + engine) to mount. Create it once with createEditorSession() and keep it
   * outside the component tree (module scope, a store, a context) so the project survives route changes.
   * Defaults to a shared session, which also persists across mounts.
   */
  session?: EditorSession;
}

/** Multi-track video editor. Self-contained: mount it anywhere (a route, a tab, a dialog) inside a shadcn/Tailwind app. */
export function VideoEditor(props: VideoEditorProps) {
  return (
    <EditorProvider session={props.session} onReady={props.onReady}>
      <TooltipProvider>
        <EditorShell {...props} />
        <Toaster position="bottom-center" richColors />
      </TooltipProvider>
    </EditorProvider>
  );
}

function EditorShell({ embedded, className, onExport }: VideoEditorProps) {
  const ctx = useEditor();
  const { store, player, exporter } = ctx;
  const { t } = useI18n();
  const importFiles = useImportFiles();
  const timelineRef = useRef<Timeline | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);
  const [projectData, setProjectData] = useState<ProjectFile | null>(null);
  const [libSelected, setLibSelected] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // ---------- editing operations ----------
  const addMediaToTimeline = useCallback((mediaId: string, { trackId = null, time = null, quiet = false }: { trackId?: string | null; time?: number | null; quiet?: boolean } = {}): Clip | null => {
    const m = store.media.get(mediaId); if (!m) return null;
    let track: Track | null = trackId ? store.getTrack(trackId) : null;
    if (track && (!store.canPlaceKind(m.kind, track.kind) || track.locked)) track = null;
    const wantKind = m.kind === 'audio' ? 'audio' : 'video';
    const start = time == null ? player.currentTime : Math.max(0, time);
    if (!track) {
      let candidates = store.project.tracks.filter((tr) => tr.kind === wantKind && !tr.locked);
      if (wantKind === 'video') candidates = candidates.slice().reverse();
      track = candidates.find((tr) => { const pos = store.findPlacement(tr.id, start, m.duration, []); return pos != null && Math.abs(pos - start) < 0.5; })
        || candidates.find((tr) => store.isFree(tr.id, start, m.duration)) || candidates[0] || null;
      if (!track) { track = store.addTrack(wantKind); if (!quiet) toast(t('timeline.autoTrack')); }
    }
    const pos = store.findPlacement(track.id, start, m.duration, []);
    if (pos == null) { toast.error(t('timeline.noSpace')); return null; }
    const clip = store.addClip({ trackId: track.id, mediaId: m.id, name: m.name, start: pos, duration: m.duration, offset: 0 });
    store.selectClips([clip.id]);
    return clip;
  }, [store, player, t]);

  const addTextClip = useCallback((time: number = player.currentTime, text: string = t('text.default')): Clip => {
    const dur = TEXT_DEFAULT_DURATION;
    let track = store.project.tracks.find((tr) => tr.kind === 'video' && !tr.locked && store.isFree(tr.id, time, dur));
    if (!track) track = store.addTrack('video');
    const clip = store.addClip({ kind: 'text', trackId: track.id, name: text.split('\n')[0], text, start: Math.max(0, time), duration: dur, transIn: { type: 'fade', duration: 0.4 }, transOut: { type: 'fade', duration: 0.4 } });
    store.selectClips([clip.id]);
    toast.success(t('text.added'));
    return clip;
  }, [store, player, t]);

  const splitSelected = useCallback(() => {
    const clips = store.selectedClips(); const tm = player.currentTime; let did = false;
    for (const c of clips) if (store.splitClipAt(c.id, tm)) did = true;
    if (!did && !clips.length) {
      const under = store.project.clips.filter((c) => tm > c.start + 0.01 && tm < c.start + c.duration - 0.01 && !store.getTrack(c.trackId)?.locked);
      for (const c of under) if (store.splitClipAt(c.id, tm)) did = true;
    }
    if (!did) toast(t('edit.splitNone'));
  }, [store, player, t]);
  const deleteSelected = useCallback(() => {
    const ids = [...store.selection.clipIds].filter((id) => !store.getTrack(store.getClip(id)?.trackId)?.locked);
    if (ids.length) store.removeClips(ids);
  }, [store]);
  const duplicateSelected = useCallback(() => { for (const c of store.selectedClips()) { const d = store.duplicateClip(c.id); if (d) store.selectClips([d.id]); } }, [store]);
  const detachAudioSelected = useCallback(() => {
    const c = store.selectedClips()[0];
    const m = c?.mediaId ? store.media.get(c.mediaId) : null; const tr = c ? store.getTrack(c.trackId) : null;
    if (!c || !m || m.kind !== 'video' || !tr || tr.kind !== 'video') { toast.error(t('edit.detachNoAudio')); return; }
    let target = store.project.tracks.find((x) => x.kind === 'audio' && !x.locked && store.isFree(x.id, c.start, c.duration));
    if (!target) target = store.addTrack('audio');
    store.pushHistory();
    const a = store.addClip({ trackId: target.id, mediaId: m.id, name: m.name, start: c.start, duration: c.duration, offset: c.offset, volume: c.volume, fadeIn: c.fadeIn, fadeOut: c.fadeOut }, { silent: true });
    store.updateClip(c.id, { muted: true }, { silent: true });
    store.changed('detach'); store.selectClips([a.id]);
    toast.success(t('edit.detachDone'));
  }, [store, t]);
  const crossfadeSelected = useCallback(() => {
    const clips = store.selectedClips().filter((c) => store.getTrack(c.trackId)?.kind === 'video');
    if (!clips.length) return;
    store.pushHistory();
    for (const c of clips) store.updateClip(c.id, { transIn: { type: 'fade', duration: Math.min(0.5, c.duration / 2) } }, { silent: true });
    store.changed('transition'); toast.success(t('trans.applied'));
  }, [store, t]);

  const saveProject = useCallback(() => {
    const blob = new Blob([JSON.stringify(store.toJSON(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${(store.project.name || 'project').replace(/[\\/:*?"<>|]+/g, '_')}.veditor.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
    store.dirty = false; toast.success(t('project.saved'));
  }, [store, t]);
  const openProject = useCallback(() => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const f = input.files?.[0]; if (!f) return;
      try { const data = JSON.parse(await f.text()) as ProjectFile; if (data.app !== 'veditor' || !data.project) throw new Error('bad'); setProjectData(data); }
      catch { toast.error(t('project.loadError')); }
    };
    input.click();
  }, [t]);

  const onRecorded = useCallback(async (file: File, { startPos, addToTimeline }: { startPos: number; addToTimeline: boolean }) => {
    const added = await importFiles([file]); if (!added.length) return;
    added[0].recorded = true;
    if (addToTimeline) {
      let track = store.project.tracks.find((tr) => tr.kind === 'audio' && !tr.locked && store.isFree(tr.id, startPos, added[0].duration));
      if (!track) track = store.addTrack('audio');
      addMediaToTimeline(added[0].id, { trackId: track.id, time: startPos });
    }
    toast.success(t('record.saved', { d: formatTime(added[0].duration, { ms: false }) }));
  }, [importFiles, store, addMediaToTimeline, t]);

  const removeMedia = useCallback((m: MediaItem) => { if (window.confirm(t('library.removeConfirm'))) store.removeMedia(m.id); }, [store, t]);

  // ---------- keyboard shortcuts (scoped to the editor root) ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = (target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const tl = timelineRef.current;
      if (e.code === 'Space') { e.preventDefault(); void player.toggle(); }
      else if (ctrl && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); store.undo(); }
      else if ((ctrl && e.key.toLowerCase() === 'y') || (ctrl && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); store.redo(); }
      else if (ctrl && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); }
      else if (ctrl && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); }
      else if (ctrl && e.key.toLowerCase() === 'e') { e.preventDefault(); setExportOpen(true); }
      else if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); store.selectClips(store.project.clips.map((c) => c.id)); }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); splitSelected(); }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); addTextClip(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelected(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) player.seek(player.currentTime - 1); else player.stepFrame(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) player.seek(player.currentTime + 1); else player.stepFrame(1); }
      else if (e.key === 'Home') { e.preventDefault(); player.seek(0); }
      else if (e.key === 'End') { e.preventDefault(); player.seek(player.duration); }
      else if (e.key === 'j' || e.key === 'J') player.seek(player.currentTime - 5);
      else if (e.key === 'l' || e.key === 'L') player.seek(player.currentTime + 5);
      else if (e.key === 'k' || e.key === 'K') player.pause();
      else if (e.key === '+' || e.key === '=') tl?.zoomBy(1.3, player.currentTime);
      else if (e.key === '-' || e.key === '_') tl?.zoomBy(1 / 1.3, player.currentTime);
      else if (e.key === 'Escape') store.clearSelection();
      else if (e.key === 'm' || e.key === 'M') for (const c of store.selectedClips()) store.updateClip(c.id, { muted: !c.muted });
    };
    document.addEventListener('keydown', onKey);
    const onUnload = (e: BeforeUnloadEvent) => { if (store.dirty && store.project.clips.length) { e.preventDefault(); } };
    window.addEventListener('beforeunload', onUnload);
    return () => { document.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', onUnload); };
  }, [store, player, splitSelected, deleteSelected, duplicateSelected, saveProject, addTextClip]);

  // ---------- project load: reset view ----------
  useEffect(() => store.on('change', (ev?: { reason?: string }) => { if (ev?.reason === 'load') { player.render(player.currentTime); timelineRef.current?.zoomFit(); } }), [store, player]);

  // ---------- debug / test handle ----------
  useEffect(() => {
    (window as any).veditor = { store, player, exporter, timeline: timelineRef, get tl() { return timelineRef.current; }, addMediaToTimeline, addTextClip, crossfadeSelected, splitSelected, deleteSelected, detachAudioSelected, uid, importFiles, supportedFormats };
    return () => { delete (window as any).veditor; };
  }, [store, player, exporter, addMediaToTimeline, addTextClip, crossfadeSelected, splitSelected, deleteSelected, detachAudioSelected, importFiles]);

  const actions = { split: splitSelected, duplicate: duplicateSelected, detachAudio: detachAudioSelected, deleteSelected, crossfade: crossfadeSelected, addText: () => addTextClip() };

  return (
    <div ref={rootRef} className={cn('veditor bg-background text-foreground dark grid h-full min-h-0 w-full min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_320px] overflow-hidden', className)}>
      <TopBar embedded={embedded} onExport={() => setExportOpen(true)} onSave={saveProject} onOpen={openProject} />
      <main className="grid min-h-0 min-w-0 grid-cols-[300px_minmax(0,1fr)_300px] max-[1100px]:grid-cols-[240px_minmax(0,1fr)_260px]">
        <MediaLibrary
          selectedId={libSelected} onSelect={setLibSelected}
          onAdd={(id) => addMediaToTimeline(id, { time: player.currentTime })}
          onRecord={() => setRecordOpen(true)}
          onDragStart={(m) => timelineRef.current?.setDraggingMediaKind(m.kind)}
          onRemove={removeMedia}
        />
        <Preview recording={recordOpen} />
        <Inspector actions={actions} />
      </main>
      <TimelinePanel
        timelineRef={timelineRef}
        actions={{
          ...actions,
          addTrack: (kind) => { const tr = store.addTrack(kind); store.selectTrack(tr.id); },
          onDropMedia: (mediaId, trackId, time) => addMediaToTimeline(mediaId, { trackId, time }),
          onDropFiles: async (files, trackId, time) => { const added = await importFiles(files); let tm = time; for (const m of added) { const c = addMediaToTimeline(m.id, { trackId, time: tm, quiet: true }); if (c) tm = c.start + c.duration; } },
          revealMedia: (id) => setLibSelected(id),
        }}
      />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} onExported={onExport} />
      <RecordDialog open={recordOpen} onOpenChange={setRecordOpen} onRecorded={onRecorded} />
      <OpenProjectDialog data={projectData} onOpenChange={(o) => { if (!o) setProjectData(null); }} />
    </div>
  );
}
