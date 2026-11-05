import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { useEditor, useI18n } from '../hooks/useEditor';
import type { LoudnessReading } from '../engine/loudness';
import { cn } from '@/lib/utils';

type ScopeMode = 'waveform' | 'parade' | 'vectorscope' | 'histogram';
const MODES: ScopeMode[] = ['waveform', 'parade', 'vectorscope', 'histogram'];
const TARGETS = [-14, -16, -23, -24];
const SAMPLE_W = 240;

/**
 * Video scopes of the composed frame (waveform, RGB parade, vectorscope, histogram) and loudness
 * meters of the programme mix – the monitoring FilmCraft puts beside its program monitor.
 */
export function ScopesPanel() {
  const { player } = useEditor();
  const { t } = useI18n();
  const [mode, setMode] = useState<ScopeMode>(() => { try { return (localStorage.getItem('veditor.scope') as ScopeMode) || 'waveform'; } catch { return 'waveform'; } });
  const [target, setTarget] = useState(-14);
  const [loud, setLoud] = useState<LoudnessReading | null>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { try { localStorage.setItem('veditor.scope', mode); } catch { /* private mode */ } }, [mode]);

  // the scope follows the picture about ten times a second while it is on screen
  useEffect(() => {
    const sample = document.createElement('canvas');
    let last = '';
    const timer = setInterval(() => {
      const out = scopeRef.current;
      if (!out || !out.offsetParent) return;
      const src = player.canvas;
      const key = `${player.currentTime.toFixed(3)}|${mode}|${src.width}`;
      if (!player.playing && key === last) return;
      last = key;
      drawScope(out, src, sample, mode);
    }, 110);
    return () => clearInterval(timer);
  }, [player, mode]);

  // loudness of the mix while it plays; a play from the start begins a new integrated reading
  useEffect(() => {
    const offPlay = player.on('play', () => { if (player.currentTime < 0.05) player.meter?.reset(); });
    const timer = setInterval(() => { if (player.playing && player.meter) setLoud(player.meter.sample()); }, 100);
    return () => { offPlay(); clearInterval(timer); };
  }, [player]);

  return (
    <aside className="bg-card flex min-h-0 min-w-0 flex-col" id="scopesPanel">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 className="text-sm font-semibold">{t('scopes.title')}</h2>
        <NativeSelect id="scopeMode" size="sm" value={mode} onChange={(e) => setMode(e.target.value as ScopeMode)}>
          {MODES.map((m) => <NativeSelectOption key={m} value={m}>{t('scopes.' + m)}</NativeSelectOption>)}
        </NativeSelect>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3">
        <canvas ref={scopeRef} id="scopeCanvas" data-mode={mode} width={512} height={mode === 'vectorscope' ? 512 : 256} className={cn('w-full rounded-md border bg-black', mode === 'vectorscope' && 'mx-auto max-w-[280px]')} />
        <LoudnessMeters reading={loud} target={target} onTarget={setTarget} onReset={() => { player.meter?.reset(); setLoud(null); }} playing={player.playing} />
      </div>
    </aside>
  );
}

const fmt = (v: number | undefined, d = 1) => (v == null || !isFinite(v) ? '—' : v.toFixed(d));

