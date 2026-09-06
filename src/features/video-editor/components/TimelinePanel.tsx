import { useEffect, useRef, useState } from 'react';
import { Copy, Music, Redo2, Scissors, Trash2, Type, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu';
import { Timeline, type TimelineHooks } from '../engine/timeline';
import { useEditor, useI18n, useStoreEvents } from '../hooks/useEditor';

export interface TimelineActions {
  split: () => void; deleteSelected: () => void; duplicate: () => void; detachAudio: () => void; crossfade: () => void; addText: () => void;
  addTrack: (kind: 'video' | 'audio') => void; onDropMedia: (mediaId: string, trackId: string, time: number) => void; onDropFiles: (files: File[], trackId: string, time: number) => void;
  revealMedia: (mediaId: string) => void;
}

export function TimelinePanel({ actions, timelineRef }: { actions: TimelineActions; timelineRef: React.MutableRefObject<Timeline | null> }) {
  const { store, player } = useEditor();
  const { t } = useI18n();
  useStoreEvents(['selection', 'history', 'change']);
  const refs = { body: useRef<HTMLDivElement>(null), rulerWrap: useRef<HTMLDivElement>(null), ruler: useRef<HTMLCanvasElement>(null), headers: useRef<HTMLDivElement>(null), lanes: useRef<HTMLDivElement>(null), lanesInner: useRef<HTMLDivElement>(null), playhead: useRef<HTMLDivElement>(null) };
  const [zoom, setZoom] = useState(35);
  const [snap, setSnap] = useState(true);
  const [menuClip, setMenuClip] = useState<string | null>(null);
  const menuOpenedAt = useRef(0);
  const actionsRef = useRef(actions); actionsRef.current = actions;

  useEffect(() => {
    const hooks: TimelineHooks = {
      onDropMedia: (m, tr, time) => actionsRef.current.onDropMedia(m, tr, time),
      onDropFiles: (files, tr, time) => actionsRef.current.onDropFiles(files, tr, time),
      onZoom: (v) => setZoom(v),
    };
    const tl = new Timeline(store, player, {
      body: refs.body.current!, rulerWrap: refs.rulerWrap.current!, ruler: refs.ruler.current!, headers: refs.headers.current!,
      lanes: refs.lanes.current!, lanesInner: refs.lanesInner.current!, playhead: refs.playhead.current!,
    }, hooks);
    timelineRef.current = tl;
    setZoom(tl.zoomSliderValue());
    return () => { tl.destroy(); timelineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, player]);

  useEffect(() => { if (timelineRef.current) timelineRef.current.snap = snap; }, [snap, timelineRef]);

  const n = store.selection.clipIds.size;
  const single = n === 1 ? store.selectedClips()[0] : null;
  const menu = menuClip ? store.getClip(menuClip) : null;

  return (
    <section className="bg-card flex min-h-0 min-w-0 flex-col border-t" id="timelinePanel">
      <div className="flex flex-wrap items-center gap-3 border-b px-3 py-1.5">
        <div className="flex items-center gap-1">
          <Button id="btnUndo" variant="ghost" size="xs" disabled={!store.canUndo()} onClick={() => store.undo()}><Undo2 /> {t('edit.undo')}</Button>
          <Button id="btnRedo" variant="ghost" size="xs" disabled={!store.canRedo()} onClick={() => store.redo()}><Redo2 /> {t('edit.redo')}</Button>
        </div>
        <div className="flex items-center gap-1">
          <Button id="btnSplit" variant="outline" size="xs" title={t('edit.splitHint')} onClick={actions.split}><Scissors /> {t('edit.split')}</Button>
          <Button id="btnDelete" variant="outline" size="xs" disabled={n === 0} title={t('edit.deleteHint')} onClick={actions.deleteSelected}><Trash2 /> {t('edit.delete')}</Button>
          <Button id="btnDuplicate" variant="outline" size="xs" disabled={n === 0} onClick={actions.duplicate}><Copy /> {t('edit.duplicate')}</Button>
          <Button id="btnDetachAudio" variant="outline" size="xs" disabled={!single || single.kind === 'text'} title={t('edit.detachAudioHint')} onClick={actions.detachAudio}><Music /> {t('edit.detachAudio')}</Button>
        </div>
        <div className="flex items-center gap-1">
          <Button id="btnAddVideoTrack" variant="outline" size="xs" onClick={() => actions.addTrack('video')}>＋🎞 {t('track.addVideo')}</Button>
          <Button id="btnAddAudioTrack" variant="outline" size="xs" onClick={() => actions.addTrack('audio')}>＋🎵 {t('track.addAudio')}</Button>
          <Button id="btnAddText" variant="outline" size="xs" title={t('text.addHint')} onClick={actions.addText}><Type /> {t('text.add')}</Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Label className="text-muted-foreground gap-1.5 text-xs"><Switch id="snapToggle" checked={snap} onCheckedChange={setSnap} /> {t('timeline.snap')}</Label>
          <Button id="btnZoomOut" variant="ghost" size="icon-xs" title={t('timeline.zoomOut')} onClick={() => timelineRef.current?.zoomBy(1 / 1.3, player.currentTime)}><ZoomOut /></Button>
          <Slider id="zoomSlider" className="w-32" min={0} max={100} step={1} value={[zoom]} onValueChange={(v) => { setZoom(v[0]); timelineRef.current?.setZoomSlider(v[0]); }} />
          <Button id="btnZoomIn" variant="ghost" size="icon-xs" title={t('timeline.zoomIn')} onClick={() => timelineRef.current?.zoomBy(1.3, player.currentTime)}><ZoomIn /></Button>
          <Button id="btnZoomFit" variant="ghost" size="xs" title={t('timeline.zoomFit')} onClick={() => timelineRef.current?.zoomFit()}>⤢</Button>
        </div>
      </div>
      <ContextMenu onOpenChange={(open) => { if (open) menuOpenedAt.current = performance.now(); else setMenuClip(null); }}>
        <ContextMenuTrigger asChild>
          <div
            ref={refs.body} className="tl-body" id="tlBody"
            onContextMenuCapture={(e) => {
              const el = (e.target as HTMLElement).closest('.clip') as HTMLElement | null;
              const id = el?.dataset.clipId || null;
              if (!id) { e.preventDefault(); e.stopPropagation(); return; }
              if (!store.selection.clipIds.has(id)) store.selectClips([id]);
              setMenuClip(id);
            }}
          >
            <div className="tl-corner" />
            <div ref={refs.rulerWrap} className="tl-ruler-wrap" id="tlRulerWrap"><canvas ref={refs.ruler} id="tlRuler" /></div>
            <div ref={refs.headers} className="tl-headers" id="tlHeaders" />
            <div ref={refs.lanes} className="tl-lanes" id="tlLanes"><div ref={refs.lanesInner} className="tl-lanes-inner" id="tlLanesInner" /></div>
            <div ref={refs.playhead} className="tl-playhead" id="tlPlayhead"><div className="tl-playhead-cap" /></div>
          </div>
        </ContextMenuTrigger>
        {(
          <ContextMenuContent
            id="contextMenu" className="w-56"
            // On Linux/macOS the browser fires `contextmenu` on mouse-down; the following mouse-up would land on the
            // item under the pointer when the menu had to shift to stay on screen and select it. Ignore that first release.
            onPointerUpCapture={(e) => { if (performance.now() - menuOpenedAt.current < 300) { e.preventDefault(); e.stopPropagation(); } }}
          >
            <ContextMenuItem onSelect={actions.split}>✂ {t('menu.split')}</ContextMenuItem>
            <ContextMenuItem onSelect={actions.duplicate}>⧉ {t('menu.duplicate')}</ContextMenuItem>
            {menu?.kind !== 'text' && <ContextMenuItem onSelect={actions.detachAudio}>🎵 {t('menu.detach')}</ContextMenuItem>}
            <ContextMenuItem onSelect={actions.crossfade}>⟋ {t('menu.crossfade')}</ContextMenuItem>
            <ContextMenuItem onSelect={() => { if (menu) store.updateClip(menu.id, { muted: !menu.muted }); }}>{menu?.muted ? '🔊 ' + t('menu.unmute') : '🔇 ' + t('menu.mute')}</ContextMenuItem>
            {menu?.mediaId && <ContextMenuItem onSelect={() => actions.revealMedia(menu.mediaId!)}>🔍 {t('menu.selectMedia')}</ContextMenuItem>}
            <ContextMenuSeparator />
            <ContextMenuItem variant="destructive" onSelect={actions.deleteSelected}>🗑 {t('menu.delete')}</ContextMenuItem>
          </ContextMenuContent>
        )}
      </ContextMenu>
    </section>
  );
}
