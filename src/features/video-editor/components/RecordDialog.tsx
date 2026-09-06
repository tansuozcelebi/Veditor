import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useEditor, useI18n } from '../hooks/useEditor';
import { formatTime } from '../engine/state';

export function RecordDialog({ open, onOpenChange, onRecorded }: { open: boolean; onOpenChange: (o: boolean) => void; onRecorded: (file: File, info: { startPos: number; addToTimeline: boolean }) => void }) {
  const { store, player } = useEditor();
  const { t } = useI18n();
  const [playWhile, setPlayWhile] = useState(true);
  const [addToTimeline, setAdd] = useState(true);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const st = useRef<{ stream?: MediaStream; recorder?: MediaRecorder; chunks: Blob[]; startPos: number; timer?: number; raf?: number }>({ chunks: [], startPos: 0 });

  const cleanup = useCallback(() => {
    const s = st.current;
    if (s.raf) cancelAnimationFrame(s.raf); if (s.timer) clearInterval(s.timer);
    s.stream?.getTracks().forEach((tr) => tr.stop());
    if (player.playing) player.pause();
    st.current = { chunks: [], startPos: 0 };
    setRecording(false); setElapsed(0); setLevel(0);
  }, [player]);
  // Stop any in-progress recording when the dialog closes or unmounts.
  useEffect(() => { if (!open) cleanup(); }, [open, cleanup]);
  useEffect(() => () => cleanup(), [cleanup]);

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { toast.error(t('record.noMic')); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e: any) { toast.error(t(e?.name === 'NotAllowedError' ? 'record.permissionDenied' : 'record.noMic')); return; }
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const s = st.current; s.stream = stream; s.recorder = recorder; s.chunks = []; s.startPos = player.currentTime;
    recorder.ondataavailable = (e) => { if (e.data.size) s.chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(s.chunks, { type: recorder.mimeType || 'audio/webm' });
      const ext = (recorder.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
      const n = [...store.media.values()].filter((m) => m.recorded).length + 1;
      const file = new File([blob], `${t('record.button')} ${n}.${ext}`, { type: blob.type });
      const startPos = s.startPos;
      onOpenChange(false);
      onRecorded(file, { startPos, addToTimeline });
    };
    try {
      const ac = player.ensureAudio(); await player.resumeAudio();
      const src = ac.createMediaStreamSource(stream); const analyser = ac.createAnalyser(); analyser.fftSize = 512; src.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const meter = () => { analyser.getByteTimeDomainData(data); let peak = 0; for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128); setLevel(Math.min(100, peak * 140)); s.raf = requestAnimationFrame(meter); };
      meter();
    } catch { /* level meter is optional */ }
    recorder.start(250);
    setRecording(true);
    const startAt = performance.now();
    s.timer = window.setInterval(() => setElapsed((performance.now() - startAt) / 1000), 100);
    if (playWhile) { player.seek(s.startPos); void player.play(); }
  }
  function stop() {
    const s = st.current; if (!s.recorder || s.recorder.state === 'inactive') return;
    if (s.timer) clearInterval(s.timer); if (s.raf) cancelAnimationFrame(s.raf);
    if (player.playing) player.pause();
    s.recorder.stop(); setRecording(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent id="recordDialog">
        <DialogHeader><DialogTitle>{t('record.dialogTitle')}</DialogTitle><DialogDescription>{t('record.hint')}</DialogDescription></DialogHeader>
        <div className="grid gap-3">
          <Label className="gap-2 text-sm"><Switch id="recPlay" checked={playWhile} disabled={recording} onCheckedChange={setPlayWhile} /> {t('record.playWhile')}</Label>
          <Label className="gap-2 text-sm"><Switch id="recAdd" checked={addToTimeline} disabled={recording} onCheckedChange={setAdd} /> {t('record.addToTimeline')}</Label>
          <div id="recTimer" className="py-2 text-center font-mono text-3xl tabular-nums">{formatTime(elapsed, { ms: false })}.{Math.floor((elapsed % 1) * 10)}</div>
          <div className="bg-muted h-2.5 overflow-hidden rounded-full"><div id="recLevel" className="h-full bg-gradient-to-r from-green-500 via-amber-400 to-red-500" style={{ width: `${level}%` }} /></div>
        </div>
        <DialogFooter>
          {recording ? <Button variant="destructive" data-testid="record-stop" onClick={stop}>⏹ {t('record.stop')}</Button> : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button data-testid="record-start" onClick={() => void start()}>⏺ {t('record.start')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