function LoudnessMeters({ reading: r, target, onTarget, onReset, playing }: { reading: LoudnessReading | null; target: number; onTarget: (v: number) => void; onReset: () => void; playing: boolean }) {
  const { t } = useI18n();
  const bar = (v: number | undefined, label: string, id: string, unit: string, lo = -60, hi = 0) => {
    const p = v == null || !isFinite(v) ? 0 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    const tp = (target - lo) / (hi - lo);
    const ok = v != null && isFinite(v) && Math.abs(v - target) <= 1;
    const hot = v != null && v > target + 1;
    return (
      <div className="flex items-center gap-2 text-xs" data-testid={id}>
        <span className="text-muted-foreground w-24 shrink-0">{label}</span>
        <div className="bg-muted relative h-2.5 flex-1 overflow-hidden rounded">
          <div className={cn('absolute inset-y-0 left-0', hot ? 'bg-red-500' : ok ? 'bg-emerald-500' : 'bg-sky-500')} style={{ width: `${p * 100}%` }} />
          {unit === 'LUFS' && <div className="absolute inset-y-0 w-px bg-white/70" style={{ left: `${tp * 100}%` }} />}
        </div>
        <span id={id} className="w-20 text-right tabular-nums">{fmt(v)} {unit}</span>
      </div>
    );
  };
  return (
    <div id="loudnessMeter" className="flex flex-col gap-1.5" data-playing={playing}>
      <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">{t('loud.title')}</span>
      <div className="flex items-center gap-1.5">
        <NativeSelect id="loudTarget" size="sm" className="min-w-0 flex-1" value={String(target)} onChange={(e) => onTarget(Number(e.target.value))} title={t('loud.target')}>
          {TARGETS.map((v) => <NativeSelectOption key={v} value={String(v)}>{t('loud.target.' + -v)}</NativeSelectOption>)}
        </NativeSelect>
        <Button id="btnLoudReset" size="sm" variant="outline" className="h-8" title={t('loud.reset')} onClick={onReset}>⟲</Button>
      </div>
      {bar(r?.momentary, t('loud.momentary'), 'loudM', 'LUFS')}
      {bar(r?.shortTerm, t('loud.shortTerm'), 'loudS', 'LUFS')}
      {bar(r?.integrated, t('loud.integrated'), 'loudI', 'LUFS')}
      {bar(r?.peak[0], t('loud.peakL'), 'peakL', 'dBFS', -60, 3)}
      {bar(r?.peak[1], t('loud.peakR'), 'peakR', 'dBFS', -60, 3)}
      <p className="text-muted-foreground text-xs leading-relaxed">{t('loud.hint', { max: fmt(r?.maxPeak) })}</p>
    </div>
  );
}

/** Draws one scope of `src` into `out`, from a small copy of the frame. */
function drawScope(out: HTMLCanvasElement, src: HTMLCanvasElement, sample: HTMLCanvasElement, mode: ScopeMode) {
  const sw = SAMPLE_W, sh = Math.max(1, Math.round(SAMPLE_W * (src.height / Math.max(1, src.width))));
  if (sample.width !== sw || sample.height !== sh) { sample.width = sw; sample.height = sh; }
  const sg = sample.getContext('2d', { willReadFrequently: true })!;
  sg.drawImage(src, 0, 0, sw, sh);
  const px = sg.getImageData(0, 0, sw, sh).data;
  const g = out.getContext('2d')!;
  const W = out.width, H = out.height;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  if (mode === 'vectorscope') return vectorscope(g, px, W, H);
  if (mode === 'histogram') return histogram(g, px, W, H);
  const cols = mode === 'parade' ? sw * 3 : sw;
  const acc = new Float32Array(cols * 256 * 3);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const i = (y * sw + x) * 4, r = px[i], gg = px[i + 1], b = px[i + 2];
    if (mode === 'waveform') {
      const l = Math.round(0.2126 * r + 0.7152 * gg + 0.0722 * b);
      const j = (l * cols + x) * 3; acc[j] += 0.6; acc[j + 1] += 1; acc[j + 2] += 0.6;
    } else {
      acc[(r * cols + x) * 3] += 1;
      acc[(gg * cols + x + sw) * 3 + 1] += 1;
      acc[(b * cols + x + sw * 2) * 3 + 2] += 1;
    }
  }
  const img = new ImageData(cols, 256);
  const k = 4 / Math.max(1, sh);
  for (let lv = 0; lv < 256; lv++) for (let x = 0; x < cols; x++) {
    const j = (lv * cols + x) * 3, o = ((255 - lv) * cols + x) * 4;
    img.data[o] = 255 * (1 - Math.exp(-acc[j] * k)); img.data[o + 1] = 255 * (1 - Math.exp(-acc[j + 1] * k)); img.data[o + 2] = 255 * (1 - Math.exp(-acc[j + 2] * k)); img.data[o + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = cols; tmp.height = 256;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.drawImage(tmp, 0, 0, W, H);
  // graticule: 0, 25, 50, 75 and 100 %
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.fillStyle = 'rgba(255,255,255,.45)'; g.font = '10px sans-serif'; g.lineWidth = 1;
  for (const v of [0, 25, 50, 75, 100]) {
    const y = Math.round(H - 1 - (v / 100) * (H - 1)) + 0.5;
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    g.fillText(String(v), 3, Math.min(H - 3, Math.max(10, y - 2)));
  }
  if (mode === 'parade') for (const x of [W / 3, (2 * W) / 3]) { g.beginPath(); g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, H); g.stroke(); }
}

