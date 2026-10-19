import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import Hls from 'hls.js';
import { Pause, Play, Radio, RotateCcw, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatTime } from '@/features/video-editor';
import { cn } from '@/lib/utils';
import { useI18n } from '../engine/i18n';

/** Within this many seconds of the live point the stream counts as live. */
const LIVE_SLACK = 3;
const STEP = 10;

interface Timeline {
  /** Earliest position that can be sought to (the start of what is buffered or still listed). */
  start: number;
  /** The live edge for a live stream, the duration otherwise. */
  end: number;
  pos: number;
  live: boolean;
  paused: boolean;
  /**
   * Where "live" is: hls.js deliberately plays a few segments behind the newest one, so that point –
   * not the last segment's end – is what the viewer sees as live. Keeps moving while paused.
   */
  liveAt: number;
}

/**
 * Seeking in a channel. A live HLS stream keeps a window of recent segments (and hls.js keeps what it
 * has already played in a back buffer), so the viewer can step back into it, pause, and catch up
 * again. While paused, the broadcast goes on: the live edge keeps moving away and the bar shows the
 * growing stretch between where the viewer stopped and where the channel now is.
 */
export function TimeshiftBar({ videoRef, hlsRef, enabled, className }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  hlsRef: RefObject<Hls | null>;
  /** Only while a channel is on screen (not a shared screen, not loading). */
  enabled: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const [tl, setTl] = useState<Timeline | null>(null);
  const pausedAt = useRef<{ edge: number; liveAt: number; wall: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const measure = useCallback((): Timeline | null => {
    const v = videoRef.current;
    if (!v || v.readyState < 1) return null;
    const hls = hlsRef.current;
    const details = hls?.latestLevelDetails ?? null;
    const live = details ? details.live : !isFinite(v.duration);
    let start = Infinity, end = 0;
    for (let i = 0; i < v.buffered.length; i++) { start = Math.min(start, v.buffered.start(i)); end = Math.max(end, v.buffered.end(i)); }
    if (details?.fragments.length) { start = Math.min(start, details.fragments[0].start); end = Math.max(end, details.edge); }
    if (!details && v.seekable.length) { start = Math.min(start, v.seekable.start(0)); end = Math.max(end, v.seekable.end(v.seekable.length - 1)); }
    if (!live && isFinite(v.duration)) { start = 0; end = v.duration; }
    if (!isFinite(start)) start = 0;
    let liveAt = hls?.liveSyncPosition ?? end - 1;
    // while paused the broadcast carries on: move the edge and the live point on with the wall clock,
    // never behind what hls.js itself reports
    if (live && v.paused && pausedAt.current) {
      const elapsed = (performance.now() - pausedAt.current.wall) / 1000;
      end = Math.max(end, pausedAt.current.edge + elapsed);
      liveAt = Math.max(liveAt, pausedAt.current.liveAt + elapsed);
    }
    end = Math.max(end, v.currentTime);
    return { start, end, pos: v.currentTime, live, paused: v.paused, liveAt: Math.min(liveAt, end) };
  }, [videoRef, hlsRef]);

  useEffect(() => {
    if (!enabled) { setTl(null); pausedAt.current = null; return; }
    const v = videoRef.current;
    const onPause = () => {
      const m = measure();
      // a viewer playing ahead of hls.js's live point was watching live; that is where the clock starts
      pausedAt.current = m ? { edge: m.end, liveAt: Math.max(m.liveAt, m.pos), wall: performance.now() } : null;
    };
    const onPlay = () => { pausedAt.current = null; };
    v?.addEventListener('pause', onPause);
    v?.addEventListener('play', onPlay);
    if (v?.paused) onPause();
    const timer = setInterval(() => { if (!dragging.current) setTl(measure()); }, 250);
    setTl(measure());
    return () => { clearInterval(timer); v?.removeEventListener('pause', onPause); v?.removeEventListener('play', onPlay); };
  }, [enabled, measure, videoRef]);

  if (!enabled || !tl) return null;

  const span = Math.max(0.001, tl.end - tl.start);
  const pct = (x: number) => `${Math.min(100, Math.max(0, ((x - tl.start) / span) * 100))}%`;
  const behind = tl.live ? Math.max(0, tl.liveAt - tl.pos) : 0;
  const atLive = tl.live && behind <= LIVE_SLACK;

  const seekTo = (time: number) => {
    const v = videoRef.current;
    if (!v) return;
    // a little short of the edge, so the player is not asked for a segment that does not exist yet
    const max = tl.live ? tl.end - 1 : tl.end - 0.05;
    v.currentTime = Math.min(Math.max(time, tl.start), Math.max(tl.start, max));
    setTl((old) => (old ? { ...old, pos: v.currentTime } : old));
  };
  const goLive = () => {
    const v = videoRef.current;
    if (!v) return;
    const target = hlsRef.current?.liveSyncPosition ?? tl.end - 2;
    v.currentTime = Math.max(tl.start, Math.min(target, tl.end - 1));
    void v.play().catch(() => {});
  };
  const toggle = () => { const v = videoRef.current; if (!v) return; if (v.paused) void v.play().catch(() => {}); else v.pause(); };
  const fromPointer = (clientX: number) => {
    const r = barRef.current!.getBoundingClientRect();
    return tl.start + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span;
  };

  return (
    <div
      className={cn('absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-3 pt-6 pb-1.5 text-white max-[900px]:gap-1 max-[900px]:px-2 max-[900px]:pt-4 max-[900px]:pb-1 [&_button]:text-white', className)}
      id="timeshiftBar"
      onClick={(e) => e.stopPropagation()}
      data-live={tl.live}
      data-at-live={atLive}
      data-paused={tl.paused}
      data-behind={behind.toFixed(1)}
      data-range={span.toFixed(1)}
    >
      <Button id="btnTsPlay" variant="ghost" size="icon-sm" title={tl.paused ? t('ts.play') : t('ts.pause')} onClick={toggle}>{tl.paused ? <Play /> : <Pause />}</Button>
      <Button id="btnTsBack" variant="ghost" size="icon-sm" title={t('ts.back', { n: STEP })} onClick={() => seekTo(tl.pos - STEP)} disabled={tl.pos - tl.start < 0.5}><RotateCcw /></Button>
      <Button id="btnTsFwd" variant="ghost" size="icon-sm" title={t('ts.fwd', { n: STEP })} onClick={() => seekTo(tl.pos + STEP)} disabled={tl.live ? atLive : tl.end - tl.pos < 0.5}><RotateCw /></Button>

      <div
        ref={barRef}
        id="timeshiftTrack"
        role="slider"
        tabIndex={0}
        aria-label={t('ts.seek')}
        aria-valuemin={0}
        aria-valuemax={Math.round(span)}
        aria-valuenow={Math.round(tl.pos - tl.start)}
        className="group relative h-6 min-w-0 flex-1 cursor-pointer touch-none"
        onPointerDown={(e) => { dragging.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); seekTo(fromPointer(e.clientX)); }}
        onPointerMove={(e) => { if (dragging.current) seekTo(fromPointer(e.clientX)); }}
        onPointerUp={() => { dragging.current = false; }}
        onPointerCancel={() => { dragging.current = false; }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); seekTo(tl.pos + (e.key === 'ArrowLeft' ? -5 : 5)); }
        }}
      >
        <div className="absolute top-1/2 right-0 left-0 h-1.5 bg-white/25 -translate-y-1/2 rounded-full" />
        {/* the stretch the broadcast has moved on by since the viewer stopped or stepped back */}
        {tl.live && !atLive && (
          <div
            className={cn('ts-ahead absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full', tl.paused && 'ts-ahead-moving')}
            id="timeshiftAhead"
            style={{ left: pct(tl.pos), right: 0 }}
          />
        )}
        <div className={cn('absolute top-1/2 left-0 h-1.5 -translate-y-1/2 rounded-full', atLive ? 'bg-red-500' : 'bg-sky-400')} style={{ width: pct(tl.pos) }} />
        <div className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-400 shadow transition-transform group-hover:scale-125" style={{ left: pct(tl.pos) }} />
        {tl.live && <div className={cn('absolute top-1/2 right-0 size-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-red-500', tl.paused && 'animate-ping')} aria-hidden />}
      </div>

      <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums">
        {tl.live ? (
          atLive
            ? <span id="tsLiveBadge" className="inline-flex items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white"><Radio className="size-3" /> {t('ts.live')}</span>
            : (
              <>
                <span id="tsBehind" className={cn('text-white/80', tl.paused && 'text-amber-300')} title={t('ts.behind', { t: formatTime(behind, { ms: false }) })}>
                  {/* on a phone the words give way to the track; the count and the moving stripe still say it */}
                  {tl.paused && <span className="max-[640px]:hidden">{t('ts.pausedLabel')} </span>}
                  {tl.paused && <Pause className="mr-0.5 inline size-3 min-[641px]:hidden" aria-hidden />}
                  −{formatTime(behind, { ms: false })}
                </span>
                <Button id="btnGoLive" size="xs" variant="outline" className="border-red-500/60 text-red-400 hover:text-red-300 max-[640px]:px-1.5" onClick={goLive} title={t('ts.goLive')}>
                  <Radio /> <span className="max-[640px]:hidden">{t('ts.goLive')}</span>
                </Button>
              </>
            )
        ) : (
          <span id="tsTime" className="text-white/80">{formatTime(tl.pos, { ms: false })} / {formatTime(tl.end, { ms: false })}</span>
        )}
      </div>
    </div>
  );
}
