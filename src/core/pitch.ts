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

// Reused between calls so the tuner allocates nothing per frame.
let scratchDiff = new Float32Array(0);
let scratchCmnd = new Float32Array(0);

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

  const level = rms(frame);
  if (level < minRms) return null;

  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency));
  let maxTau = Math.floor(sampleRate / minFrequency);
  // Need at least as many samples in the integration window as the longest lag.
  maxTau = Math.min(maxTau, Math.floor(frame.length / 2));
  if (maxTau <= minTau + 2) return null;
  const window = frame.length - maxTau;
  if (scratchDiff.length < maxTau + 2) {
    scratchDiff = new Float32Array(maxTau + 2);
    scratchCmnd = new Float32Array(maxTau + 2);
  }
  const diff = scratchDiff;
  const cmnd = scratchCmnd;

  // Difference function and cumulative mean normalised difference, computed one
  // lag at a time so we can stop just past the first dip below the threshold.
  // For most notes that is a small fraction of the lags, which keeps the tuner
  // light enough to run every animation frame on a phone.
  cmnd[0] = 1;
  let running = 0;
  let candidate = -1;
  let tauEstimate = -1;
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    for (let i = 0; i < window; i++) {
      const d = frame[i] - frame[i + tau];
      sum += d * d;
    }
    diff[tau] = sum;
    running += sum;
    cmnd[tau] = running === 0 ? 1 : (sum * tau) / running;

    if (candidate === -1) {
      if (tau >= minTau && cmnd[tau] < threshold) candidate = tau;
    } else if (cmnd[tau] >= cmnd[tau - 1]) {
      // The dip bottomed out at the previous lag; diff[tau] is already there for interpolation.
      tauEstimate = tau - 1;
      break;
    }
  }
  if (candidate !== -1 && tauEstimate === -1) tauEstimate = maxTau;
  if (tauEstimate === -1) return null;

  let betterTau = tauEstimate;
  if (tauEstimate > 1 && tauEstimate < maxTau) {
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

/** Median of the last readings, used to steady the tuner display. */
export class PitchSmoother {
  private values: number[] = [];
  constructor(private size = 5) {}

  push(value: number | null): number | null {
    if (value === null) {
      this.values = [];
      return null;
    }
    // A jump of more than a semitone restarts smoothing so note changes are immediate.
    const last = this.values[this.values.length - 1];
    if (last !== undefined && Math.abs(1200 * Math.log2(value / last)) > 100) this.values = [];
    this.values.push(value);
    if (this.values.length > this.size) this.values.shift();
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  }

  reset(): void {
    this.values = [];
  }

  setSize(size: number): void {
    this.size = Math.max(1, Math.floor(size));
    while (this.values.length > this.size) this.values.shift();
  }
}
