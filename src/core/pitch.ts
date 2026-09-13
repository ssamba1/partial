export interface PitchOptions {
  sampleRate: number;
  minFrequency?: number;
  maxFrequency?: number;
  /** YIN absolute threshold; lower is stricter. */
  threshold?: number;
  /** Frames quieter than this RMS are treated as silence. */
  minRms?: number;
}

export interface PitchResult {
  frequency: number;
  /** 0..1, 1 = perfectly periodic. */
  clarity: number;
  rms: number;
}

export function rms(frame: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}

/** RMS with the frame mean removed, so a DC offset from a cheap mic does not count as signal. */
export function acRms(frame: ArrayLike<number>): number {
  const n = frame.length;
  if (!n) return 0;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += frame[i];
    sumSq += frame[i] * frame[i];
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/**
 * Analysis frame length for a sample rate: long enough that the longest lag
 * (one period of `minFrequency`) fits twice, as detectPitch needs. 4096 at
 * 44.1 and 48 kHz, 8192 at 88.2 and 96 kHz.
 */
export function frameSizeFor(sampleRate: number, minFrequency = 30): number {
  return Math.min(32768, Math.max(2048, nextPow2(Math.ceil((2 * sampleRate) / minFrequency) + 2)));
}

/** Counters for tests and benchmarks. */
export const pitchStats = { differenceRuns: 0 };

/* ---------- Small in-house FFT (radix 2, in place) ---------- */

const fftTables = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function tablesFor(n: number) {
  let t = fftTables.get(n);
  if (!t) {
    const cos = new Float64Array(n / 2);
    const sin = new Float64Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      cos[k] = Math.cos((2 * Math.PI * k) / n);
      sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    const rev = new Uint32Array(n);
    const bits = Math.round(Math.log2(n));
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      rev[i] = r;
    }
    t = { cos, sin, rev };
    fftTables.set(n, t);
  }
  return t;
}

/** Forward transform uses e^(-i w n); inverse uses e^(+i w n) and divides by n. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  const { cos, sin, rev } = tablesFor(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  const sign = inverse ? 1 : -1;
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let i = 0; i < n; i += size) {
      for (let j = 0; j < half; j++) {
        const wr = cos[j * step];
        const wi = sign * sin[j * step];
        const a = i + j;
        const b = a + half;
        const tr = wr * re[b] - wi * im[b];
        const ti = wr * im[b] + wi * re[b];
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

// Reused between calls so the tuner allocates nothing per frame once sizes settle.
let scratchDiff = new Float32Array(0);
let scratchCmnd = new Float32Array(0);
let aRe = new Float64Array(0);
let aIm = new Float64Array(0);
let bRe = new Float64Array(0);
let bIm = new Float64Array(0);
let prefix = new Float64Array(0);

/**
 * YIN difference function d(tau) = sum over i < window of (x[i] - x[i + tau])^2,
 * for tau in 0..maxLag, computed from an FFT cross-correlation:
 * d(tau) = r_0(0) + r_tau(0) - 2 r(tau). O(N log N) instead of O(N * maxLag).
 */
export function differenceFunction(frame: ArrayLike<number>, window: number, maxLag: number, out: Float32Array): void {
  const n = frame.length;
  const m = nextPow2(n);
  if (aRe.length !== m) {
    aRe = new Float64Array(m);
    aIm = new Float64Array(m);
    bRe = new Float64Array(m);
    bIm = new Float64Array(m);
  }
  if (prefix.length < n + 1) prefix = new Float64Array(n + 1);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += frame[i];
  mean /= n;
  prefix[0] = 0;
  for (let i = 0; i < m; i++) {
    const x = i < n ? frame[i] - mean : 0;
    bRe[i] = x;
    bIm[i] = 0;
    aRe[i] = i < window ? x : 0;
    aIm[i] = 0;
    if (i < n) prefix[i + 1] = prefix[i] + x * x;
  }
  fft(aRe, aIm);
  fft(bRe, bIm);
  // conj(A) * B, then back to the lag domain: the cross-correlation of the first window with the frame.
  for (let i = 0; i < m; i++) {
    const r = aRe[i] * bRe[i] + aIm[i] * bIm[i];
    const q = aRe[i] * bIm[i] - aIm[i] * bRe[i];
    aRe[i] = r;
    aIm[i] = q;
  }
  fft(aRe, aIm, true);
  const r0 = prefix[window];
  for (let tau = 0; tau <= maxLag; tau++) {
    const d = r0 + (prefix[tau + window] - prefix[tau]) - 2 * aRe[tau];
    out[tau] = d > 0 ? d : 0;
  }
  out[0] = 0;
}

/** Reference O(N * maxLag) difference function, kept for tests and the benchmark. */
export function differenceFunctionDirect(frame: ArrayLike<number>, window: number, maxLag: number, out: Float32Array): void {
  out[0] = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const d = frame[i] - frame[i + tau];
      sum += d * d;
    }
    out[tau] = sum;
  }
}

/**
 * YIN pitch detector (de Cheveigne & Kawahara, 2002) with parabolic
 * interpolation of the chosen lag. Returns null for silence or frames with no
 * clear periodicity.
 */
