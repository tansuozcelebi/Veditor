import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '../hooks/useEditor';
import { curveFn } from '../engine/grade';
import { curveIsIdentity, defaultCurves } from '../engine/state';
import type { CurvePoint, Curves } from '../engine/types';
import { cn } from '@/lib/utils';

type Channel = keyof Curves;
const CHANNELS: Channel[] = ['luma', 'red', 'green', 'blue'];
const COLOR: Record<Channel, string> = { luma: '#f5f5f5', red: '#f87171', green: '#4ade80', blue: '#60a5fa' };
const SIZE = 256;
const path = (pts: CurvePoint[]) => {
  const f = curveFn(pts);
  let d = '';
  for (let i = 0; i <= 64; i++) { const x = i / 64; d += `${i ? 'L' : 'M'}${(x * SIZE).toFixed(1)},${((1 - Math.min(1, Math.max(0, f(x)))) * SIZE).toFixed(1)}`; }
  return d;
};

/**
 * RGB curves: click the graph to add a point, drag a point to bend the curve, double-click a point
 * to remove it. The master curve works on all channels, then each channel's own; the curve passes
 * through every point without overshooting (monotone cubic), as in FilmCraft's curve editor.
 */
export function CurveEditor({ curves, onLive, onCommit }: { curves: Curves; onLive: (c: Curves) => void; onCommit: (c: Curves) => void }) {
  const { t } = useI18n();
  const [ch, setCh] = useState<Channel>('luma');
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ index: number; pts: CurvePoint[]; moved: boolean } | null>(null);
  const [draft, setDraft] = useState<Curves | null>(null);
  const shown = draft ?? curves;
  const pts = shown[ch];

  const at = (e: React.PointerEvent): CurvePoint => {
    const r = svgRef.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))];
  };
  const withPts = (p: CurvePoint[]): Curves => ({ ...shown, [ch]: p });
  const begin = (e: React.PointerEvent, index: number, list: CurvePoint[]) => {
    e.preventDefault(); e.stopPropagation();
    svgRef.current!.setPointerCapture(e.pointerId);
    drag.current = { index, pts: list, moved: false };
    const next = withPts(list);
    setDraft(next); onLive(next);
  };
  const onBackground = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const [x] = at(e);
    // a new point lands on the curve where it was clicked, then follows the pointer
    const y = Math.min(1, Math.max(0, curveFn(pts)(x)));
    const list = [...pts.map((p) => [...p] as CurvePoint), [x, y] as CurvePoint].sort((a, b) => a[0] - b[0]);
    begin(e, list.findIndex((p) => p[0] === x && p[1] === y), list);
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    d.moved = true;
    let [x, y] = at(e);
    // a point stays between its neighbours, so the curve remains a function
    const lo = d.index > 0 ? d.pts[d.index - 1][0] + 0.01 : 0, hi = d.index < d.pts.length - 1 ? d.pts[d.index + 1][0] - 0.01 : 1;
    x = Math.min(hi, Math.max(lo, x));
    y = Math.round(y * 1000) / 1000;
    const list = d.pts.map((p, i) => (i === d.index ? [Math.round(x * 1000) / 1000, y] as CurvePoint : p));
    d.pts = list;
    const next = withPts(list);
    setDraft(next); onLive(next);
  };
  const end = () => {
    if (!drag.current) return;
    const next = withPts(drag.current.pts);
    drag.current = null;
    setDraft(null);
    onCommit(next);
  };
  const remove = (i: number) => {
    if (pts.length <= 2) return;
    onCommit(withPts(pts.filter((_, j) => j !== i)));
  };

  return (
    <div id="curveEditor" className="flex flex-col gap-2" data-channel={ch}>
      <div className="flex items-center gap-1" role="tablist" aria-label={t('curves.channel')}>
        {CHANNELS.map((c) => (
          <button key={c} type="button" role="tab" data-curve={c} aria-selected={ch === c} onClick={() => setCh(c)}
            className={cn('flex items-center gap-1 rounded border px-2 py-0.5 text-xs', ch === c ? 'bg-muted border-white/40' : 'border-transparent text-muted-foreground')}>
            <span className="size-2.5 rounded-full" style={{ background: COLOR[c] }} />{t('curves.' + c)}{!curveIsIdentity(shown[c]) && <span aria-hidden>•</span>}
          </button>
        ))}
      </div>
      <svg
        ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} data-testid="curve-graph"
        className="aspect-square w-full max-w-[260px] cursor-crosshair touch-none self-center rounded-md border bg-black/60"
        onPointerDown={onBackground} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <g key={g} stroke="rgba(255,255,255,.12)">
            <line x1={g * SIZE} y1={0} x2={g * SIZE} y2={SIZE} /><line x1={0} y1={g * SIZE} x2={SIZE} y2={g * SIZE} />
          </g>
        ))}
        <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="rgba(255,255,255,.2)" strokeDasharray="4 4" />
        {CHANNELS.filter((c) => c !== ch && !curveIsIdentity(shown[c])).map((c) => <path key={c} d={path(shown[c])} fill="none" stroke={COLOR[c]} strokeOpacity={0.35} strokeWidth={1.5} />)}
        <path d={path(pts)} fill="none" stroke={COLOR[ch]} strokeWidth={2} />
        {pts.map(([x, y], i) => (
          <circle key={i} data-point={i} cx={x * SIZE} cy={(1 - y) * SIZE} r={7} fill="#111" stroke={COLOR[ch]} strokeWidth={2} className="cursor-grab"
            onPointerDown={(e) => { if (e.button === 0) begin(e, i, pts.map((p) => [...p] as CurvePoint)); }}
            onDoubleClick={(e) => { e.stopPropagation(); remove(i); }} />
        ))}
      </svg>
      <div className="flex flex-wrap gap-1.5">
        <Button id="btnCurveResetChannel" size="xs" variant="outline" disabled={curveIsIdentity(pts)} onClick={() => onCommit(withPts(defaultCurves()[ch]))}>⟲ {t('curves.resetChannel')}</Button>
        <Button id="btnCurveResetAll" size="xs" variant="outline" disabled={CHANNELS.every((c) => curveIsIdentity(shown[c]))} onClick={() => onCommit(defaultCurves())}>⟲ {t('curves.resetAll')}</Button>
      </div>
      <p className="text-muted-foreground text-xs leading-relaxed">{t('curves.hint')}</p>
    </div>
  );
}
