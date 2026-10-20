import { useEffect, useRef, useState } from 'react';
import { Check, Crop, RotateCw } from 'lucide-react';
import { useEditor, useI18n, useStoreEvents } from '../hooks/useEditor';
import { animatedAt, keyedPatch } from '../engine/keyframes';
import type { Clip } from '../engine/types';

/** The layer's frame in stage pixels: its rectangle before rotation, the rotation, and (cropped media) the uncropped picture relative to it. */
interface Box { left: number; top: number; width: number; height: number; rotation: number; full: { left: number; top: number; width: number; height: number } | null }
type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Edge = 'n' | 's' | 'e' | 'w';
type Mode = 'move' | 'rotate' | Corner | `crop-${Edge | Corner}`;

interface Drag {
  snap: string; moved: boolean; clip: Clip; mode: Mode; sx: number; sy: number;
  x0: number; y0: number; s0: number; r0: number; a0: number; cx: number; cy: number; d0: number; k: number;
  crop0: { l: number; t: number; r: number; b: number }; fullW: number; fullH: number;
}

const round = (v: number, n = 10) => Math.round(v * n) / n;

/**
 * A frame over the preview around the selected visual layer: drag it to move the layer, drag a
 * corner to resize it, drag the round handle above it to rotate it. In crop mode the edges and
 * corners cut the picture instead. It edits the same values the inspector shows (as keyframes when
 * the layer is animated), so the two stay in step. Pointer events cover mouse, pen and touch alike.
 */
