/**
 * Phase strobe. Each analyser buffer is multiplied by quadrature oscillators at
 * the target frequency (and at 2x and 4x for the partial rows), Hann weighted
 * and averaged, which low-passes the product. The angle of the result is the
 * signal's phase against the reference, so it stands still when the partial is
 * exactly on target and turns at (partial - target) cycles per second otherwise.
 *
 * The oscillators need an absolute sample count, and analyser buffers overlap by
 * an unknown amount, so SampleClock lines consecutive buffers up sample by sample.
 */

/** Tracks the absolute sample index of the end of each analyser buffer. */
export class SampleClock {
  /** Absolute index one past the last sample of the latest buffer. */
  end = 0;
  private prev: Float32Array | null = null;
  /** Shift applied by the last advance, and whether it came from matching samples. */
  lastShift = 0;
  matched = false;

  constructor(private probe = 24) {}

  /**
   * Feed the next buffer. `estimate` is the expected number of new samples (from
   * the audio clock); the exact shift is found by matching the previous buffer's
   * last samples inside the new one, searching outward from the estimate.
   */
  advance(buf: Float32Array, estimate: number): number {
    const n = buf.length;
    let shift = Math.max(0, Math.round(estimate));
    this.matched = false;
    if (this.prev && this.prev.length === n && hasSignal(this.prev, n - this.probe, n)) {
      const found = findShift(this.prev, buf, this.probe, Math.min(shift, n - this.probe));
      if (found !== null) {
        shift = found;
        this.matched = true;
      }
    }
    this.end += shift;
    this.lastShift = shift;
    if (!this.prev || this.prev.length !== n) this.prev = new Float32Array(n);
    this.prev.set(buf);
    return shift;
  }

  reset(): void {
    this.end = 0;
    this.prev = null;
    this.lastShift = 0;
    this.matched = false;
  }
}

function hasSignal(buf: Float32Array, from: number, to: number): boolean {
  for (let i = from; i < to; i++) if (buf[i] !== 0) return true;
  return false;
}

/** Shift s such that next[n - 1 - s - j] equals prev[n - 1 - j] for the probe, nearest the estimate first. */
function findShift(prev: Float32Array, next: Float32Array, probe: number, estimate: number): number | null {
  const n = prev.length;
  const maxShift = n - probe;
  const matches = (s: number) => {
    for (let j = 0; j < probe; j++) if (next[n - 1 - s - j] !== prev[n - 1 - j]) return false;
    return true;
  };
  for (let d = 0; d <= maxShift; d++) {
    const lo = estimate - d;
    const hi = estimate + d;
    if (lo >= 0 && matches(lo)) return lo;
    if (d > 0 && hi <= maxShift && matches(hi)) return hi;
    if (lo < 0 && hi > maxShift) break;
  }
  return null;
}

export interface StrobeRow {
  /** Phase against the reference, in cycles, 0 to 1. */
  phase: number;
  /** Amplitude of this partial relative to a full-scale sine of the frame's RMS, about 0 to 1. */
  strength: number;
}

const hannCache = new Map<number, { w: Float64Array; sum: number }>();
function hann(n: number) {
  let c = hannCache.get(n);
  if (!c) {
    const w = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
      sum += w[i];
    }
    c = { w, sum };
    hannCache.set(n, c);
  }
  return c;
}

/** Phase and strength of the component near `frequency` in a buffer whose first sample has absolute index `start`. */
export function demodulate(buf: Float32Array, sampleRate: number, frequency: number, start: number): StrobeRow {
  const n = buf.length;
  const { w, sum } = hann(n);
  const cyclesPerSample = frequency / sampleRate;
  // Starting phase reduced to one cycle; doubles keep it well under a thousandth of a cycle for days of audio.
  const base = ((start * cyclesPerSample) % 1 + 1) % 1;
  let re = 0;
  let im = 0;
  let energy = 0;
  for (let i = 0; i < n; i++) {
    const a = 2 * Math.PI * (base + i * cyclesPerSample);
    const x = buf[i] * w[i];
    re += x * Math.cos(a);
    im -= x * Math.sin(a);
    energy += buf[i] * buf[i];
  }
  const rms = Math.sqrt(energy / n);
  const amplitude = (2 * Math.hypot(re, im)) / sum;
  const phase = ((Math.atan2(im, re) / (2 * Math.PI)) % 1 + 1) % 1;
  return { phase, strength: rms > 0 ? amplitude / (Math.SQRT2 * rms) : 0 };
}

/** Partials shown by the strobe rows. */
export const STROBE_PARTIALS = [1, 2, 4];

/** Phase rows for one buffer at the fundamental target and its partials; rows above Nyquist come back with zero strength. */
export class PhaseStrobe {
  readonly clock = new SampleClock();

  update(buf: Float32Array, sampleRate: number, target: number | null, estimateShift: number): StrobeRow[] | null {
    this.clock.advance(buf, estimateShift);
    if (!target || !(target > 0)) return null;
    const start = this.clock.end - buf.length;
    return STROBE_PARTIALS.map((k) =>
      k * target < sampleRate / 2 - 200 ? demodulate(buf, sampleRate, k * target, start) : { phase: 0, strength: 0 },
    );
  }

  reset(): void {
    this.clock.reset();
  }
}
