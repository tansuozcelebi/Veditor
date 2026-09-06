import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Maximize2, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useEditor, useI18n, usePlayerTime, useStoreEvents } from '../hooks/useEditor';
import { formatTime } from '../engine/state';

export function Preview({ recording }: { recording?: boolean }) {
  const { player, canvas, store } = useEditor();
  const { t } = useI18n();
  const { time, playing } = usePlayerTime();
  useStoreEvents(['change']);
  const stageRef = useRef<HTMLDivElement>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);

  useEffect(() => {
    const stage = stageRef.current!;
    canvas.className = 've-preview-canvas';
    canvas.onclick = () => void player.toggle();
    stage.appendChild(canvas);
    return () => { canvas.remove(); };
  }, [canvas, player]);

  const total = store.projectDuration();
  return (
    <section className="flex min-h-0 min-w-0 flex-col" id="previewPanel">
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center p-3" id="previewStage">
        {recording && <div className="rec-indicator absolute top-4 right-4 rounded-md bg-black/70 px-2.5 py-1.5 text-xs text-white">REC</div>}
      </div>
      <div className="bg-card grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-t px-3 py-1.5">
        <div className="flex items-center">
          <Button id="btnGoStart" variant="ghost" size="icon-sm" title={t('player.goStart')} onClick={() => player.seek(0)}><SkipBack /></Button>
          <Button id="btnBack5" variant="ghost" size="icon-sm" title={t('player.back5')} onClick={() => player.seek(player.currentTime - 5)}>-5</Button>
          <Button id="btnPrevFrame" variant="ghost" size="icon-sm" title={t('player.prevFrame')} onClick={() => player.stepFrame(-1)}><ChevronLeft /></Button>
          <Button id="btnPlay" variant="secondary" size="icon" title={t('player.play')} onClick={() => void player.toggle()}>{playing ? <Pause /> : <Play />}</Button>
          <Button id="btnNextFrame" variant="ghost" size="icon-sm" title={t('player.nextFrame')} onClick={() => player.stepFrame(1)}><ChevronRight /></Button>
          <Button id="btnFwd5" variant="ghost" size="icon-sm" title={t('player.fwd5')} onClick={() => player.seek(player.currentTime + 5)}>+5</Button>
          <Button id="btnGoEnd" variant="ghost" size="icon-sm" title={t('player.goEnd')} onClick={() => player.seek(player.duration)}><SkipForward /></Button>
        </div>
        <div className="flex items-center gap-1.5 font-mono text-sm tabular-nums">
          <span id="timeCurrent">{formatTime(time)}</span>
          <span className="text-muted-foreground">/</span>
          <span id="timeTotal" className="text-muted-foreground">{formatTime(total)}</span>
        </div>
        <div className="flex items-center justify-end gap-2">
          <div className="w-36"><NativeSelect id="viewMode" size="sm" defaultValue="composite" onChange={(e) => { player.viewMode = e.target.value as 'composite' | 'grid'; }} title={t('player.viewMode')}>
            <NativeSelectOption value="composite">{t('player.composite')}</NativeSelectOption>
            <NativeSelectOption value="grid">{t('player.grid')}</NativeSelectOption>
          </NativeSelect></div>
          <Button id="btnMonitorMute" variant="ghost" size="icon-sm" title={t('player.mute')} onClick={() => { player.ensureAudio(); const m = !muted; setMuted(m); player.setMonitorMuted(m); }}>{muted ? <VolumeX /> : <Volume2 />}</Button>
          <Slider id="monitorVolume" className="w-20" min={0} max={1} step={0.01} value={[volume]} onValueChange={(v) => { player.ensureAudio(); setVolume(v[0]); player.setMonitorVolume(v[0]); }} />
          <Button id="btnFullscreen" variant="ghost" size="icon-sm" title={t('player.fullscreen')} onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void stageRef.current?.requestFullscreen?.(); }}><Maximize2 /></Button>
        </div>
      </div>
    </section>
  );
}
