import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Field } from './Field';
import { useEditor, useI18n } from '../hooks/useEditor';
import { supportedFormats } from '../engine/exporter';
import { RESOLUTIONS, formatBytes, formatDurationShort, formatTime } from '../engine/state';
import type { ExportResult } from '../engine/types';

export function ExportDialog({ open, onOpenChange, onExported }: { open: boolean; onOpenChange: (o: boolean) => void; onExported?: (r: ExportResult, fileName: string) => void }) {
  const { store, exporter } = useEditor();
  const { t } = useI18n();
  const formats = useMemo(() => supportedFormats(), []);
  const p = store.project;
  const duration = store.projectDuration();
  const resList = useMemo(() => [{ label: `${p.width}×${p.height}`, w: p.width, h: p.height }, ...RESOLUTIONS.filter((r) => r.w !== p.width || r.h !== p.height)], [p.width, p.height]);
  const [fmt, setFmt] = useState(0);
  const [res, setRes] = useState(0);
  const [fps, setFps] = useState(p.fps);
  const [quality, setQuality] = useState(6000000);
  const [name, setName] = useState((p.name || 'export').replace(/[\\/:*?"<>|]+/g, '_'));
  const [mute, setMute] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ p: number; text: string } | null>(null);
  const [result, setResult] = useState<{ url: string; fileName: string; video: boolean; size: number } | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  useEffect(() => { if (open) { setName((p.name || 'export').replace(/[\\/:*?"<>|]+/g, '_')); setFps(p.fps); setResult(null); setProgress(null); } }, [open, p.name, p.fps]);

  async function run() {
    const format = formats[fmt]; const r = resList[res];
    const prevW = p.width, prevH = p.height;
    if (r.w !== p.width || r.h !== p.height) { p.width = r.w; p.height = r.h; }
    setRunning(true); setResult(null); setProgress({ p: 0, text: '' });
    try {
      const out = await exporter.run({ format, fps, videoBitrate: quality, audioBitrate: 192000, muteMonitor: mute }, ({ time, duration: d, progress: pr }) => {
        setProgress({ p: pr, text: pr >= 1 ? t('export.finalizing') : t('export.progress', { p: Math.round(pr * 100), t: formatTime(time, { ms: false }), d: formatTime(d, { ms: false }) }) });
      });
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      const url = URL.createObjectURL(out.blob); urlRef.current = url;
      const fileName = `${name || 'export'}.${out.ext}`;
      setResult({ url, fileName, video: format.video, size: out.blob.size });
      setProgress({ p: 1, text: t('export.done', { size: formatBytes(out.blob.size) }) });
      (window as any).__lastExport = { blob: out.blob, duration: out.duration, ext: out.ext };
      toast.success(t('export.done', { size: formatBytes(out.blob.size) }));
      onExported?.(out, fileName);
    } catch (e: any) {
      if (e && e.message === 'cancelled') { setProgress({ p: 0, text: t('export.cancelled') }); toast(t('export.cancelled')); }
      else { console.error(e); setProgress({ p: 0, text: t('export.error', { e: e?.message || e }) }); toast.error(t('export.error', { e: e?.message || e })); }
    } finally {
      setRunning(false);
      if (p.width !== prevW || p.height !== prevH) { p.width = prevW; p.height = prevH; }
    }
  }

  const unsupported = formats.length === 0;
  const empty = duration <= 0;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && running) exporter.cancel(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-xl" id="exportDialog">
        <DialogHeader><DialogTitle>{t('export.title')}</DialogTitle><DialogDescription>{t('export.realtimeNote', { d: formatDurationShort(duration) })}</DialogDescription></DialogHeader>
        {unsupported && <p className="text-destructive text-sm">{t('export.noSupport')}</p>}
        {empty && <p className="text-destructive text-sm">{t('export.empty')}</p>}
        <div className="grid gap-3">
          <Field label={t('export.format')}>
            <NativeSelect id="exFormat" size="sm" value={String(fmt)} disabled={running} onChange={(e) => setFmt(Number(e.target.value))}>
              {formats.map((f, i) => <NativeSelectOption key={f.mime} value={String(i)}>{f.video ? f.label : `${f.label} – ${t('export.audioOnly')}`}</NativeSelectOption>)}
            </NativeSelect>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('export.resolution')}><NativeSelect id="exRes" size="sm" value={String(res)} disabled={running} onChange={(e) => setRes(Number(e.target.value))}>{resList.map((r, i) => <NativeSelectOption key={r.label} value={String(i)}>{r.label}</NativeSelectOption>)}</NativeSelect></Field>
            <Field label={t('export.fps')}><NativeSelect id="exFps" size="sm" value={String(fps)} disabled={running} onChange={(e) => setFps(Number(e.target.value))}>{[24, 25, 30, 50, 60].map((f) => <NativeSelectOption key={f} value={String(f)}>{f}</NativeSelectOption>)}</NativeSelect></Field>
          </div>
          <Field label={t('export.quality')}>
            <NativeSelect id="exQ" size="sm" value={String(quality)} disabled={running} onChange={(e) => setQuality(Number(e.target.value))}>
              <NativeSelectOption value="2000000">{t('export.qLow')}</NativeSelectOption><NativeSelectOption value="6000000">{t('export.qMed')}</NativeSelectOption>
              <NativeSelectOption value="12000000">{t('export.qHigh')}</NativeSelectOption><NativeSelectOption value="25000000">{t('export.qUltra')}</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field label={t('export.filename')}><Input id="exName" className="h-8" value={name} disabled={running} onChange={(e) => setName(e.target.value)} /></Field>
          <Label className="text-muted-foreground gap-2 text-xs"><Switch id="exMute" checked={mute} disabled={running} onCheckedChange={setMute} /> {t('export.muteMonitor')}</Label>
          {progress && (
            <div id="exProgressWrap" className="grid gap-1.5">
              <div className="bg-muted h-2 overflow-hidden rounded-full"><div id="exBar" className="h-full bg-red-500 transition-[width]" style={{ width: `${(progress.p * 100).toFixed(1)}%` }} /></div>
              <p id="exStatus" className="text-muted-foreground text-xs">{progress.text}</p>
            </div>
          )}
          {result && (
            <div id="exResult" className="grid gap-2">
              {result.video ? <video controls src={result.url} className="w-full rounded-md bg-black" /> : <audio controls src={result.url} className="w-full" />}
              <Button asChild><a href={result.url} download={result.fileName}>⬇ {t('export.download')} ({result.fileName})</a></Button>
            </div>
          )}
        </div>
        <DialogFooter>
          {running ? (
            <Button variant="destructive" data-testid="export-cancel" onClick={() => exporter.cancel()}>{t('export.cancel')}</Button>
          ) : (
            <>
              <Button variant="ghost" data-testid="export-close" onClick={() => onOpenChange(false)}>{t('export.close')}</Button>
              <Button data-testid="export-start" disabled={unsupported || empty} onClick={() => void run()}>{t('export.start')}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