function vectorscope(g: CanvasRenderingContext2D, px: Uint8ClampedArray, W: number, H: number) {
  const N = 256, acc = new Float32Array(N * N * 3);
  const cx = N / 2, R = N * 0.45;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255, gg = px[i + 1] / 255, b = px[i + 2] / 255;
    const cb = -0.1146 * r - 0.3854 * gg + 0.5 * b, cr = 0.5 * r - 0.4542 * gg - 0.0458 * b;
    const x = Math.round(cx + cb * 2 * R), y = Math.round(cx - cr * 2 * R);
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    const j = (y * N + x) * 3;
    acc[j] += 0.4 + r; acc[j + 1] += 0.4 + gg; acc[j + 2] += 0.4 + b;
  }
  const img = new ImageData(N, N);
  for (let p = 0; p < N * N; p++) {
    img.data[p * 4] = 255 * (1 - Math.exp(-acc[p * 3] * 0.15)); img.data[p * 4 + 1] = 255 * (1 - Math.exp(-acc[p * 3 + 1] * 0.15)); img.data[p * 4 + 2] = 255 * (1 - Math.exp(-acc[p * 3 + 2] * 0.15)); img.data[p * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas'); tmp.width = N; tmp.height = N;
  tmp.getContext('2d')!.putImageData(img, 0, 0);
  g.drawImage(tmp, 0, 0, W, H);
  const k = W / N;
  g.strokeStyle = 'rgba(255,255,255,.22)'; g.lineWidth = 1;
  for (const f of [0.25, 0.5, 1]) { g.beginPath(); g.arc(cx * k, cx * k, R * k * f, 0, Math.PI * 2); g.stroke(); }
  g.beginPath(); g.moveTo(cx * k, 0); g.lineTo(cx * k, H); g.moveTo(0, cx * k); g.lineTo(W, cx * k); g.stroke();
  // targets of 75 % colour bars, and the skin-tone line
  g.font = '11px sans-serif'; g.fillStyle = 'rgba(255,255,255,.6)';
  for (const [name, r, gg, b] of [['R', 0.75, 0, 0], ['Mg', 0.75, 0, 0.75], ['B', 0, 0, 0.75], ['Cy', 0, 0.75, 0.75], ['G', 0, 0.75, 0], ['Yl', 0.75, 0.75, 0]] as [string, number, number, number][]) {
    const cb = -0.1146 * r - 0.3854 * gg + 0.5 * b, cr = 0.5 * r - 0.4542 * gg - 0.0458 * b;
    const x = (cx + cb * 2 * R) * k, y = (cx - cr * 2 * R) * k;
    g.strokeRect(x - 6, y - 6, 12, 12); g.fillText(name, x + 8, y + 4);
  }
  g.strokeStyle = 'rgba(255,190,120,.45)';
  const a = (123 * Math.PI) / 180;
  g.beginPath(); g.moveTo(cx * k, cx * k); g.lineTo(cx * k + Math.cos(a) * R * k, cx * k - Math.sin(a) * R * k); g.stroke();
}

function histogram(g: CanvasRenderingContext2D, px: Uint8ClampedArray, W: number, H: number) {
  const bins = [new Float32Array(256), new Float32Array(256), new Float32Array(256)];
  for (let i = 0; i < px.length; i += 4) { bins[0][px[i]]++; bins[1][px[i + 1]]++; bins[2][px[i + 2]]++; }
  const max = Math.max(1, ...bins.map((b) => Math.max(...b.slice(1, 255))));
  g.globalCompositeOperation = 'lighter';
  ['rgba(255,60,60,.7)', 'rgba(60,255,60,.7)', 'rgba(70,120,255,.8)'].forEach((col, c) => {
    g.fillStyle = col;
    g.beginPath(); g.moveTo(0, H);
    for (let v = 0; v < 256; v++) g.lineTo((v / 255) * W, H - Math.min(1, bins[c][v] / max) * (H - 4));
    g.lineTo(W, H); g.closePath(); g.fill();
  });
  g.globalCompositeOperation = 'source-over';
}
