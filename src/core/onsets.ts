/**
 * Onset detection, timing checks and tempo estimation from the microphone or motion sensor.
 * Pure functions and small classes over plain numbers, so they can be unit tested.
 */

/**
 * Spectral flux onset detector: the sum of positive magnitude increases between
 * frames, compared with an adaptive threshold (median of recent flux times a factor
 * plus a floor). A refractory period stops one clap counting twice.
 */
export class FluxOnsetDetector {
  private prev: Float32Array | null = null;
  private history: number[] = [];
  private lastOnset = -Infinity;

  constructor(
    readonly refractoryMs = 150,
    readonly factor = 3,
    readonly floor = 0.02,
    readonly historySize = 30,
  ) {}

  /** Flux of a magnitude frame (linear magnitudes, any scale) against the previous frame. */
  flux(mags: ArrayLike<number>): number {
    let sum = 0;
    if (this.prev && this.prev.length === mags.length) {
      for (let i = 0; i < mags.length; i++) {
        const d = mags[i] - this.prev[i];
        if (d > 0) sum += d;
      }
      sum /= mags.length;
    }
    this.prev = Float32Array.from(mags);
    return sum;
  }

  /** Feed one frame taken at `timeMs`; returns true when it holds an onset. */
  push(mags: ArrayLike<number>, timeMs: number): boolean {
    const f = this.flux(mags);
    return this.pushFlux(f, timeMs);
  }

  /** Feed a flux (or any onset strength) value directly. */
  pushFlux(f: number, timeMs: number): boolean {
    const sorted = [...this.history].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    this.history.push(f);
    if (this.history.length > this.historySize) this.history.shift();
    if (f <= this.floor || f <= median * this.factor) return false;
    if (timeMs - this.lastOnset < this.refractoryMs) return false;
    this.lastOnset = timeMs;
    return true;
  }
}

/** Acceleration peak detector for knocking the phone: a jump in magnitude above a threshold, with a refractory period. */
export class KnockDetector {
  private last = -Infinity;
  private prev = 0;
  constructor(
    readonly threshold = 12,
    readonly refractoryMs = 150,
  ) {}

  /** Feed acceleration (m/s^2, gravity removed where possible); returns true on a knock. */
  push(x: number, y: number, z: number, timeMs: number): boolean {
    const mag = Math.hypot(x, y, z);
    const jump = mag - this.prev;
    this.prev = mag;
    if (jump < this.threshold || timeMs - this.last < this.refractoryMs) return false;
    this.last = timeMs;
    return true;
  }
}

export interface TimingStats {
  /** Matched onsets. */
  count: number;
  /** Mean offset in ms: positive is late. */
  meanMs: number;
  /** Standard deviation in ms. */
  spreadMs: number;
  /** Mean offset per beat of the bar, NaN where no onset matched. */
  perBeatMs: number[];
  /** Change in mean offset from the first half of the matches to the second, in ms (positive: getting later). */
  driftMs: number;
}

/**
 * Match each played onset to the nearest scheduled beat (including muted beats,
 * so silent gap-trainer bars still count) and summarise the timing.
 * Times are seconds on one clock; `latency` (seconds) is subtracted from the onsets
 * first, for the delay between a sound and the app hearing it.
 * Onsets further than `window` seconds from any beat are ignored.
 */
export function timingStats(onsets: number[], beats: { time: number; beat: number }[], beatsPerBar: number, latency = 0, window = 0.15): TimingStats {
  const sortedBeats = [...beats].sort((a, b) => a.time - b.time);
  const offsets: { ms: number; beat: number }[] = [];
  let j = 0;
  for (const raw of [...onsets].sort((a, b) => a - b)) {
    const t = raw - latency;
    while (j + 1 < sortedBeats.length && Math.abs(sortedBeats[j + 1].time - t) <= Math.abs(sortedBeats[j].time - t)) j++;
    const b = sortedBeats[j];
    if (!b || Math.abs(t - b.time) > window) continue;
    offsets.push({ ms: (t - b.time) * 1000, beat: b.beat });
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, x) => a + x, 0) / xs.length : NaN);
  const all = offsets.map((o) => o.ms);
  const m = mean(all);
  const spread = all.length ? Math.sqrt(mean(all.map((x) => (x - m) ** 2))) : NaN;
  const perBeatMs = Array.from({ length: Math.max(1, beatsPerBar) }, (_, i) => mean(offsets.filter((o) => o.beat === i).map((o) => o.ms)));
  const half = Math.floor(all.length / 2);
  const driftMs = all.length >= 4 ? mean(all.slice(half)) - mean(all.slice(0, half)) : 0;
  return { count: all.length, meanMs: m, spreadMs: spread, perBeatMs, driftMs };
}

/**
 * Tempo from an onset-strength envelope sampled at `rate` frames per second:
 * autocorrelation over lags for 40 to 240 BPM. Candidates within 5% of the best
 * score are resolved toward the one nearest 120 BPM. That is a choice made here, not a
 * sourced rule; it picks between octave errors (half or double tempo). Returns null when the
 * envelope has no periodic peak.
 */
export function estimateTempo(envelope: number[], rate: number, minBpm = 40, maxBpm = 240): number | null {
  const n = envelope.length;
  const mean = envelope.reduce((a, x) => a + x, 0) / Math.max(1, n);
  const x = envelope.map((v) => v - mean);
  const energy = x.reduce((a, v) => a + v * v, 0);
  if (!(energy > 0)) return null;
  const minLag = Math.max(1, Math.floor((60 * rate) / maxBpm));
  const maxLag = Math.min(n - 1, Math.ceil((60 * rate) / minBpm));
  const scores: { lag: number; score: number }[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    scores.push({ lag, score: s / energy });
  }
  // Local maxima only.
  const peaks = scores.filter((p, i) => p.score > 0 && (i === 0 || p.score >= scores[i - 1].score) && (i === scores.length - 1 || p.score >= scores[i + 1].score));
  if (!peaks.length) return null;
  const best = Math.max(...peaks.map((p) => p.score));
  if (best < 0.1) return null;
  const refine = (lag: number) => {
    // Parabolic interpolation around the peak lag.
    const i = lag - minLag;
    const a = scores[i - 1]?.score;
    const b = scores[i].score;
    const c = scores[i + 1]?.score;
    if (a === undefined || c === undefined) return lag;
    const d = a - 2 * b + c;
    return d === 0 ? lag : lag + (0.5 * (a - c)) / d;
  };
  const near = peaks.filter((p) => p.score >= best * 0.95);
  const bpmOf = (p: { lag: number }) => (60 * rate) / refine(p.lag);
  near.sort((p, q) => Math.abs(Math.log2(bpmOf(p) / 120)) - Math.abs(Math.log2(bpmOf(q) / 120)));
  return Math.round(bpmOf(near[0]) * 10) / 10;
}

/**
 * WCAG 2.3.1 Three Flashes or Below Threshold (https://www.w3.org/TR/WCAG22/#three-flashes-or-below-threshold):
 * "Web pages do not contain anything that flashes more than three times in any one second period".
 * Returns whether a beat may flash: at most three flashes in any second, and only downbeats above 180 BPM.
 */
export class FlashLimiter {
  private times: number[] = [];
  allow(timeMs: number, bpm: number, downbeat: boolean): boolean {
    if (bpm > 180 && !downbeat) return false;
    this.times = this.times.filter((t) => timeMs - t < 1000);
    if (this.times.length >= 3) return false;
    this.times.push(timeMs);
    return true;
  }
  reset(): void {
    this.times = [];
  }
}
