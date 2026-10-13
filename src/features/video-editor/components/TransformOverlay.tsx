import { useEffect, useRef, useState } from 'react';
import { useEditor, useStoreEvents } from '../hooks/useEditor';
import type { Clip } from '../engine/types';

interface Box { left: number; top: number; width: number; height: number }
type Corner = 'nw' | 'ne' | 'sw' | 'se';

/**
 * A frame over the preview around the selected visual layer: drag it to move the layer, drag a
 * corner to resize it. It edits the same x / y / scale the inspector shows, so the two stay in step.
 * Pointer events cover mouse, pen and touch alike.
 */
export function TransformOverlay({ stage }: { stage: React.RefObject<HTMLDivElement | null> }) {
  const { store, player, canvas } = useEditor();
  useStoreEvents(['change', 'selection']);
  const [box, setBox] = useState<Box | null>(null);
  const drag = useRef<{ snap: string; moved: boolean; clip: Clip; mode: 'move' | Corner; sx: number; sy: number; x0: number; y0: number; s0: number; cx: number; cy: number; d0: number; k: number } | null>(null);

  const selected = store.selectedClips();
  const clip = selected.length === 1 ? selected[0] : null;
  const track = clip ? store.getTrack(clip.trackId) : null;
  const editable = !!clip && !!track && track.kind === 'video' && !track.locked && !track.hidden;

  // follow the playhead, the panel size and the layer itself, once per frame while it is shown
  useEffect(() => {
    if (!editable || !clip) { setBox(null); return; }
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const st = stage.current;
      const t = player.currentTime;
      const active = t >= clip.start && t < clip.start + clip.duration;
      const b = active && st ? player.clipBounds(clip) : null;
      if (!b || !st) { setBox((old) => (old ? null : old)); return; }
      const cr = canvas.getBoundingClientRect(), sr = st.getBoundingClientRect();
      const k = cr.width / (store.project.width || 1);
      const next = { left: cr.left - sr.left + b.x * k, top: cr.top - sr.top + b.y * k, width: b.w * k, height: b.h * k };
      setBox((old) => (old && Math.abs(old.left - next.left) < 0.5 && Math.abs(old.top - next.top) < 0.5 && Math.abs(old.width - next.width) < 0.5 && Math.abs(old.height - next.height) < 0.5 ? old : next));
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [editable, clip, player, canvas, stage, store]);

  if (!box || !clip) return null;

  const begin = (e: React.PointerEvent, mode: 'move' | Corner) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const cr = canvas.getBoundingClientRect();
    const k = cr.width / (store.project.width || 1);
    // centre of the layer in client coordinates
    const sr = stage.current!.getBoundingClientRect();
    const ccx = sr.left + box.left + box.width / 2, ccy = sr.top + box.top + box.height / 2;
    drag.current = { snap: store.snapshot(), moved: false, clip, mode, sx: e.clientX, sy: e.clientY, x0: clip.x, y0: clip.y, s0: clip.scale, cx: ccx, cy: ccy, d0: Math.max(4, Math.hypot(e.clientX - ccx, e.clientY - ccy)), k };
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
      store.updateClip(d.clip.id, { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }, { silent: true, history: false });
    } else {
      const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy);
      const scale = Math.min(10, Math.max(0.05, d.s0 * (dist / d.d0)));
      store.updateClip(d.clip.id, { scale: Math.round(scale * 100) / 100 }, { silent: true, history: false });
    }
    // the inspector listens for changes; keep it current without adding history entries
    store.emit('change', { reason: 'transform-live' });
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (d.moved) store.changed('transform');
  };

  const corners: Corner[] = ['nw', 'ne', 'sw', 'se'];
  return (
    <div
      id="transformBox"
      data-testid="transform-box"
      className="absolute z-10 cursor-move touch-none border-2 border-sky-400 shadow-[0_0_0_1px_rgba(0,0,0,.6)]"
      style={{ left: box.left, top: box.top, width: Math.max(8, box.width), height: Math.max(8, box.height) }}
      onPointerDown={(e) => begin(e, 'move')}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onClick={(e) => e.stopPropagation()}
    >
      {corners.map((c) => (
        <div
          key={c}
          data-corner={c}
          className="absolute size-4 rounded-full border-2 border-sky-400 bg-white max-[900px]:size-6"
          style={{
            left: c.endsWith('w') ? 0 : '100%', top: c.startsWith('n') ? 0 : '100%', transform: 'translate(-50%, -50%)',
            cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
          }}
          onPointerDown={(e) => begin(e, c)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      ))}
    </div>
  );
}
