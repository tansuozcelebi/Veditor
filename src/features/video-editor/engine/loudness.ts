// ===================== Loudness metering =====================
// Momentary (400 ms), short-term (3 s) and integrated loudness in LUFS after ITU-R BS.1770 /
// EBU R128, plus sample peak, measured on the programme mix (before the monitor volume) – the
// meters FilmCraft shows beside its timeline. The K-weighting is the standard's two stages built
// from Web Audio filters (a +4 dB high shelf around 1.7 kHz and a 38 Hz high-pass), so readings
// are close to, not bit-exact with, a reference meter. Integrated loudness gates 400 ms blocks
// (overlapping by 75 %) at −70 LUFS absolute and −10 LU relative, as R128 does.

export interface LoudnessReading {
  momentary: number; shortTerm: number; integrated: number;
  /** Sample peak of the last 100 ms per channel, dBFS. */
  peak: [number, number];
  /** Highest peak since the last reset, dBFS. */
  maxPeak: number;
}

const BLOCK = 0.1; // s
const toLufs = (power: number) => (power > 0 ? -0.691 + 10 * Math.log10(power) : -Infinity);
const toDb = (amp: number) => (amp > 0 ? 20 * Math.log10(amp) : -Infinity);

export class LoudnessMeter {
  private analysers: AnalyserNode[] = [];
  private raw: AnalyserNode[] = [];
  private buf: Float32Array<ArrayBuffer>;
  private blocks: number[] = [];      // mean square (summed over channels) of each 100 ms block, newest last
  private gated: number[] = [];       // momentary powers kept for the integrated reading
  private maxPeak = -Infinity;
  private sampleRate: number;

  constructor(ctx: BaseAudioContext, input: AudioNode) {
    this.sampleRate = ctx.sampleRate;
    const split = ctx.createChannelSplitter(2);
    input.connect(split);
    for (let ch = 0; ch < 2; ch++) {
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'highshelf'; shelf.frequency.value = 1681.97; shelf.gain.value = 4;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 38.13; hp.Q.value = 0.5;
      const an = ctx.createAnalyser(); an.fftSize = 32768;
      const rawAn = ctx.createAnalyser(); rawAn.fftSize = 8192;
      split.connect(shelf, ch); shelf.connect(hp); hp.connect(an);
      split.connect(rawAn, ch);
      this.analysers.push(an); this.raw.push(rawAn);
    }
    this.buf = new Float32Array(32768);
  }

  /** Forget the history (integrated loudness and max peak start again). */
  reset() { this.blocks = []; this.gated = []; this.maxPeak = -Infinity; }

  /** Takes the newest 100 ms block; call about every 100 ms while the programme plays. */
  sample(): LoudnessReading {
    const n = Math.min(this.buf.length, Math.round(this.sampleRate * BLOCK));
    let power = 0;
    for (const an of this.analysers) {
      an.getFloatTimeDomainData(this.buf);
      let s = 0;
      for (let i = this.buf.length - n; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
      power += s / n;
    }
    const peak: [number, number] = [-Infinity, -Infinity];
    const rawBuf = this.buf.subarray(0, 8192);
    this.raw.forEach((an, ch) => {
      an.getFloatTimeDomainData(rawBuf);
      let m = 0;
      for (let i = rawBuf.length - Math.min(n, rawBuf.length); i < rawBuf.length; i++) m = Math.max(m, Math.abs(rawBuf[i]));
      peak[ch] = toDb(m);
    });
    this.maxPeak = Math.max(this.maxPeak, peak[0], peak[1]);
    this.blocks.push(power);
    if (this.blocks.length > 30) this.blocks.shift();
    const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
    const mPow = mean(this.blocks.slice(-4));
    if (this.blocks.length >= 4) this.gated.push(mPow);
    return { momentary: toLufs(mPow), shortTerm: this.blocks.length >= 30 ? toLufs(mean(this.blocks)) : -Infinity, integrated: integrated(this.gated), peak, maxPeak: this.maxPeak };
  }
}

/** Gated integrated loudness of 400 ms block powers (R128: −70 LUFS absolute, −10 LU relative gate). */
export function integrated(blocks: number[]): number {
  const abs = blocks.filter((p) => toLufs(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = toLufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const kept = abs.filter((p) => toLufs(p) > rel);
  return kept.length ? toLufs(kept.reduce((a, b) => a + b, 0) / kept.length) : -Infinity;
}
