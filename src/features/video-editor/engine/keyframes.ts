// ===================== Keyframe animation =====================
// A layer can animate its position, scale, rotation and opacity over its lifetime, After Effects
// style: each keyframe holds those values at one moment (seconds from the clip's start) and the
// frames in between are interpolated. While a layer has keyframes, editing one of those properties
// – in the inspector or by dragging on the canvas – sets a keyframe at the playhead ("auto-key")
// instead of changing the plain value, which is what the stopwatch in After Effects does.
import type { Clip, Keyframe, KeyframeEase, KeyframeValues } from './types';

export const ANIMATED_PROPS = ['x', 'y', 'scale', 'rotation', 'opacity'] as const;
export type AnimatedProp = typeof ANIMATED_PROPS[number];
export const KEYFRAME_EASES: KeyframeEase[] = ['linear', 'ease', 'ease-in', 'ease-out', 'hold'];

/** Two keyframes closer than this (seconds) are the same one. */
export const KEY_TOLERANCE = 1 / 50;

const easeFn: Record<KeyframeEase, (p: number) => number> = {
  linear: (p) => p,
  ease: (p) => p * p * (3 - 2 * p),
  'ease-in': (p) => p * p * p,
  'ease-out': (p) => 1 - (1 - p) ** 3,
  hold: () => 0,
};

const valuesOf = (c: KeyframeValues): KeyframeValues => ({ x: c.x, y: c.y, scale: c.scale, rotation: c.rotation, opacity: c.opacity });

/** The animated values of a clip at `local` seconds from its start (its plain values when it has no keyframes). */
export function valuesAt(clip: Clip, local: number): KeyframeValues {
  const ks = clip.keyframes;
  if (!ks || !ks.length) return valuesOf(clip);
  if (local <= ks[0].t) return valuesOf(ks[0]);
  const last = ks[ks.length - 1];
  if (local >= last.t) return valuesOf(last);
  let i = 0;
  while (i < ks.length - 2 && ks[i + 1].t <= local) i++;
  const a = ks[i], b = ks[i + 1];
  const p = easeFn[a.ease || 'linear']((local - a.t) / Math.max(1e-6, b.t - a.t));
  const mix = (u: number, v: number) => u + (v - u) * p;
  return { x: mix(a.x, b.x), y: mix(a.y, b.y), scale: mix(a.scale, b.scale), rotation: mix(a.rotation, b.rotation), opacity: mix(a.opacity, b.opacity) };
}

/** The clip as it looks at project time `t`: a copy with the animated values filled in. */
export function animatedAt(clip: Clip, t: number): Clip {
  if (!clip.keyframes || !clip.keyframes.length) return clip;
  return { ...clip, ...valuesAt(clip, t - clip.start) };
}

/** The keyframe sitting at `local` seconds (within a frame or so), if any. */
export function keyframeIndexAt(clip: Clip, local: number): number {
  return clip.keyframes.findIndex((k) => Math.abs(k.t - local) <= KEY_TOLERANCE);
}

const sorted = (ks: Keyframe[]) => ks.slice().sort((a, b) => a.t - b.t);

/**
 * Turns an edit into the patch to store: unchanged for a clip without keyframes; for an animated clip
 * the animated properties go into a keyframe at project time `t` (updated if one is there, added if not).
 */
export function keyedPatch(clip: Clip, patch: Partial<Clip>, t: number): Partial<Clip> {
  if (!clip.keyframes.length) return patch;
  const anim: Partial<KeyframeValues> = {};
  const rest: Partial<Clip> = {};
  for (const [k, v] of Object.entries(patch) as [keyof Clip, never][]) {
    if ((ANIMATED_PROPS as readonly string[]).includes(k)) (anim as Record<string, unknown>)[k] = v;
    else (rest as Record<string, unknown>)[k] = v;
  }
  if (!Object.keys(anim).length) return patch;
  const local = Math.min(Math.max(0, t - clip.start), clip.duration);
  return { ...rest, keyframes: setKeyframe(clip, local, anim) };
}

/** The keyframe list with a keyframe at `local` set to the current values merged with `values`. */
export function setKeyframe(clip: Clip, local: number, values: Partial<KeyframeValues> = {}): Keyframe[] {
  const i = keyframeIndexAt(clip, local);
  const ks = clip.keyframes.map((k) => ({ ...k }));
  if (i >= 0) { Object.assign(ks[i], values); return ks; }
  // a new keyframe takes the ease of the one it follows, so inserting one does not change the feel
  const before = [...ks].reverse().find((k) => k.t < local);
  ks.push({ ...valuesAt(clip, local), ...values, t: local, ease: before?.ease ?? 'ease' });
  return sorted(ks);
}

/** The keyframe list without the keyframe at `local`. */
export function removeKeyframe(clip: Clip, local: number): Keyframe[] {
  const i = keyframeIndexAt(clip, local);
  return i < 0 ? clip.keyframes : clip.keyframes.filter((_, j) => j !== i);
}

/** Starting to animate: the current look becomes the first keyframe. Stopping: the current look stays as the plain values. */
export function toggleAnimation(clip: Clip, t: number): Partial<Clip> {
  const local = Math.min(Math.max(0, t - clip.start), clip.duration);
  if (clip.keyframes.length) return { ...valuesAt(clip, local), keyframes: [] };
  return { keyframes: [{ ...valuesOf(clip), t: local, ease: 'ease' }] };
}

/** Ready-made motions, the way After Effects users reach for animation presets. */
export type MotionPreset = 'kenburns-in' | 'kenburns-out' | 'pan-left' | 'pan-right' | 'spin-in' | 'pop';
export const MOTION_PRESETS: MotionPreset[] = ['kenburns-in', 'kenburns-out', 'pan-left', 'pan-right', 'spin-in', 'pop'];

export function presetKeyframes(clip: Clip, preset: MotionPreset): Keyframe[] {
  const base = valuesOf(clip.keyframes.length ? { ...clip, ...valuesAt(clip, 0) } : clip);
  const end = Math.max(0.1, clip.duration);
  const k = (t: number, v: Partial<KeyframeValues>, ease: KeyframeEase = 'ease'): Keyframe => ({ ...base, ...v, t, ease });
  switch (preset) {
    case 'kenburns-in': return [k(0, {}, 'linear'), k(end, { scale: base.scale * 1.25 })];
    case 'kenburns-out': return [k(0, { scale: base.scale * 1.25 }, 'linear'), k(end, {})];
    case 'pan-left': return [k(0, { x: base.x + 8, scale: base.scale * 1.15 }, 'linear'), k(end, { x: base.x - 8, scale: base.scale * 1.15 })];
    case 'pan-right': return [k(0, { x: base.x - 8, scale: base.scale * 1.15 }, 'linear'), k(end, { x: base.x + 8, scale: base.scale * 1.15 })];
    case 'spin-in': return [k(0, { rotation: base.rotation - 180, scale: base.scale * 0.2, opacity: 0 }, 'ease-out'), k(Math.min(1, end), {})];
    case 'pop': {
      const a = Math.min(0.25, end / 3), b = Math.min(0.45, end / 2);
      return [k(0, { scale: base.scale * 0.3, opacity: 0 }, 'ease-out'), k(a, { scale: base.scale * 1.12 }), k(b, {})];
    }
  }
}