export function TransformOverlay({ stage }: { stage: React.RefObject<HTMLDivElement | null> }) {
  const { store, player, canvas } = useEditor();
  const { t } = useI18n();
  useStoreEvents(['change', 'selection', 'crop']);
  const [box, setBox] = useState<Box | null>(null);
  const drag = useRef<Drag | null>(null);

  const selected = store.selectedClips();
  const clip = selected.length === 1 ? selected[0] : null;
  const track = clip ? store.getTrack(clip.trackId) : null;
  const editable = !!clip && !!track && track.kind === 'video' && !track.locked && !track.hidden;
  const canCrop = !!clip && clip.kind === 'media';
  const cropping = canCrop && store.cropClipId === clip!.id;

  // crop mode belongs to one selected layer; selecting something else ends it
  useEffect(() => {
    if (store.cropClipId && (!clip || clip.id !== store.cropClipId || !editable)) store.setCropMode(null);
  });

  // follow the playhead, the panel size and the layer itself, once per frame while it is shown
  useEffect(() => {
    if (!editable || !clip) { setBox(null); return; }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = stage.current;
      const tm = player.currentTime;
      const active = tm >= clip.start && tm < clip.start + clip.duration;
      const f = active && st ? player.clipFrame(clip, tm) : null;
      if (!f || !st) { setBox((old) => (old ? null : old)); return; }
      const cr = canvas.getBoundingClientRect(), sr = st.getBoundingClientRect();
      const k = cr.width / (store.project.width || 1);
      const next: Box = {
        left: cr.left - sr.left + f.x * k, top: cr.top - sr.top + f.y * k, width: f.w * k, height: f.h * k, rotation: f.rotation,
        full: f.full ? { left: (f.full.x - f.x) * k, top: (f.full.y - f.y) * k, width: f.full.w * k, height: f.full.h * k } : null,
      };
      setBox((old) => (old && same(old, next) ? old : next));
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [editable, clip, player, canvas, stage, store]);

  if (!box || !clip) return null;

  const begin = (e: React.PointerEvent, mode: Mode) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const cr = canvas.getBoundingClientRect();
    const k = cr.width / (store.project.width || 1);
    // centre of the layer in client coordinates
    const sr = stage.current!.getBoundingClientRect();
    const ccx = sr.left + box.left + box.width / 2, ccy = sr.top + box.top + box.height / 2;
    const now = animatedAt(clip, player.currentTime);
    drag.current = {
      snap: store.snapshot(), moved: false, clip, mode, sx: e.clientX, sy: e.clientY, x0: now.x, y0: now.y, s0: now.scale, r0: now.rotation,
      a0: Math.atan2(e.clientY - ccy, e.clientX - ccx), cx: ccx, cy: ccy, d0: Math.max(4, Math.hypot(e.clientX - ccx, e.clientY - ccy)), k,
      crop0: { l: clip.cropL, t: clip.cropT, r: clip.cropR, b: clip.cropB }, fullW: box.full?.width ?? box.width, fullH: box.full?.height ?? box.height,
    };
  };
  const set = (d: Drag, patch: Partial<Clip>) => {
    const cur = store.getClip(d.clip.id);
    if (!cur) return;
    store.updateClip(cur.id, keyedPatch(cur, patch, player.currentTime), { silent: true, history: false });
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // one undo step per gesture, and none for a plain click
    if (!d.moved) { d.moved = true; store.pushHistory(d.snap); }
    const W = store.project.width, H = store.project.height;
    if (d.mode === 'move') {
      let x = d.x0 + ((e.clientX - d.sx) / d.k / W) * 100;
      let y = d.y0 + ((e.clientY - d.sy) / d.k / H) * 100;
      // snap to the centre lines, which is where a layer most often belongs
      if (!e.shiftKey) { if (Math.abs(x) < 1.5) x = 0; if (Math.abs(y) < 1.5) y = 0; }
      set(d, { x: round(x), y: round(y) });
    } else if (d.mode === 'rotate') {
      let deg = d.r0 + ((Math.atan2(e.clientY - d.cy, e.clientX - d.cx) - d.a0) * 180) / Math.PI;
      deg = ((deg + 540) % 360) - 180;
      // shift turns in 15° steps; otherwise the right angles pull the layer in
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      else { const near = Math.round(deg / 90) * 90; if (Math.abs(deg - near) < 3) deg = near; }
      set(d, { rotation: round(deg) });
    } else if (d.mode.startsWith('crop-')) {
      cropMove(d, e);
    } else {
      const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
      const scale = Math.min(10, Math.max(0.05, d.s0 * (dist / d.d0)));
      set(d, { scale: Math.round(scale * 100) / 100 });
    }
    // the inspector listens for changes; keep it current without adding history entries
    store.emit('change', { reason: 'transform-live' });
  };
  /** Dragging an edge (or corner) in crop mode cuts that side of the picture, in the layer's own rotated frame. */
  const cropMove = (d: Drag, e: React.PointerEvent) => {
    const side = d.mode.slice(5);
    const a = (-box.rotation * Math.PI) / 180;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
    const fx = (lx / Math.max(1, d.fullW)) * 100, fy = (ly / Math.max(1, d.fullH)) * 100;
    // a mirrored layer shows its source's right side on the left
    const L = d.clip.flipH ? 'cropR' : 'cropL', R = d.clip.flipH ? 'cropL' : 'cropR';
    const T = d.clip.flipV ? 'cropB' : 'cropT', B = d.clip.flipV ? 'cropT' : 'cropB';
    const c0 = { cropL: d.crop0.l, cropT: d.crop0.t, cropR: d.crop0.r, cropB: d.crop0.b };
    const patch: Partial<Clip> = {};
    const lim = (v: number, other: number) => round(Math.min(Math.max(0, v), 95 - other));
    if (side.includes('w')) patch[L] = lim(c0[L] + fx, c0[R]);
    if (side.includes('e')) patch[R] = lim(c0[R] - fx, c0[L]);
    if (side.includes('n')) patch[T] = lim(c0[T] + fy, c0[B]);
    if (side.includes('s')) patch[B] = lim(c0[B] - fy, c0[T]);
    store.updateClip(d.clip.id, patch, { silent: true, history: false });
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved) store.changed('transform');
  };
  const handlers = (mode: Mode) => ({ onPointerDown: (e: React.PointerEvent) => begin(e, mode), onPointerMove: move, onPointerUp: end, onPointerCancel: end });

  const corners: Corner[] = ['nw', 'ne', 'sw', 'se'];
  const edges: Edge[] = ['n', 's', 'e', 'w'];
  const pos = (c: string) => ({
    left: c.includes('w') ? 0 : c.includes('e') ? '100%' : '50%',
    top: c.includes('n') ? 0 : c.includes('s') ? '100%' : '50%',
  });
  // a layer filling the frame leaves no room above it: the rotate handle then hangs inside the box
  const inside = box.top < 40;
  const btn = 'absolute grid size-6 place-items-center rounded-full border border-sky-400 bg-neutral-900/90 text-sky-300 shadow hover:bg-sky-500 hover:text-white max-[900px]:size-8 [&_svg]:size-3.5';
  return (
    <div
      id="transformBox"
      data-testid="transform-box"
      data-rotation={box.rotation}
      data-crop={cropping ? 'on' : 'off'}
      className={cropping ? 'absolute z-10 touch-none border-2 border-dashed border-amber-400' : 'absolute z-10 cursor-move touch-none border-2 border-sky-400 shadow-[0_0_0_1px_rgba(0,0,0,.6)]'}
      style={{ left: box.left, top: box.top, width: Math.max(8, box.width), height: Math.max(8, box.height), transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined }}
      {...(cropping ? {} : handlers('move'))}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { if (cropping) { e.stopPropagation(); store.setCropMode(null); } }}
    >
      {cropping && box.full && (
        // the part that is cut away, for orientation
        <div className="pointer-events-none absolute border border-dashed border-white/50 bg-white/5" data-testid="crop-full"
          style={{ left: box.full.left, top: box.full.top, width: box.full.width, height: box.full.height }} />
      )}
      {!cropping && (
        <>
          <div className={inside ? 'pointer-events-none absolute left-1/2 top-0 h-6 w-px bg-sky-400 max-[900px]:h-8' : 'pointer-events-none absolute left-1/2 -top-6 h-6 w-px bg-sky-400 max-[900px]:-top-8 max-[900px]:h-8'} />
          <div
            id="rotateHandle"
            data-testid="rotate-handle"
            title={t('crop.rotateHint')}
            className={(inside ? 'top-7 max-[900px]:top-9 ' : '-top-7 max-[900px]:-top-9 ') + 'absolute left-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center rounded-full border-2 border-sky-400 bg-white text-sky-600 max-[900px]:size-7 [&_svg]:size-3'}
            {...handlers('rotate')}
          ><RotateCw /></div>
        </>
      )}
      {corners.map((c) => (
        <div
          key={c}
          data-corner={c}
          className={cropping ? 'absolute size-3.5 border-2 border-amber-400 bg-neutral-900 max-[900px]:size-5' : 'absolute size-4 rounded-full border-2 border-sky-400 bg-white max-[900px]:size-6'}
          style={{ ...pos(c), transform: 'translate(-50%, -50%)', cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize' }}
          {...handlers(cropping ? `crop-${c}` : c)}
        />
      ))}
      {cropping && edges.map((c) => (
        <div
          key={c}
          data-edge={c}
          className="absolute rounded-sm border border-neutral-900 bg-amber-400 max-[900px]:scale-150"
          style={{ ...pos(c), width: c === 'n' || c === 's' ? 22 : 6, height: c === 'n' || c === 's' ? 6 : 22, transform: 'translate(-50%, -50%)', cursor: c === 'n' || c === 's' ? 'ns-resize' : 'ew-resize' }}
          {...handlers(`crop-${c}`)}
        />
      ))}
      {canCrop && (
        <button
          type="button"
          id="btnCanvasCrop"
          title={cropping ? t('crop.done') : t('crop.onCanvas')}
          className={btn}
          style={{ right: 8, top: 8 }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); store.setCropMode(cropping ? null : clip.id); }}
        >{cropping ? <Check /> : <Crop />}</button>
      )}
    </div>
  );
}

function same(a: Box, b: Box) {
  const near = (u: number, v: number) => Math.abs(u - v) < 0.5;
  if (!near(a.left, b.left) || !near(a.top, b.top) || !near(a.width, b.width) || !near(a.height, b.height) || Math.abs(a.rotation - b.rotation) > 0.05) return false;
  if (!a.full || !b.full) return a.full === b.full;
  return near(a.full.left, b.full.left) && near(a.full.top, b.full.top) && near(a.full.width, b.full.width) && near(a.full.height, b.full.height);
}
