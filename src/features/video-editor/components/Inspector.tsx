import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Field, RangeField, SectionTitle } from './Field';
import { useEditor, useI18n, useStoreEvents } from '../hooks/useEditor';
import { RESOLUTIONS, TRANSITION_TYPES, FONT_FAMILIES, clamp } from '../engine/state';
import type { Clip, Track, TransitionType } from '../engine/types';
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

function Toggle({ on, onClick, children, className }: { on: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return <Button size="xs" variant={on ? 'default' : 'outline'} className={className} onClick={onClick}>{children}</Button>;
}

export function Inspector({ actions }: { actions: InspectorActions }) {
  const { store, player } = useEditor();
  const { t } = useI18n();
  useStoreEvents();
  const clips = store.selectedClips();
  const track = store.selection.trackId ? store.getTrack(store.selection.trackId) : null;
  const title = clips.length ? t('inspector.clip') : track ? t('inspector.track') : t('inspector.project');
  return (
    <aside className="bg-card flex min-h-0 min-w-0 flex-col border-l" id="inspectorPanel">
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
      {clip && clip.kind !== 'text' && <Button size="xs" variant="outline" onClick={actions.detachAudio}>🎵 {t('edit.detachAudio')}</Button>}
      <Button size="xs" variant="destructive" onClick={actions.deleteSelected}>🗑 {t('edit.delete')}</Button>
    </div>
  );
}

function ClipInspector({ clip: c, actions }: { clip: Clip; actions: InspectorActions }) {
  const { store } = useEditor();
  const { t } = useI18n();
  const m = c.mediaId ? store.media.get(c.mediaId) : null;
  const track = store.getTrack(c.trackId);
  const isText = c.kind === 'text';
  const upd = (patch: Partial<Clip>, silent = false) => store.updateClip(c.id, patch, { silent, history: !silent });
  const live = (patch: Partial<Clip>) => upd(patch, true);
  const commit = () => { store.pushHistory(); store.changed('inspector'); };
  const types = TRANSITION_TYPES;
  return (
    <>
      {isText ? (
        <>
          <SectionTitle>{t('text.section')}</SectionTitle>
          <Field label={t('text.content')}>
            <Textarea key={c.id} defaultValue={c.text} onBlur={(e) => upd({ text: e.target.value, name: e.target.value.split('\n')[0] })} />
          </Field>
          <Field label={t('text.font')}>
            <NativeSelect size="sm" value={c.fontFamily} onChange={(e) => upd({ fontFamily: e.target.value })}>{FONT_FAMILIES.map((f) => <NativeSelectOption key={f} value={f}>{f}</NativeSelectOption>)}</NativeSelect>
          </Field>
          <RangeField label={t('text.size')} value={c.fontSize} min={1} max={40} step={0.5} unit="pct" onChange={(v) => live({ fontSize: v })} onCommit={commit} />
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t('text.color')}><Input type="color" className="h-8 p-1" value={c.color} onChange={(e) => live({ color: e.target.value })} onBlur={commit} /></Field>
            <Field label={t('text.align')}>
              <NativeSelect size="sm" value={c.align} onChange={(e) => upd({ align: e.target.value as Clip['align'] })}>
                <NativeSelectOption value="left">{t('text.alignLeft')}</NativeSelectOption><NativeSelectOption value="center">{t('text.alignCenter')}</NativeSelectOption><NativeSelectOption value="right">{t('text.alignRight')}</NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5" data-testid="text-toggles">
            <Toggle on={c.bold} onClick={() => upd({ bold: !c.bold })}><b>B</b> {t('text.bold')}</Toggle>
            <Toggle on={c.italic} onClick={() => upd({ italic: !c.italic })}><i>I</i> {t('text.italic')}</Toggle>
            <Toggle on={c.bgEnabled} onClick={() => upd({ bgEnabled: !c.bgEnabled })}>▦ {t('text.bg')}</Toggle>
            <Toggle on={c.shadow} onClick={() => upd({ shadow: !c.shadow })}>◗ {t('text.shadow')}</Toggle>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t('text.bgColor')}><Input type="color" className="h-8 p-1" value={c.bgColor} onChange={(e) => live({ bgColor: e.target.value })} onBlur={commit} /></Field>
            <RangeField label={t('text.bgOpacity')} value={c.bgOpacity} min={0} max={1} step={0.01} unit="%" onChange={(v) => live({ bgOpacity: v })} onCommit={commit} />
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t('text.outlineColor')}><Input type="color" className="h-8 p-1" value={c.outlineColor} onChange={(e) => live({ outlineColor: e.target.value })} onBlur={commit} /></Field>
            <RangeField label={t('text.outline')} value={c.outlineWidth} min={0} max={20} step={0.5} unit="pct" onChange={(v) => live({ outlineWidth: v })} onCommit={commit} />
          </div>
          <RangeField label={t('text.lineHeight')} value={c.lineHeight} min={0.8} max={2.5} step={0.05} unit="×" onChange={(v) => live({ lineHeight: v })} onCommit={commit} />
        </>
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
          <RangeField label={t('inspector.opacity')} value={c.opacity} min={0} max={1} step={0.01} unit="%" onChange={(v) => live({ opacity: v })} onCommit={commit} />
          {!isText && (
            <Field label={t('inspector.fit')}>
              <NativeSelect size="sm" value={c.fit} onChange={(e) => upd({ fit: e.target.value as Clip['fit'] })}>
                <NativeSelectOption value="contain">{t('inspector.fitContain')}</NativeSelectOption><NativeSelectOption value="cover">{t('inspector.fitCover')}</NativeSelectOption><NativeSelectOption value="stretch">{t('inspector.fitStretch')}</NativeSelectOption>
              </NativeSelect>
            </Field>
          )}
          <RangeField label={t('inspector.scale')} value={c.scale} min={0.05} max={3} step={0.01} unit="×" onChange={(v) => live({ scale: v })} onCommit={commit} />
          <div className="grid grid-cols-2 gap-2.5">
            <RangeField label={t('inspector.posX')} value={c.x} min={-100} max={100} step={0.5} unit="" onChange={(v) => live({ x: v })} onCommit={commit} />
            <RangeField label={t('inspector.posY')} value={c.y} min={-100} max={100} step={0.5} unit="" onChange={(v) => live({ y: v })} onCommit={commit} />
          </div>
          <Field label={t('inspector.layoutPresets')}>
            <div className="flex flex-wrap gap-1.5" data-testid="layout-presets">
              {([
                ['inspector.presetFull', { scale: 1, x: 0, y: 0 }], ['inspector.presetPipTL', { scale: 0.33, x: -32, y: -32 }], ['inspector.presetPipTR', { scale: 0.33, x: 32, y: -32 }],
                ['inspector.presetPipBL', { scale: 0.33, x: -32, y: 32 }], ['inspector.presetPipBR', { scale: 0.33, x: 32, y: 32 }], ['inspector.presetLeft', { scale: 0.5, x: -25, y: 0 }], ['inspector.presetRight', { scale: 0.5, x: 25, y: 0 }],
              ] as [string, Partial<Clip>][]).map(([k, p]) => <Button key={k} size="xs" variant="outline" onClick={() => upd({ ...p, fit: 'contain' })}>{t(k)}</Button>)}
            </div>
          </Field>
          <SectionTitle>{t('trans.section')}</SectionTitle>
          <div className="grid grid-cols-2 gap-2.5">
            <Field label={t('trans.in')}><NativeSelect size="sm" value={c.transIn.type} onChange={(e) => upd({ transIn: { ...c.transIn, type: e.target.value as TransitionType } })}>{types.map((k) => <NativeSelectOption key={k} value={k}>{t('trans.' + k)}</NativeSelectOption>)}</NativeSelect></Field>
            <Field label={t('trans.duration')}><NumberInput value={c.transIn.duration} min={0.1} max={Math.max(0.1, c.duration)} step={0.1} onChange={(v) => upd({ transIn: { ...c.transIn, duration: clamp(v, 0.1, c.duration) } })} /></Field>
            <Field label={t('trans.out')}><NativeSelect size="sm" value={c.transOut.type} onChange={(e) => upd({ transOut: { ...c.transOut, type: e.target.value as TransitionType } })}>{types.map((k) => <NativeSelectOption key={k} value={k}>{t('trans.' + k)}</NativeSelectOption>)}</NativeSelect></Field>
            <Field label={t('trans.duration')}><NumberInput value={c.transOut.duration} min={0.1} max={Math.max(0.1, c.duration)} step={0.1} onChange={(v) => upd({ transOut: { ...c.transOut, duration: clamp(v, 0.1, c.duration) } })} /></Field>
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">{t('trans.hint')}</p>
        </>
      )}
      <ClipActions clip={c} actions={actions} />
    </>
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
