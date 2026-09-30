import { useCallback, useEffect, useRef, useState } from 'react';
import { Circle, Copy, ExternalLink, Maximize2, MonitorUp, PictureInPicture2, RotateCw, Square, Volume2, VolumeX } from 'lucide-react';
import Hls from 'hls.js';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { formatBytes, formatTime } from '@/features/video-editor';
import { cn } from '@/lib/utils';
import type { Channel } from '../engine/catalog';
import { useI18n } from '../engine/i18n';
import { canRecord, captureFrom, startRecording, startSegmentRecording, type Recording } from '../engine/recorder';

type Status = 'idle' | 'loading' | 'playing' | 'error';
/** `errPolicy` is this page's own CSP, so it says nothing about the channel itself. */
export type ErrorKind = 'errCors' | 'errNetwork' | 'errMedia' | 'errPolicy';

const isHls = (url: string) => /\.m3u8(\?|$)/i.test(url);

/**
 * Plays one channel, shares the screen, and records either of them.
 *
 * Most public streams are HLS, which no browser but Safari decodes on its own, so hls.js feeds the
 * segments through Media Source Extensions. That also makes the picture same-origin, which is what
 * lets the recorder capture it at all.
 */
export function StreamPlayer({ channel, onSendToEditor, onFailed, onPlaying, className }: {
  channel: Channel | null;
  /** Hands a finished recording to the host (the editor page) – hidden when not provided. */
  onSendToEditor?: (file: File) => void | Promise<void>;
  /** The stream was refused, unreachable or undecodable; never fired for the page's own CSP. */
  onFailed?: (channel: Channel, reason: Exclude<ErrorKind, 'errPolicy'>) => void;
  /** A picture arrived – whatever was remembered about this channel is out of date. */
  onPlaying?: (channel: Channel) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const shareRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<ReturnType<typeof startRecording> | null>(null);

  const [status, setStatus] = useState<Status>('idle');
  const [errorKind, setErrorKind] = useState<ErrorKind>('errNetwork');
  const [sharing, setSharing] = useState(false);
  const [recordingMs, setRecordingMs] = useState<number | null>(null);
  const [result, setResult] = useState<Recording | null>(null);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [attempt, setAttempt] = useState(0);

  // Kept in a ref so a caller that passes fresh closures cannot restart the stream: the channel
  // effect only registers listeners, which read the ref long after this has run.
  const reportRef = useRef({ onFailed, onPlaying });
  useEffect(() => { reportRef.current = { onFailed, onPlaying }; });

  const teardown = useCallback(() => {
    hlsRef.current?.destroy();
    hlsRef.current = null;
    const video = videoRef.current;
    if (video) { video.removeAttribute('src'); video.srcObject = null; video.load(); }
  }, []);

  // ---------- play the selected channel ----------
  useEffect(() => {
    if (!channel || sharing) return;
    const video = videoRef.current!;
    teardown();
    setStatus('loading');
    let blocked = false;
    const onViolation = (e: SecurityPolicyViolationEvent) => { if (/media|connect|worker/.test(e.effectiveDirective)) blocked = true; };
    document.addEventListener('securitypolicyviolation', onViolation);
    const fail = (kind: ErrorKind) => {
      const final = blocked ? 'errPolicy' : kind;
      setErrorKind(final);
      setStatus('error');
      // a blocked request is this page's policy, not the channel's – it must not mark the channel
      if (final !== 'errPolicy') reportRef.current.onFailed?.(channel, final);
    };

    if (isHls(channel.url) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, backBufferLength: 60, manifestLoadingMaxRetry: 2, fragLoadingMaxRetry: 3, levelLoadingMaxRetry: 2 });
      hlsRef.current = hls;
      hls.on(Hls.Events.MANIFEST_PARSED, () => { void video.play().catch(() => {}); });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          // a blocked cross-origin request surfaces as a response-less network error
          fail(data.response && data.response.code ? 'errNetwork' : 'errCors');
        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          fail('errMedia');
        } else {
          fail('errNetwork');
        }
        hls.destroy();
        if (hlsRef.current === hls) hlsRef.current = null;
      });
      hls.loadSource(channel.url);
      hls.attachMedia(video);
    } else {
      // Safari plays HLS natively; everything else here is a plain file or an MPEG-TS stream
      video.src = channel.url;
      void video.play().catch(() => {});
    }

    const onPlaying = () => { setStatus('playing'); reportRef.current.onPlaying?.(channel); };
    const onError = () => fail(video.error?.code === 4 ? 'errMedia' : 'errNetwork');
    video.addEventListener('playing', onPlaying);
    video.addEventListener('error', onError);
    return () => {
      document.removeEventListener('securitypolicyviolation', onViolation);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('error', onError);
      teardown();
    };
  }, [channel, sharing, attempt, teardown]);

  useEffect(() => { const v = videoRef.current; if (v) { v.muted = muted; v.volume = volume; } }, [muted, volume]);

  // The captured screen is attached here rather than in the click handler: flipping `sharing` also
  // re-runs the channel effect, whose cleanup clears the element – this effect is declared after it,
  // so React applies them in that order and the picture survives.
  useEffect(() => {
    const stream = shareRef.current;
    const video = videoRef.current;
    if (!sharing || !stream || !video) return;
    video.srcObject = stream;
    void video.play().catch(() => {});
    return () => { video.srcObject = null; };
  }, [sharing]);

  // ---------- screen sharing ----------
  const stopSharing = useCallback(() => {
    shareRef.current?.getTracks().forEach((track) => track.stop());
    shareRef.current = null;
    setSharing(false);
    setStatus(channel ? 'loading' : 'idle');
  }, [channel]);

  const startSharing = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) { toast.error(t('share.unsupported')); return; }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      shareRef.current = stream;
      setMuted(true);                           // never echo the machine's own audio back at it
      setSharing(true);                         // the effect below puts it on screen, after the
      setStatus('playing');                     // channel effect has torn the previous source down
      stream.getVideoTracks()[0]?.addEventListener('ended', stopSharing); // the browser's own "stop sharing"
    } catch (e) {
      const name = (e as DOMException)?.name ?? '';
      if (name === 'AbortError') return;                       // the picker was dismissed – not an error
      toast.error(name === 'NotAllowedError' ? t('share.denied') : t('share.failed', { e: name || String(e) }));
    }
  }, [t, stopSharing]);

  // ---------- recording ----------
  // Two ways, and the better one first. An HLS channel is already arriving as finished segments, so
  // they are simply kept: original quality, no decoder, and nothing the browser can refuse. Only a
  // shared screen or a natively played stream needs MediaRecorder, which can have no more than the
  // page is allowed to look at – and a cross-origin video is not that.
  const beginRecording = useCallback(() => {
    const name = sharing ? 'ekran' : (channel?.sortName || 'yayin');
    const begin = (start: () => ReturnType<typeof startRecording>) => {
      try {
        recorderRef.current = start();
        setRecordingMs(0);
        setResult(null);
      } catch (e) {
        toast.error(t('rec.failed', { e: String((e as Error)?.message ?? e) }));
      }
    };

    const hls = hlsRef.current;
    if (!sharing && hls && status === 'playing') {
      begin(() => startSegmentRecording(hls, name, setRecordingMs));
      toast.success(t('rec.lossless'), { duration: 6000 });
      return;
    }

    if (!canRecord()) { toast.error(t('rec.unsupported')); return; }
    if (status !== 'playing' && !sharing) { toast.error(t('rec.noStream'), { duration: 8000 }); return; }
    const { stream, blocked } = sharing ? { stream: shareRef.current, blocked: false } : captureFrom(videoRef.current!);
    if (!stream || !stream.getTracks().length) {
      toast.error(blocked ? t('rec.tainted') : t('rec.noStream'), { duration: 10000 });
      return;
    }
    begin(() => startRecording(stream, name, setRecordingMs));
  }, [channel, sharing, status, t]);

  const endRecording = useCallback(async () => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    setRecordingMs(null);
    if (!rec) return;
    try {
      const done = await rec.stop();
      setResult(done);
      toast.success(t('rec.done', { size: formatBytes(done.blob.size) }));
    } catch (e) {
      toast.error(t('rec.failed', { e: String((e as Error)?.message ?? e) }));
    }
  }, [t]);

  // stop everything when the page goes away, so no capture keeps running in the background
  useEffect(() => () => {
    recorderRef.current?.cancel();
    shareRef.current?.getTracks().forEach((track) => track.stop());
    hlsRef.current?.destroy();
  }, []);

  const label = sharing ? t('share.on') : channel?.sortName ?? '';

  return (
    <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col', className)} id="playerPanel">
      {/* on a phone the picture is a 16:9 band at the top, so the channel list keeps the rest */}
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center bg-black max-[900px]:aspect-video max-[900px]:flex-none" id="playerStage">
        <video
          ref={videoRef}
          id="playerVideo"
          className="max-h-full max-w-full"
          playsInline
          autoPlay
          controls={false}
          onClick={() => { const v = videoRef.current!; if (v.paused) void v.play().catch(() => {}); else v.pause(); }}
        />
        {status === 'idle' && !sharing && <p className="text-muted-foreground absolute text-sm" id="playerIdle">{t('player.idle')}</p>}
        {status === 'loading' && <p className="absolute text-sm text-white/80" id="playerLoading">{t('player.loading')}</p>}
        {status === 'error' && (
          <div className="absolute max-w-md p-6 text-center" id="playerError">
            <p className="mb-1 font-semibold text-red-400">{t('player.error')}</p>
            <p className="mb-3 text-sm text-white/80">{t(`player.${errorKind}`)}</p>
            <div className="flex justify-center gap-2">
              <Button size="sm" variant="secondary" onClick={() => setAttempt((n) => n + 1)}><RotateCw /> {t('player.retry')}</Button>
              {channel && <Button size="sm" variant="outline" asChild><a href={channel.url} target="_blank" rel="noreferrer"><ExternalLink /> {t('player.open')}</a></Button>}
            </div>
          </div>
        )}
        {sharing && <Badge className="absolute top-3 left-3 bg-blue-600 text-white">{t('share.on')}</Badge>}
        {recordingMs !== null && (
          <Badge className="absolute top-3 right-3 gap-1.5 bg-red-600 text-white" id="recBadge">
            <Circle className="size-2 animate-pulse fill-current" /> {t('rec.on', { time: formatTime(recordingMs / 1000, { ms: false }) })}
          </Badge>
        )}
      </div>

      <div className="bg-card flex flex-wrap items-center gap-2 border-t px-3 py-2 max-[900px]:gap-1 max-[900px]:px-2">
        <div className="mr-auto flex min-w-0 items-center gap-2">
          {channel?.logo && !sharing && <img src={channel.logo} alt="" className="size-6 shrink-0 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
          <span className="truncate text-sm font-medium" id="playerTitle">{label}</span>
          {channel?.quality && !sharing && <Badge variant="secondary" className="shrink-0 text-[10px]">{channel.quality}</Badge>}
        </div>

        <Button id="btnMute" variant="ghost" size="icon-sm" title={t('player.mute')} onClick={() => setMuted((m) => !m)}>{muted ? <VolumeX /> : <Volume2 />}</Button>
        <Slider id="playerVolume" className="w-24 max-[900px]:hidden" min={0} max={1} step={0.01} value={[volume]} onValueChange={(v) => { setVolume(v[0]); setMuted(v[0] === 0); }} aria-label={t('player.volume')} />
        <Button id="btnPip" variant="ghost" size="icon-sm" title={t('player.pip')} onClick={() => { const v = videoRef.current!; if (document.pictureInPictureElement) void document.exitPictureInPicture(); else void v.requestPictureInPicture?.().catch(() => {}); }}><PictureInPicture2 /></Button>
        <Button id="btnFull" variant="ghost" size="icon-sm" title={t('player.fullscreen')} onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void stageRef.current?.requestFullscreen?.().catch(() => {}); }}><Maximize2 /></Button>
        {channel && (
          <Button id="btnCopyUrl" variant="ghost" size="icon-sm" title={t('player.copy')} onClick={() => { void navigator.clipboard?.writeText(channel.url).then(() => toast.success(t('player.copied')), () => {}); }}><Copy /></Button>
        )}
        <Button id="btnShare" size="sm" variant={sharing ? 'default' : 'outline'} onClick={() => (sharing ? stopSharing() : void startSharing())}>
          <MonitorUp /> {sharing ? t('share.stop') : t('share.start')}
        </Button>
        <Button id="btnRecord" size="sm" variant={recordingMs !== null ? 'destructive' : 'outline'} onClick={() => (recordingMs !== null ? void endRecording() : beginRecording())}>
          {recordingMs !== null ? <Square /> : <Circle />} {recordingMs !== null ? t('rec.stop') : t('rec.start')}
        </Button>
      </div>

      {result && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-emerald-950/40 px-3 py-2 text-sm" id="recResult">
          <span className="mr-auto truncate">
            {result.fileName} · {formatBytes(result.blob.size)} · {formatTime(result.durationMs / 1000, { ms: false })}
            {result.lossless && <span className="text-emerald-300"> · {t('rec.original')}</span>}
          </span>
          <Button size="xs" asChild><a href={result.url} download={result.fileName}>{t('rec.download')}</a></Button>
          {onSendToEditor && (
            <Button id="btnRecToEditor" size="xs" variant="secondary" onClick={() => void onSendToEditor(new File([result.blob], result.fileName, { type: result.blob.type }))}>
              {t('rec.toEditor')}
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={() => { URL.revokeObjectURL(result.url); setResult(null); }}>{t('rec.dismiss')}</Button>
        </div>
      )}
      <span hidden id="playerStatus" data-status={status} data-sharing={sharing} data-recording={recordingMs !== null} className={cn()} />
    </section>
  );
}
