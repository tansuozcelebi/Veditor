import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectGroup, NativeSelectOption } from '@/components/ui/native-select';
import { Field, RangeField, SectionTitle } from './Field';
import { useEditor, useI18n, useStoreEvents } from '../hooks/useEditor';
import { useEffect, useReducer, useRef, useState } from 'react';
import { toast } from 'sonner';
import { RESOLUTIONS, TRANSITION_GROUPS, FONT_GROUPS, clamp } from '../engine/state';
import { customFonts, ensureFont, onFontsChange, registerFontFile } from '../engine/fonts';
import type { BlendMode, Clip, KeyframeEase, MagnifierShape, Track, TransitionType } from '../engine/types';
import { KEYFRAME_EASES, MOTION_PRESETS, animatedAt, keyedPatch, keyframeIndexAt, presetKeyframes, removeKeyframe, setKeyframe, toggleAnimation, type MotionPreset } from '../engine/keyframes';
import { cn } from '@/lib/utils';

export interface InspectorActions { split: () => void; duplicate: () => void; detachAudio: () => void; deleteSelected: () => void }

function NumberInput({ value, min, max, step = 0.01, onChange }: { value: number; min?: number; max?: number; step?: number; onChange: (v: number) => void }) {
  return (
    <Input
      type="number" className="h-8" key={value} defaultValue={Number(value).toFixed(3).replace(/\.?0+$/, '')} min={min} max={isFinite(max ?? Infinity) ? max : undefined} step={step}
      onBlur={(e) => { let v = parseFloat(e.target.value); if (isNaN(v)) return; if (min != null) v = Math.max(min, v); if (max != null && isFinite(max)) v = Math.min(max, v); if (v !== value) onChange(v); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function Toggle({ on, onClick, children, className, id }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string; id?: string }) {
  return <Button id={id} size="xs" variant={on ? 'default' : 'outline'} aria-pressed={on} className={className} onClick={onClick}>{children}</Button>;
}

export function Inspector({ actions }: { actions: InspectorActions }) {
  const { store, player } = useEditor();
  const { t } = useI18n();
  useStoreEvents();
  const clips = store.selectedClips();
  const track = store.selection.trackId ? store.getTrack(store.selection.trackId) : null;
  const title = clips.length ? t('inspector.clip') : track ? t('inspector.track') : t('inspector.project');
  return (
    <aside className="bg-card flex min-h-0 min-w-0 flex-col" id="inspectorPanel">
      <div className="border-b px-3 py-2"><h2 className="text-sm font-semibold" id="inspectorTitle">{title}</h2></div>
      <div className="flex flex-1 flex-col gap-3 overflow-auto p-3" id="inspectorBody">
        {clips.length === 1 && <ClipInspector clip={clips[0]} actions={actions} />}
        {clips.length > 1 && (<><p className="text-muted-foreground text-xs">{t('inspector.clipCount', { n: clips.length })}</p><ClipActions clip={null} actions={actions} /></>)}
        {clips.length === 0 && track && <TrackInspector track={track} />}
        {clips.length === 0 && !track && <ProjectInspector onChange={() => player.render(player.currentTime)} />}
      </div>
    </aside>
  );
}

function ClipActions({ clip, actions }: { clip: Clip | null; actions: InspectorActions }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap gap-1.5">
      {clip && <Button size="xs" variant="outline" onClick={actions.split}>✂ {t('edit.split')}</Button>}
      {clip && <Button size="xs" variant="outline" onClick={actions.duplicate}>⧉ {t('edit.duplicate')}</Button>}
      {clip && clip.kind === 'media' && <Button size="xs" variant="outline" onClick={actions.detachAudio}>🎵 {t('edit.detachAudio')}</Button>}
      <Button size="xs" variant="destructive" onClick={actions.deleteSelected}>🗑 {t('edit.delete')}</Button>
    </div>
  );
}

/** The playhead time, followed only while `enabled` (an animated layer), so a still inspector does not re-render every frame. */
function useAnimTime(enabled: boolean) {
  const { player } = useEditor();
  const [time, setTime] = useState(player.currentTime);
  useEffect(() => {
    if (!enabled) return;
    setTime(player.currentTime);
    return player.on('time', (tm: number) => setTime(tm));
  }, [enabled, player]);
  return enabled ? time : player.currentTime;
}

function ClipInspector({ clip: c, actions }: { clip: Clip; actions: InspectorActions }) {
  const { store, player } = useEditor();
  const { t } = useI18n();
  const m = c.mediaId ? store.media.get(c.mediaId) : null;
  const track = store.getTrack(c.trackId);
  const isText = c.kind === 'text';
  const isMag = c.kind === 'magnifier';
  const animated = c.keyframes.length > 0;
  const time = useAnimTime(animated);
  // what the layer looks like at the playhead – with keyframes, that is what the controls show and edit
  const a = animatedAt(c, time);
  const upd = (patch: Partial<Clip>, silent = false) => store.updateClip(c.id, patch, { silent, history: !silent });
  const live = (patch: Partial<Clip>) => upd(patch, true);
  // position, scale, rotation and opacity go into a keyframe at the playhead on an animated layer
  const updA = (patch: Partial<Clip>, silent = false) => upd(keyedPatch(c, patch, player.currentTime), silent);
  const liveA = (patch: Partial<Clip>) => updA(patch, true);
  const commit = () => { store.pushHistory(); store.changed('inspector'); };
  return (
    <>
      {isText ? (
        <TextInspector clip={c} upd={upd} live={live} commit={commit} />
      ) : isMag ? (
        <MagnifierInspector clip={c} upd={upd} live={live} commit={commit} />
      ) : (
        <>
          <Field label={t('inspector.name')}><Input className="h-8" key={c.id} defaultValue={c.name || m?.name || ''} onBlur={(e) => { if (e.target.value !== c.name) upd({ name: e.target.value }); }} /></Field>
          <p className="text-muted-foreground text-xs">{t('inspector.media')}: {m ? m.name : '?'} · {t('inspector.track')}: {track ? track.name : '?'}</p>
        </>
      )}

      <SectionTitle>{t('inspector.timingSection')}</SectionTitle>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t('inspector.start')}><NumberInput value={c.start} min={0} onChange={(v) => { const pos = store.findPlacement(c.trackId!, v, c.duration, [c.id]); if (pos != null) upd({ start: pos }); }} /></Field>
        <Field label={t('inspector.duration')}><NumberInput value={c.duration} min={0.05} max={store.maxClipDuration(c)} onChange={(v) => { const gap = store.gapAt(c.trackId!, c.start, [c.id]); const maxD = Math.min(store.maxClipDuration(c), gap ? gap.hi - c.start : Infinity); upd({ duration: clamp(v, 0.05, maxD) }); }} /></Field>
        {m && m.kind !== 'image' && <Field label={t('inspector.offset')}><NumberInput value={c.offset} min={0} max={Math.max(0, m.duration - 0.05)} onChange={(v) => { const off = clamp(v, 0, m.duration - 0.05); upd({ offset: off, duration: Math.min(c.duration, m.duration - off) }); }} /></Field>}
      </div>

      {m && m.kind !== 'image' && (
        <>
          <SectionTitle>{t('inspector.audioSection')}</SectionTitle>
          <RangeField label={t('inspector.volume')} value={c.volume} min={0} max={2} step={0.01} unit="%" onChange={(v) => live({ volume: v })} onCommit={commit} />
          <div className="flex gap-1.5"><Toggle on={c.muted} onClick={() => upd({ muted: !c.muted })}>🔇 {t('inspector.muted')}</Toggle></div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t('inspector.fadeIn')}><NumberInput value={c.fadeIn} min={0} max={c.duration} step={0.1} onChange={(v) => upd({ fadeIn: clamp(v, 0, c.duration) })} /></Field>
            <Field label={t('inspector.fadeOut')}><NumberInput value={c.fadeOut} min={0} max={c.duration} step={0.1} onChange={(v) => upd({ fadeOut: clamp(v, 0, c.duration) })} /></Field>
          </div>
        </>
      )}

      {track && track.kind === 'video' && (
        <>
          <SectionTitle>{t('inspector.videoSection')}</SectionTitle>
          <RangeField label={t('inspector.opacity')} value={a.opacity} min={0} max={1} step={0.01} unit="%" onChange={(v) => liveA({ opacity: v })} onCommit={commit} testId="clip-opacity" />
          {!isText && !isMag && (
            <Field label={t('inspector.fit')}>
              <NativeSelect size="sm" value={c.fit} onChange={(e) => upd({ fit: e.target.value as Clip['fit'] })}>
                <NativeSelectOption value="contain">{t('inspector.fitContain')}</NativeSelectOption><NativeSelectOption value="cover">{t('inspector.fitCover')}</NativeSelectOption><NativeSelectOption value="stretch">{t('inspector.fitStretch')}</NativeSelectOption>
              </NativeSelect>
            </Field>
          )}
          <RangeField label={t('inspector.scale')} value={a.scale} min={0.05} max={3} step={0.01} unit="×" onChange={(v) => liveA({ scale: v })} onCommit={commit} />
          <div className="grid grid-cols-2 gap-2.5">
            <RangeField label={t('inspector.posX')} value={a.x} min={-100} max={100} step={0.5} unit="" onChange={(v) => liveA({ x: v })} onCommit={commit} />
            <RangeField label={t('inspector.posY')} value={a.y} min={-100} max={100} step={0.5} unit="" onChange={(v) => liveA({ y: v })} onCommit={commit} />
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <Field label={t('inspector.scale')}><NumberInput value={round3(a.scale)} min={0.05} max={10} step={0.05} onChange={(v) => updA({ scale: v })} /></Field>
            <Field label="X"><NumberInput value={round3(a.x)} min={-200} max={200} step={1} onChange={(v) => updA({ x: v })} /></Field>
            <Field label="Y"><NumberInput value={round3(a.y)} min={-200} max={200} step={1} onChange={(v) => updA({ y: v })} /></Field>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">{t('inspector.canvasHint')}</p>
          <Field label={t('inspector.layoutPresets')}>
            <div className="flex flex-wrap gap-1.5" data-testid="layout-presets">
              {([
                ['inspector.presetFull', { scale: 1, x: 0, y: 0 }], ['inspector.presetPipTL', { scale: 0.33, x: -32, y: -32 }], ['inspector.presetPipTR', { scale: 0.33, x: 32, y: -32 }],
                ['inspector.presetPipBL', { scale: 0.33, x: -32, y: 32 }], ['inspector.presetPipBR', { scale: 0.33, x: 32, y: 32 }], ['inspector.presetLeft', { scale: 0.5, x: -25, y: 0 }], ['inspector.presetRight', { scale: 0.5, x: 25, y: 0 }],
              ] as [string, Partial<Clip>][]).map(([k, p]) => <Button key={k} size="xs" variant="outline" onClick={() => updA(isText || isMag ? { x: p.x, y: p.y } : { ...p, fit: 'contain' })}>{t(k)}</Button>)}
            </div>
          </Field>
          <CropRotateSection clip={c} rotation={a.rotation} upd={upd} updA={updA} liveA={liveA} live={live} commit={commit} />
          <EffectsSection clip={c} upd={upd} live={live} commit={commit} />
          <AnimationSection clip={c} time={time} upd={upd} />
          <TransitionSection clip={c} upd={upd} />
        </>
      )}
      <ClipActions clip={c} actions={actions} />
    </>
  );
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/** Rotation, mirroring and crop of a layer; crop is for pictures (video and images). */
function CropRotateSection({ clip: c, rotation, upd, updA, liveA, live, commit }: {
  clip: Clip; rotation: number; upd: Upd; updA: Upd; liveA: (p: Partial<Clip>) => void; live: (p: Partial<Clip>) => void; commit: () => void;
}) {
  const { store, player } = useEditor();
  const { t } = useI18n();
  useStoreEvents(['crop']);
  const media = c.kind === 'media';
  const cropping = store.cropClipId === c.id;
  const cropped = c.cropL || c.cropT || c.cropR || c.cropB;
  const turn = (by: number) => updA({ rotation: ((Math.round(rotation + by) + 540) % 360) - 180 });
  const fit = () => {
    const p = player.fitCropPatch(c);
    if (!p) { toast.error(t('crop.notReady')); return; }
    updA(p);
  };
  const crop = (k: 'cropL' | 'cropT' | 'cropR' | 'cropB', other: 'cropL' | 'cropT' | 'cropR' | 'cropB') => (
    <RangeField testId={'crop-' + k.slice(4).toLowerCase()} label={t('crop.' + k.slice(4).toLowerCase())} value={c[k]} min={0} max={95} step={0.5} unit="pct"
      onChange={(v) => live({ [k]: Math.min(v, 95 - c[other]) } as Partial<Clip>)} onCommit={commit} />
  );
  return (
    <div id="cropSection" className="flex flex-col gap-2.5">
      <SectionTitle>{media ? t('crop.section') : t('crop.sectionRotate')}</SectionTitle>
      <RangeField testId="clip-rotation" label={t('crop.rotation')} value={rotation} min={-180} max={180} step={0.5} unit="" onChange={(v) => liveA({ rotation: v })} onCommit={commit} />
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="w-20"><NumberInput value={round3(rotation)} min={-360} max={360} step={1} onChange={(v) => updA({ rotation: ((v + 540) % 360) - 180 })} /></div>
        <Button id="btnRotLeft" size="xs" variant="outline" title={t('crop.rotLeft')} onClick={() => turn(-90)}>↺ 90°</Button>
        <Button id="btnRotRight" size="xs" variant="outline" title={t('crop.rotRight')} onClick={() => turn(90)}>↻ 90°</Button>
        <Toggle on={c.flipH} onClick={() => upd({ flipH: !c.flipH })}>⇋ {t('crop.flipH')}</Toggle>
        <Toggle on={c.flipV} onClick={() => upd({ flipV: !c.flipV })}>⇵ {t('crop.flipV')}</Toggle>
      </div>
      {media && (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {crop('cropL', 'cropR')}{crop('cropR', 'cropL')}{crop('cropT', 'cropB')}{crop('cropB', 'cropT')}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Toggle id="btnCropMode" on={cropping} onClick={() => store.setCropMode(cropping ? null : c.id)}>✂ {cropping ? t('crop.done') : t('crop.onCanvas')}</Toggle>
            <Button id="btnCropFit" size="xs" variant="outline" disabled={!cropped} title={t('crop.fitHint')} onClick={fit}>⤢ {t('crop.fit')}</Button>
            <Button id="btnCropReset" size="xs" variant="outline" disabled={!cropped} onClick={() => upd({ cropL: 0, cropT: 0, cropR: 0, cropB: 0 })}>⟲ {t('crop.reset')}</Button>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">{t('crop.hint')}</p>
        </>
      )}
    </div>
  );
}

const BLEND_MODES: BlendMode[] = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
const EFFECT_DEFAULTS = { brightness: 100, contrast: 100, saturation: 100, hue: 0, blur: 0, sepia: 0, grayscale: 0 } satisfies Partial<Clip>;

/** Blend mode and colour adjustments ("Effects & Presets" in After Effects terms). */
function EffectsSection({ clip: c, upd, live, commit }: { clip: Clip; upd: Upd; live: (p: Partial<Clip>) => void; commit: () => void }) {
  const { t } = useI18n();
  const changed = c.blendMode !== 'normal' || (Object.keys(EFFECT_DEFAULTS) as (keyof typeof EFFECT_DEFAULTS)[]).some((k) => c[k] !== EFFECT_DEFAULTS[k]);
  const looks: [string, Partial<Clip>][] = [
    ['fx.look.bw', { ...EFFECT_DEFAULTS, grayscale: 100, contrast: 115 }], ['fx.look.sepia', { ...EFFECT_DEFAULTS, sepia: 80, contrast: 105 }],
    ['fx.look.vivid', { ...EFFECT_DEFAULTS, saturation: 150, contrast: 115 }], ['fx.look.fade', { ...EFFECT_DEFAULTS, contrast: 80, brightness: 110, saturation: 70 }],
    ['fx.look.cold', { ...EFFECT_DEFAULTS, hue: -15, saturation: 85, brightness: 105 }], ['fx.look.warm', { ...EFFECT_DEFAULTS, sepia: 30, saturation: 120 }],
  ];
  return (
    <div id="effectsSection" className="flex flex-col gap-2.5">
      <SectionTitle>{t('fx.section')}</SectionTitle>
      <Field label={t('fx.blend')}>
        <NativeSelect id="blendMode" size="sm" value={c.blendMode} onChange={(e) => upd({ blendMode: e.target.value as BlendMode })}>
          {BLEND_MODES.map((b) => <NativeSelectOption key={b} value={b}>{t('fx.blend.' + b)}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <RangeField testId="fx-brightness" label={t('fx.brightness')} value={c.brightness} min={0} max={200} step={1} unit="pct" onChange={(v) => live({ brightness: v })} onCommit={commit} />
        <RangeField testId="fx-contrast" label={t('fx.contrast')} value={c.contrast} min={0} max={200} step={1} unit="pct" onChange={(v) => live({ contrast: v })} onCommit={commit} />
        <RangeField testId="fx-saturation" label={t('fx.saturation')} value={c.saturation} min={0} max={300} step={1} unit="pct" onChange={(v) => live({ saturation: v })} onCommit={commit} />
        <RangeField testId="fx-hue" label={t('fx.hue')} value={c.hue} min={-180} max={180} step={1} unit="" onChange={(v) => live({ hue: v })} onCommit={commit} />
        <RangeField testId="fx-blur" label={t('fx.blur')} value={c.blur} min={0} max={50} step={0.5} unit="" onChange={(v) => live({ blur: v })} onCommit={commit} />
        <RangeField testId="fx-sepia" label={t('fx.sepia')} value={c.sepia} min={0} max={100} step={1} unit="pct" onChange={(v) => live({ sepia: v })} onCommit={commit} />
        <RangeField testId="fx-grayscale" label={t('fx.grayscale')} value={c.grayscale} min={0} max={100} step={1} unit="pct" onChange={(v) => live({ grayscale: v })} onCommit={commit} />
      </div>
      <Field label={t('fx.looks')}>
        <div className="flex flex-wrap gap-1.5" data-testid="fx-looks">
          {looks.map(([k, p]) => <Button key={k} size="xs" variant="outline" onClick={() => upd(p)}>{t(k)}</Button>)}
          <Button id="btnFxReset" size="xs" variant="outline" disabled={!changed} onClick={() => upd({ ...EFFECT_DEFAULTS, blendMode: 'normal' })}>⟲ {t('fx.reset')}</Button>
        </div>
      </Field>
    </div>
  );
}

/** Keyframes for position, scale, rotation and opacity, plus ready-made motions. */
function AnimationSection({ clip: c, time, upd }: { clip: Clip; time: number; upd: Upd }) {
  const { player } = useEditor();
  const { t } = useI18n();
  const ks = c.keyframes;
  const local = Math.min(Math.max(0, time - c.start), c.duration);
  const at = keyframeIndexAt(c, local);
  const inside = time >= c.start && time <= c.start + c.duration;
  const seekKey = (dir: number) => {
    const target = dir < 0 ? [...ks].reverse().find((k) => k.t < local - 1e-3) : ks.find((k) => k.t > local + 1e-3);
    if (target) player.seek(c.start + Math.min(target.t, Math.max(0, c.duration - 1e-3)));
  };
  // the keyframe whose ease shapes the stretch the playhead is in
  const easeIdx = at >= 0 ? at : ks.reduce((best, k, i) => (k.t <= local ? i : best), -1);
  const preset = (p: MotionPreset) => upd({ keyframes: presetKeyframes(c, p) });
  return (
    <div id="keyframeSection" className="flex flex-col gap-2.5" data-keyframes={ks.length}>
      <SectionTitle>{t('kf.section')}</SectionTitle>
      <div className="flex flex-wrap items-center gap-1.5">
        <Toggle id="btnAnimate" on={ks.length > 0} onClick={() => upd(toggleAnimation(c, player.currentTime))}>⏱ {ks.length ? t('kf.on') : t('kf.off')}</Toggle>
        {ks.length > 0 && <span className="text-muted-foreground text-xs" id="kfCount">{t('kf.count', { n: ks.length })}</span>}
      </div>
      {ks.length > 0 && (
        <>
          <div className="flex flex-wrap gap-1.5">
            <Button id="btnKeyPrev" size="xs" variant="outline" title={t('kf.prev')} onClick={() => seekKey(-1)} disabled={!ks.some((k) => k.t < local - 1e-3)}>◀◆</Button>
            <Button id="btnKeyAdd" size="xs" variant={at >= 0 ? 'default' : 'outline'} disabled={!inside} title={t('kf.addHint')} onClick={() => upd({ keyframes: setKeyframe(c, local) })}>◆ {at >= 0 ? t('kf.here') : t('kf.add')}</Button>
            <Button id="btnKeyNext" size="xs" variant="outline" title={t('kf.next')} onClick={() => seekKey(1)} disabled={!ks.some((k) => k.t > local + 1e-3)}>◆▶</Button>
            <Button id="btnKeyDel" size="xs" variant="outline" disabled={at < 0} onClick={() => upd({ keyframes: removeKeyframe(c, local) })}>✕ {t('kf.remove')}</Button>
          </div>
          {easeIdx >= 0 && easeIdx < ks.length - 1 && (
            <Field label={t('kf.ease')}>
              <NativeSelect id="keyEase" size="sm" value={ks[easeIdx].ease} onChange={(e) => upd({ keyframes: ks.map((k, i) => (i === easeIdx ? { ...k, ease: e.target.value as KeyframeEase } : k)) })}>
                {KEYFRAME_EASES.map((k) => <NativeSelectOption key={k} value={k}>{t('kf.ease.' + k)}</NativeSelectOption>)}
              </NativeSelect>
            </Field>
          )}
          <div className="relative h-4 rounded bg-muted" data-testid="kf-strip" title={t('kf.strip')}>
            {ks.map((k, i) => (
              <button key={i} type="button" aria-label={t('kf.goto', { t: k.t.toFixed(2) })}
                className={cn('absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-black/40', i === at ? 'bg-amber-300' : 'bg-sky-400')}
                style={{ left: `${(Math.min(Math.max(k.t, 0), c.duration) / Math.max(0.001, c.duration)) * 100}%` }}
                onClick={() => player.seek(c.start + Math.min(Math.max(0, k.t), Math.max(0, c.duration - 1e-3)))} />
            ))}
            <div className="pointer-events-none absolute inset-y-0 w-px bg-red-500" style={{ left: `${(local / Math.max(0.001, c.duration)) * 100}%` }} />
          </div>
        </>
      )}
      <Field label={t('kf.presets')}>
        <div className="flex flex-wrap gap-1.5" data-testid="motion-presets">
          {MOTION_PRESETS.map((p) => <Button key={p} size="xs" variant="outline" onClick={() => preset(p)}>{t('kf.preset.' + p)}</Button>)}
        </div>
      </Field>
      <p className="text-muted-foreground text-xs leading-relaxed">{t('kf.hint')}</p>
    </div>
  );
}

const MAG_SHAPES: MagnifierShape[] = ['circle', 'rounded', 'rect'];

/** A magnifier layer: how much it enlarges, how big the lens is and what it looks like. */
function MagnifierInspector({ clip: c, upd, live, commit }: { clip: Clip; upd: Upd; live: (p: Partial<Clip>) => void; commit: () => void }) {
  const { t } = useI18n();
  return (
    <div id="magnifierSection" className="flex flex-col gap-2.5">
      <SectionTitle>{t('mag.section')}</SectionTitle>
      <Field label={t('inspector.name')}><Input className="h-8" key={c.id} defaultValue={c.name} onBlur={(e) => { if (e.target.value !== c.name) upd({ name: e.target.value }); }} /></Field>
      <RangeField testId="mag-zoom" label={t('mag.zoom')} value={c.magZoom} min={1} max={8} step={0.1} unit="×" onChange={(v) => live({ magZoom: v })} onCommit={commit} />
      <RangeField testId="mag-size" label={t('mag.size')} value={c.magSize} min={2} max={50} step={0.5} unit="pct" onChange={(v) => live({ magSize: v })} onCommit={commit} />
      <Field label={t('mag.shape')}>
        <NativeSelect id="magShape" size="sm" value={c.magShape} onChange={(e) => upd({ magShape: e.target.value as MagnifierShape })}>
          {MAG_SHAPES.map((s) => <NativeSelectOption key={s} value={s}>{t('mag.shape.' + s)}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t('mag.borderColor')}><Input type="color" className="h-8 p-1" value={c.magBorderColor} onChange={(e) => live({ magBorderColor: e.target.value })} onBlur={commit} /></Field>
        <RangeField label={t('mag.border')} value={c.magBorderWidth} min={0} max={3} step={0.05} unit="pct" onChange={(v) => live({ magBorderWidth: v })} onCommit={commit} />
      </div>
      <div className="flex gap-1.5"><Toggle on={c.magShadow} onClick={() => upd({ magShadow: !c.magShadow })}>◗ {t('mag.shadow')}</Toggle></div>
      <p className="text-muted-foreground text-xs leading-relaxed">{t('mag.hint')}</p>
    </div>
  );
}

function TrackInspector({ track: tr }: { track: Track }) {
  const { store } = useEditor();
  const { t } = useI18n();
  const toggles: [keyof Track, string, string][] = [['muted', 'inspector.trackMute', '🔇'], ['solo', 'inspector.trackSolo', 'S'], ['locked', 'inspector.trackLock', '🔒']];
  if (tr.kind === 'video') toggles.push(['hidden', 'inspector.trackHidden', '👁']);
  return (
    <>
      <Field label={t('inspector.name')}><Input className="h-8" key={tr.id} defaultValue={tr.name} onBlur={(e) => { if (e.target.value && e.target.value !== tr.name) store.updateTrack(tr.id, { name: e.target.value }); }} /></Field>
      <p className="text-muted-foreground text-xs">{t('kind.' + tr.kind)} · {t('inspector.clipCount', { n: store.clipsOnTrack(tr.id).length })}</p>
      <RangeField label={t('inspector.volume')} value={tr.volume} min={0} max={2} step={0.01} unit="%" onChange={(v) => store.updateTrack(tr.id, { volume: v }, { silent: true })} onCommit={() => { store.pushHistory(); store.changed('track'); }} />
      {tr.kind === 'video' && <RangeField testId="track-opacity" label={t('inspector.trackOpacity')} value={tr.opacity ?? 1} min={0} max={1} step={0.01} unit="%" onChange={(v) => store.updateTrack(tr.id, { opacity: v }, { silent: true })} onCommit={() => { store.pushHistory(); store.changed('track'); }} />}
      <div className="flex flex-wrap gap-1.5">
        {toggles.map(([k, label, ico]) => <Toggle key={k} on={!!tr[k]} onClick={() => store.updateTrack(tr.id, { [k]: !tr[k] } as Partial<Track>)}>{ico} {t(label)}</Toggle>)}
      </div>
      <Button size="xs" variant="destructive" className="w-fit" onClick={() => { const n = store.clipsOnTrack(tr.id).length; if (!n || window.confirm(t('track.deleteConfirm', { n }))) store.removeTrack(tr.id); }}>🗑 {t('inspector.deleteTrack')}</Button>
    </>
  );
}

function ProjectInspector({ onChange }: { onChange: () => void }) {
  const { store } = useEditor();
  const { t } = useI18n();
  const p = store.project;
  const commit = (patch: Partial<typeof p>) => { store.pushHistory(); Object.assign(p, patch); store.changed('project'); onChange(); };
  const matched = RESOLUTIONS.find((r) => r.w === p.width && r.h === p.height);
  const rows: [string, string][] = [['Space', 'sc.play'], ['S', 'sc.split'], ['T', 'sc.text'], ['Delete', 'sc.delete'], ['Ctrl+Z', 'sc.undo'], ['Ctrl+Y', 'sc.redo'], ['Ctrl+D', 'sc.dup'], ['← / →', 'sc.frame'], ['Home / End', 'sc.home'], ['Ctrl+Scroll', 'sc.zoom']];
  return (
    <>
      <p className="text-muted-foreground text-xs">{t('inspector.noSelection')}</p>
      <Field label={t('inspector.resolution')}>
        <NativeSelect size="sm" value={matched ? `${matched.w}x${matched.h}` : 'custom'} onChange={(e) => { if (e.target.value === 'custom') return; const [w, h] = e.target.value.split('x').map(Number); commit({ width: w, height: h }); }}>
          {RESOLUTIONS.map((r) => <NativeSelectOption key={r.label} value={`${r.w}x${r.h}`}>{r.label}</NativeSelectOption>)}
          <NativeSelectOption value="custom">{t('inspector.custom')}</NativeSelectOption>
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t('inspector.width')}><NumberInput value={p.width} min={16} max={7680} step={2} onChange={(v) => commit({ width: Math.round(v / 2) * 2 })} /></Field>
        <Field label={t('inspector.height')}><NumberInput value={p.height} min={16} max={7680} step={2} onChange={(v) => commit({ height: Math.round(v / 2) * 2 })} /></Field>
      </div>
      <Field label={t('inspector.fps')}>
        <NativeSelect size="sm" value={String(p.fps)} onChange={(e) => commit({ fps: Number(e.target.value) })}>{[24, 25, 30, 50, 60].map((f) => <NativeSelectOption key={f} value={String(f)}>{f}</NativeSelectOption>)}</NativeSelect>
      </Field>
      <Field label={t('inspector.background')}><Input type="color" className="h-8 w-full p-1" value={p.background} onChange={(e) => commit({ background: e.target.value })} /></Field>
      <SectionTitle>{t('inspector.shortcuts')}</SectionTitle>
      <div className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-2.5 gap-y-1 text-xs">
        {rows.map(([k, l]) => (<div key={k} className={cn('contents')}><kbd className="bg-muted rounded border px-1 font-mono text-[11px]">{k}</kbd><span>{t(l)}</span></div>))}
      </div>
    </>
  );
}

const SWATCHES = ['#ffffff', '#000000', '#f43f5e', '#f97316', '#facc15', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#a3a3a3', '#78350f'];

/** A colour well with a row of one-click swatches. */
function ColorField({ label, value, onLive, onPick, commit, testId }: { label: string; value: string; onLive: (v: string) => void; onPick: (v: string) => void; commit: () => void; testId?: string }) {
  const { t } = useI18n();
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <Input type="color" data-testid={testId} className="h-8 w-12 shrink-0 p-1" value={value} onChange={(e) => onLive(e.target.value)} onBlur={commit} />
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('text.swatches')}>
          {SWATCHES.map((col) => (
            <button key={col} type="button" title={col} aria-label={col} onClick={() => onPick(col)}
              className={cn('size-5 rounded-sm border border-white/20', value.toLowerCase() === col && 'ring-ring ring-2 ring-offset-1 ring-offset-transparent')} style={{ background: col }} />
          ))}
        </div>
      </div>
    </Field>
  );
}

type Upd = (patch: Partial<Clip>, silent?: boolean) => void;

/** Font, colour, style, shadow and reflection of a text layer. */
function TextInspector({ clip: c, upd, live, commit }: { clip: Clip; upd: Upd; live: (p: Partial<Clip>) => void; commit: () => void }) {
  const { t } = useI18n();
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => onFontsChange(refresh), []);
  const custom = customFonts();
  const known = FONT_GROUPS.some((g) => g.fonts.includes(c.fontFamily)) || custom.includes(c.fontFamily);
  const pickFont = (f: string) => { void ensureFont(f); upd({ fontFamily: f }); };
  const onFontFile = async (file?: File) => {
    if (!file) return;
    try { const fam = await registerFontFile(file); upd({ fontFamily: fam }); toast.success(t('text.fontLoaded', { name: fam })); }
    catch (e) { toast.error(t('text.fontFailed', { e: String((e as Error)?.message ?? e) })); }
  };
  return (
    <>
      <SectionTitle>{t('text.section')}</SectionTitle>
      <Field label={t('text.content')}>
        <Textarea key={c.id} defaultValue={c.text} onBlur={(e) => upd({ text: e.target.value, name: e.target.value.split('\n')[0] })} />
      </Field>
      <Field label={t('text.font')}>
        <div className="flex gap-1.5">
          <NativeSelect id="textFont" size="sm" value={c.fontFamily} onChange={(e) => pickFont(e.target.value)}>
            {!known && <NativeSelectOption value={c.fontFamily}>{c.fontFamily}</NativeSelectOption>}
            {custom.length > 0 && <NativeSelectGroup label={t('font.group.custom')}>{custom.map((f) => <NativeSelectOption key={f} value={f} style={{ fontFamily: `"${f}"` }}>{f}</NativeSelectOption>)}</NativeSelectGroup>}
            {FONT_GROUPS.map((g) => (
              <NativeSelectGroup key={g.key} label={t('font.group.' + g.key)}>
                {g.fonts.map((f) => <NativeSelectOption key={f} value={f} style={{ fontFamily: `"${f}", sans-serif` }}>{f}</NativeSelectOption>)}
              </NativeSelectGroup>
            ))}
          </NativeSelect>
          <Button size="sm" variant="outline" className="h-8 shrink-0 px-2" title={t('text.uploadFontHint')} onClick={() => fileRef.current?.click()}>⇪ {t('text.uploadFont')}</Button>
          <input ref={fileRef} type="file" hidden accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" onChange={(e) => { void onFontFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
        <div data-testid="font-preview" className="bg-muted/50 truncate rounded-md border px-2 py-1 text-lg leading-tight" style={{ fontFamily: `"${c.fontFamily}", sans-serif`, fontWeight: c.bold ? 700 : 400, fontStyle: c.italic ? 'italic' : 'normal', color: c.color }}>
          {(c.text || 'Aa').split('\n')[0].slice(0, 40) || 'Aa'} · AaÇçĞğŞş 123
        </div>
      </Field>
      <RangeField label={t('text.size')} value={c.fontSize} min={1} max={40} step={0.5} unit="pct" onChange={(v) => live({ fontSize: v })} onCommit={commit} />
      <ColorField label={t('text.color')} testId="text-color" value={c.color} onLive={(v) => live({ color: v })} onPick={(v) => upd({ color: v })} commit={commit} />
      <Field label={t('text.align')}>
        <NativeSelect size="sm" value={c.align} onChange={(e) => upd({ align: e.target.value as Clip['align'] })}>
          <NativeSelectOption value="left">{t('text.alignLeft')}</NativeSelectOption><NativeSelectOption value="center">{t('text.alignCenter')}</NativeSelectOption><NativeSelectOption value="right">{t('text.alignRight')}</NativeSelectOption>
        </NativeSelect>
      </Field>
      <div className="flex flex-wrap gap-1.5" data-testid="text-toggles">
        <Toggle on={c.bold} onClick={() => upd({ bold: !c.bold })}><b>B</b> {t('text.bold')}</Toggle>
        <Toggle on={c.italic} onClick={() => upd({ italic: !c.italic })}><i>I</i> {t('text.italic')}</Toggle>
        <Toggle on={c.bgEnabled} onClick={() => upd({ bgEnabled: !c.bgEnabled })}>▦ {t('text.bg')}</Toggle>
        <Toggle on={c.shadow} onClick={() => upd({ shadow: !c.shadow })}>◗ {t('text.shadow')}</Toggle>
        <Toggle on={c.reflection} onClick={() => upd({ reflection: !c.reflection })}>⧗ {t('text.reflection')}</Toggle>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <RangeField label={t('text.letterSpacing')} value={c.letterSpacing} min={-10} max={50} step={0.5} unit="pct" onChange={(v) => live({ letterSpacing: v })} onCommit={commit} />
        <RangeField label={t('text.lineHeight')} value={c.lineHeight} min={0.8} max={2.5} step={0.05} unit="×" onChange={(v) => live({ lineHeight: v })} onCommit={commit} />
      </div>
      {c.bgEnabled && (
        <div className="grid grid-cols-2 gap-2.5">
          <Field label={t('text.bgColor')}><Input type="color" className="h-8 p-1" value={c.bgColor} onChange={(e) => live({ bgColor: e.target.value })} onBlur={commit} /></Field>
          <RangeField label={t('text.bgOpacity')} value={c.bgOpacity} min={0} max={1} step={0.01} unit="%" onChange={(v) => live({ bgOpacity: v })} onCommit={commit} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t('text.outlineColor')}><Input type="color" className="h-8 p-1" value={c.outlineColor} onChange={(e) => live({ outlineColor: e.target.value })} onBlur={commit} /></Field>
        <RangeField label={t('text.outline')} value={c.outlineWidth} min={0} max={20} step={0.5} unit="pct" onChange={(v) => live({ outlineWidth: v })} onCommit={commit} />
      </div>

      {(c.shadow || c.reflection) && <SectionTitle>{t('text.effects')}</SectionTitle>}
      {c.shadow && (
        <div className="grid grid-cols-2 gap-2.5" data-testid="shadow-controls">
          <Field label={t('text.shadowColor')}><Input type="color" className="h-8 p-1" value={c.shadowColor} onChange={(e) => live({ shadowColor: e.target.value })} onBlur={commit} /></Field>
          <RangeField label={t('text.shadowOpacity')} value={c.shadowOpacity} min={0} max={1} step={0.01} unit="%" onChange={(v) => live({ shadowOpacity: v })} onCommit={commit} />
          <RangeField label={t('text.shadowBlur')} value={c.shadowBlur} min={0} max={100} step={1} unit="pct" onChange={(v) => live({ shadowBlur: v })} onCommit={commit} />
          <div />
          <RangeField label={t('text.shadowX')} value={c.shadowX} min={-50} max={50} step={0.5} unit="pct" onChange={(v) => live({ shadowX: v })} onCommit={commit} />
          <RangeField label={t('text.shadowY')} value={c.shadowY} min={-50} max={50} step={0.5} unit="pct" onChange={(v) => live({ shadowY: v })} onCommit={commit} />
        </div>
      )}
      {c.reflection && (
        <div className="grid grid-cols-2 gap-2.5" data-testid="reflection-controls">
          <RangeField label={t('text.reflectionOpacity')} value={c.reflectionOpacity} min={0} max={1} step={0.01} unit="%" onChange={(v) => live({ reflectionOpacity: v })} onCommit={commit} />
          <RangeField label={t('text.reflectionLength')} value={c.reflectionLength} min={5} max={100} step={1} unit="pct" onChange={(v) => live({ reflectionLength: v })} onCommit={commit} />
          <RangeField label={t('text.reflectionGap')} value={c.reflectionGap} min={-50} max={100} step={1} unit="pct" onChange={(v) => live({ reflectionGap: v })} onCommit={commit} />
        </div>
      )}
    </>
  );
}

function TransitionSelect({ id, value, onChange }: { id?: string; value: TransitionType; onChange: (v: TransitionType) => void }) {
  const { t } = useI18n();
  return (
    <NativeSelect id={id} size="sm" value={value} onChange={(e) => onChange(e.target.value as TransitionType)}>
      {TRANSITION_GROUPS.map((g) => (
        <NativeSelectGroup key={g.key} label={t('trans.group.' + g.key)}>
          {g.types.map((k) => <NativeSelectOption key={k} value={k}>{t('trans.' + k)}</NativeSelectOption>)}
        </NativeSelectGroup>
      ))}
    </NativeSelect>
  );
}

/** Transition in/out of a clip; the "in" side is the transition from the clip right before it. */
function TransitionSection({ clip: c, upd }: { clip: Clip; upd: Upd }) {
  const { store } = useEditor();
  const { t } = useI18n();
  const prev = store.adjacentPrev(c);
  const prevName = prev ? (prev.kind === 'text' ? prev.text.split('\n')[0] : prev.name || store.media.get(prev.mediaId ?? '')?.name || '?') : '';
  const applyAll = () => {
    const targets = store.project.clips.filter((x) => x.id !== c.id && store.getTrack(x.trackId)?.kind === 'video' && store.adjacentPrev(x));
    if (!targets.length) return;
    store.pushHistory();
    for (const x of targets) store.updateClip(x.id, { transIn: { type: c.transIn.type, duration: Math.min(c.transIn.duration, x.duration) } }, { silent: true });
    store.changed('transitions');
    toast.success(t('trans.appliedAll', { n: targets.length + (prev ? 1 : 0) }));
  };
  return (
    <div id="transitionSection" className="flex flex-col gap-2.5">
      <SectionTitle>{t('trans.section')}</SectionTitle>
      <p className="text-muted-foreground text-xs leading-relaxed" data-testid="trans-between">{prev ? `${t('trans.between')}: ${prevName}` : t('trans.betweenNone')}</p>
      <div className="grid grid-cols-2 gap-2.5">
        <Field label={t('trans.in')}><TransitionSelect id="transInType" value={c.transIn.type} onChange={(type) => upd({ transIn: { ...c.transIn, type } })} /></Field>
        <Field label={t('trans.duration')}><NumberInput value={c.transIn.duration} min={0.1} max={Math.max(0.1, c.duration)} step={0.1} onChange={(v) => upd({ transIn: { ...c.transIn, duration: clamp(v, 0.1, c.duration) } })} /></Field>
        <Field label={t('trans.out')}><TransitionSelect id="transOutType" value={c.transOut.type} onChange={(type) => upd({ transOut: { ...c.transOut, type } })} /></Field>
        <Field label={t('trans.duration')}><NumberInput value={c.transOut.duration} min={0.1} max={Math.max(0.1, c.duration)} step={0.1} onChange={(v) => upd({ transOut: { ...c.transOut, duration: clamp(v, 0.1, c.duration) } })} /></Field>
      </div>
      {c.transIn.type !== 'none' && <Button size="xs" variant="outline" className="w-fit" onClick={applyAll}>⟋ {t('trans.allJunctions')}</Button>}
      <p className="text-muted-foreground text-xs leading-relaxed">{t('trans.hint')}</p>
    </div>
  );
}