export function detectPitch(frame: Float32Array, opts: PitchOptions): PitchResult | null {
  const { sampleRate } = opts;
  const minFrequency = opts.minFrequency ?? 30;
  const maxFrequency = opts.maxFrequency ?? 4200;
  const threshold = opts.threshold ?? 0.12;
  const minRms = opts.minRms ?? 0.008;

  const level = acRms(frame);
  if (level < minRms) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  let maxTau = Math.floor(sampleRate / minFrequency);
  // Need at least as many samples in the integration window as the longest lag,
  // plus one lag past it so a dip at the longest lag can still be interpolated.
  maxTau = Math.min(maxTau, Math.floor(frame.length / 2) - 1);
  if (maxTau <= minTau + 2) return null;
  const lags = maxTau + 1;
  const window = frame.length - lags;
  if (scratchDiff.length < lags + 1) {
    scratchDiff = new Float32Array(lags + 1);
    scratchCmnd = new Float32Array(lags + 1);
  }
  const diff = scratchDiff;
  const cmnd = scratchCmnd;
  pitchStats.differenceRuns++;
  differenceFunction(frame, window, lags, diff);

  // Cumulative mean normalised difference, stopping just past the first dip below the threshold.
  cmnd[0] = 1;
  let running = 0;
  let candidate = -1;
  let tauEstimate = -1;
  for (let tau = 1; tau <= lags; tau++) {
    const sum = diff[tau];
    running += sum;
    cmnd[tau] = running === 0 ? 1 : (sum * tau) / running;

    if (candidate === -1) {
      if (tau >= minTau && tau <= maxTau && cmnd[tau] < threshold) candidate = tau;
    } else if (cmnd[tau] >= cmnd[tau - 1]) {
      // The dip bottomed out at the previous lag; diff[tau] is already there for interpolation.
      tauEstimate = tau - 1;
      break;
    }
  }
  // A dip still falling at the last lag means the period may be longer than the frame allows: not sure enough to report.
  if (tauEstimate === -1) return null;

  let betterTau = tauEstimate;
  if (tauEstimate > 1) {
    // Interpolate on the raw difference function: the normalisation in cmnd skews
    // the parabola at short lags (high notes) by more than a cent.
    const s0 = diff[tauEstimate - 1];
    const s1 = diff[tauEstimate];
    const s2 = diff[tauEstimate + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (denom !== 0) betterTau = tauEstimate + (s2 - s0) / denom;
  }

  const frequency = sampleRate / betterTau;
  if (frequency < minFrequency || frequency > maxFrequency) return null;
  return { frequency, clarity: Math.max(0, Math.min(1, 1 - cmnd[tauEstimate])), rms: level };
}

/**
 * detectPitch, then for notes above 300 Hz a second pass over only the newest
 * max(1024, 4 periods) samples, so fast passages and note changes register
 * without waiting for the whole long frame to fill with the new note.
 */
export function detectPitchAdaptive(frame: Float32Array, opts: PitchOptions): PitchResult | null {
  const coarse = detectPitch(frame, opts);
  if (!coarse || coarse.frequency <= 300) return coarse;
  const len = Math.max(1024, Math.ceil((4 * opts.sampleRate) / coarse.frequency));
  if (len >= frame.length) return coarse;
  const fine = detectPitch(frame.subarray(frame.length - len), opts);
  if (!fine) return coarse;
  // An octave apart is more likely a short-frame octave error than a real change; the long frame catches real ones.
  const cents = Math.abs(1200 * Math.log2(fine.frequency / coarse.frequency));
  const octaves = Math.round(cents / 1200);
  if (octaves >= 1 && Math.abs(cents - octaves * 1200) < 50) return coarse;
  return fine;
}

/**
 * Median of the last readings, used to steady the tuner display. A jump of more
 * than a semitone must last `confirm` readings before it replaces the current
 * note, so a single octave-error frame never reaches the display.
 */
export class PitchSmoother {
  private values: number[] = [];
  private pending: number[] = [];
  constructor(
    private size = 5,
    private confirm = 1,
  ) {}

  push(value: number | null): number | null {
    if (value === null) {
      this.values = [];
      this.pending = [];
      return null;
    }
    if (this.values.length) {
      const current = median(this.values);
      if (Math.abs(1200 * Math.log2(value / current)) > 100) {
        const lastPending = this.pending[this.pending.length - 1];
        if (lastPending !== undefined && Math.abs(1200 * Math.log2(value / lastPending)) > 100) this.pending = [];
        this.pending.push(value);
        if (this.pending.length < this.confirm) return current;
        // The new pitch has lasted long enough: restart smoothing from it so note changes stay prompt.
        this.values = this.pending;
        this.pending = [];
      } else {
        this.pending = [];
        this.values.push(value);
      }
    } else {
      this.values.push(value);
    }
    while (this.values.length > this.size) this.values.shift();
    return median(this.values);
  }

  reset(): void {
    this.values = [];
    this.pending = [];
  }

  setSize(size: number): void {
    this.size = Math.max(1, Math.floor(size));
    while (this.values.length > this.size) this.values.shift();
  }

  setConfirm(frames: number): void {
    this.confirm = Math.max(1, Math.floor(frames));
  }
}

/** Median; the mean of the two middle values when the count is even. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
