// ===================== Clip audio effects =====================
// FilmCraft gives every clip a chain of effects from its own DSP library; here the same set is
// built from Web Audio nodes, so it runs in the preview and in the export alike:
//   high-pass → low-pass → EQ (low shelf, bell, high shelf) → compressor + make-up
//   → dry + echo (feedback delay) + reverb (generated impulse) → pan
// A clip whose effects are all neutral gets no chain at all. Parameters change smoothly while the
// chain runs; the reverb impulse is rebuilt only when its decay changes.
import type { AudioFx } from './types';
import { defaultAudioFx } from './state';

export interface AudioFxChain {
  input: AudioNode;
  output: AudioNode;
  /** Applies new settings without rebuilding the chain. */
  update: (fx: AudioFx) => void;
  disconnect: () => void;
}

const impulses = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();

/** A stereo reverb impulse: decaying noise, a little different per channel so it sounds wide. */
function impulse(ctx: BaseAudioContext, decay: number): AudioBuffer {
  const key = Math.round(decay * 10) / 10;
  let cache = impulses.get(ctx);
  if (!cache) { cache = new Map(); impulses.set(ctx, cache); }
  const hit = cache.get(key);
  if (hit) return hit;
  const len = Math.max(1, Math.round(ctx.sampleRate * Math.max(0.1, key)));
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  // a fixed seed: the same decay always sounds the same (and renders the same in an export)
  let seed = 0x9e3779b9;
  const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return ((seed >>> 0) / 4294967296) * 2 - 1; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, 3) * Math.exp((-3 * i) / len);
  }
  cache.set(key, buf);
  return buf;
}

const dbToGain = (db: number) => Math.pow(10, db / 20);

export function buildAudioFx(ctx: BaseAudioContext, initial: AudioFx = defaultAudioFx()): AudioFxChain {
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.707;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.707;
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 120;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.Q.value = 1;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 8000;
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  const post = ctx.createGain();           // after dynamics: the dry signal and both sends start here
  const dry = ctx.createGain();
  const delay = ctx.createDelay(2), feedback = ctx.createGain(), delayWet = ctx.createGain();
  const conv = ctx.createConvolver(), reverbWet = ctx.createGain();
  const pan = ctx.createStereoPanner();
  const output = ctx.createGain();

  input.connect(hp); hp.connect(lp); lp.connect(low); low.connect(mid); mid.connect(high);
  post.connect(dry); dry.connect(pan);
  post.connect(delay); delay.connect(feedback); feedback.connect(delay); delay.connect(delayWet); delayWet.connect(pan);
  post.connect(conv); conv.connect(reverbWet); reverbWet.connect(pan);
  pan.connect(output);

  let compWired: boolean | null = null;
  let reverbDecay = -1;
  const set = (p: AudioParam, v: number) => { if (ctx instanceof AudioContext && ctx.state === 'running') p.setTargetAtTime(v, ctx.currentTime, 0.02); else p.value = v; };

  const update = (fx: AudioFx) => {
    const nyq = ctx.sampleRate / 2 - 100;
    // an "off" filter is moved out of the audible band rather than unplugged, so nothing clicks
    set(hp.frequency, fx.highPass > 0 ? Math.min(nyq, fx.highPass) : 5);
    set(lp.frequency, fx.lowPass > 0 ? Math.min(nyq, fx.lowPass) : nyq);
    set(low.gain, fx.eqLow); set(mid.gain, fx.eqMid); set(mid.frequency, Math.min(nyq, Math.max(20, fx.eqMidFreq))); set(high.gain, fx.eqHigh);
    // the compressor is in the path only while it is on (a bypassed DynamicsCompressor still colours the sound)
    if (compWired !== fx.compOn) {
      compWired = fx.compOn;
      try { high.disconnect(); comp.disconnect(); makeup.disconnect(); } catch { /* not connected yet */ }
      if (fx.compOn) { high.connect(comp); comp.connect(makeup); makeup.connect(post); } else high.connect(post);
    }
    set(comp.threshold, fx.compThreshold); set(comp.ratio, Math.max(1, fx.compRatio));
    set(comp.attack, Math.max(0, fx.compAttack) / 1000); set(comp.release, Math.max(0.01, fx.compRelease / 1000)); set(comp.knee, 6);
    set(makeup.gain, dbToGain(fx.compMakeup));
    set(delay.delayTime, Math.min(2, Math.max(0.01, fx.delayTime)));
    set(feedback.gain, Math.min(0.9, Math.max(0, fx.delayFeedback)));
    set(delayWet.gain, Math.max(0, fx.delayMix));
    if (fx.reverbMix > 0 && Math.abs(fx.reverbDecay - reverbDecay) > 0.05) { reverbDecay = fx.reverbDecay; conv.buffer = impulse(ctx, fx.reverbDecay); }
    set(reverbWet.gain, Math.max(0, fx.reverbMix));
    // a wet-heavy mix keeps its level: the dry part eases off as the effects come in
    set(dry.gain, 1 - 0.3 * Math.min(1, Math.max(fx.delayMix, fx.reverbMix)));
    set(pan.pan, Math.min(1, Math.max(-1, fx.pan)));
  };
  update(initial);

  return {
    input, output, update,
    disconnect: () => { for (const n of [input, hp, lp, low, mid, high, comp, makeup, post, dry, delay, feedback, delayWet, conv, reverbWet, pan, output]) { try { n.disconnect(); } catch { /* ignore */ } } },
  };
}

/** Ready-made settings for common jobs. */
export const AUDIO_FX_PRESETS: { key: string; fx: Partial<AudioFx> }[] = [
  { key: 'voice', fx: { highPass: 80, eqLow: -2, eqMid: 3, eqMidFreq: 3000, eqHigh: 2, compOn: true, compThreshold: -20, compRatio: 3, compMakeup: 4 } },
  { key: 'podcast', fx: { highPass: 70, eqMid: 2, eqMidFreq: 2500, compOn: true, compThreshold: -26, compRatio: 4, compAttack: 5, compRelease: 200, compMakeup: 6 } },
  { key: 'deRumble', fx: { highPass: 100 } },
  { key: 'telephone', fx: { highPass: 300, lowPass: 3400, eqMid: 6, eqMidFreq: 1500 } },
  { key: 'radio', fx: { highPass: 200, lowPass: 6000, eqMid: 4, eqMidFreq: 2000, compOn: true, compThreshold: -30, compRatio: 8, compMakeup: 8 } },
  { key: 'bassBoost', fx: { eqLow: 8 } },
  { key: 'warm', fx: { eqLow: 3, eqHigh: -3 } },
  { key: 'bright', fx: { eqHigh: 5, eqMid: 1, eqMidFreq: 5000 } },
  { key: 'muffled', fx: { lowPass: 800 } },
  { key: 'echo', fx: { delayTime: 0.35, delayFeedback: 0.45, delayMix: 0.4 } },
  { key: 'room', fx: { reverbDecay: 0.8, reverbMix: 0.25 } },
  { key: 'hall', fx: { reverbDecay: 3.5, reverbMix: 0.45 } },
];
