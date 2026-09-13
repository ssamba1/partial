import { midiToFrequency, ratioToCents, type TuningSystem } from './notes';
import { fft, median } from './pitch';

/* ---------- Haptic direction cues ---------- */

/** Vibration patterns in ms: two short pulses when sharp, one long pulse when flat. */
export const HAPTIC_SHARP = [40, 90, 40];
export const HAPTIC_FLAT = [260];

/** Picks a vibration pattern for a reading, at most once every `intervalMs`, and nothing when in tune. */
export class HapticCues {
  private last = -Infinity;
  constructor(private intervalMs = 1000) {}

  next(cents: number | null, tolerance: number, nowMs: number): number[] | null {
    if (cents === null || !Number.isFinite(cents) || Math.abs(cents) <= tolerance) return null;
    if (nowMs - this.last < this.intervalMs) return null;
    this.last = nowMs;
    return cents > 0 ? HAPTIC_SHARP : HAPTIC_FLAT;
  }

  reset(): void {
    this.last = -Infinity;
  }
}

/* ---------- Averaged measurement ---------- */

export interface Measurement {
  count: number;
  meanHz: number;
  sdHz: number;
  meanCents: number;
  sdCents: number;
}

/** Mean and standard deviation of a set of readings; null with fewer than 3. */
export function measure(readings: readonly { hz: number; cents: number }[]): Measurement | null {
  const r = readings.filter((x) => Number.isFinite(x.hz) && x.hz > 0 && Number.isFinite(x.cents));
  if (r.length < 3) return null;
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const sd = (v: number[], m: number) => Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / (v.length - 1));
  const hz = r.map((x) => x.hz);
  const cents = r.map((x) => x.cents);
  const meanHz = mean(hz);
  const meanCents = mean(cents);
  return { count: r.length, meanHz, sdHz: sd(hz, meanHz), meanCents, sdCents: sd(cents, meanCents) };
}

/** Median frequency of a set of readings, or null when there are none. */
export function medianHz(readings: readonly number[]): number | null {
  const r = readings.filter((x) => Number.isFinite(x) && x > 0);
  return r.length ? median(r) : null;
}

/* ---------- Vocal range ---------- */

/**
 * Lowest and highest notes held for at least `holdSeconds`. Feed one reading
 * per frame; a note counts once it has lasted that long without a break.
 */
export class RangeFinder {
  low: number | null = null;
  high: number | null = null;
  private midi: number | null = null;
  private since = 0;

  constructor(private holdSeconds = 0.5) {}

  push(midi: number | null, time: number): void {
    if (midi !== this.midi) {
      this.midi = midi;
      this.since = time;
      return;
    }
    if (midi === null || time - this.since < this.holdSeconds) return;
    if (this.low === null || midi < this.low) this.low = midi;
    if (this.high === null || midi > this.high) this.high = midi;
  }

  reset(): void {
    this.low = this.high = this.midi = null;
  }
}

/* ---------- Pitch drift ---------- */

/** "ended 35¢ flat", comparing where a piece ended with its starting reference. */
export function driftText(referenceHz: number, endHz: number, tolerance = 5): string {
  const c = ratioToCents(endHz / referenceHz);
  const r = Math.round(Math.abs(c));
  if (Math.abs(c) <= tolerance) return `ended in tune (${c >= 0 ? '+' : '−'}${r}¢)`;
  return `ended ${r}¢ ${c > 0 ? 'sharp' : 'flat'}`;
}

/* ---------- Ensemble tuning log ---------- */

export interface TuningCheckEntry {
  player: string;
  instrument: string;
  note: string;
  cents: number;
  time: number;
}

export type TuningCheckSort = 'time' | 'player' | 'cents';

export function sortTuningChecks(entries: readonly TuningCheckEntry[], by: TuningCheckSort): TuningCheckEntry[] {
  const out = [...entries];
  if (by === 'player') out.sort((a, b) => a.player.localeCompare(b.player) || a.time - b.time);
  else if (by === 'cents') out.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
  else out.sort((a, b) => a.time - b.time);
  return out;
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tuningChecksCsv(entries: readonly TuningCheckEntry[]): string {
  const rows = [['time', 'player', 'instrument', 'note', 'cents'].join(',')];
  for (const e of entries) rows.push([new Date(e.time).toISOString(), e.player, e.instrument, e.note, e.cents.toFixed(1)].map(csvCell).join(','));
  return rows.join('\n');
}

/* ---------- Spectrum peaks ---------- */

export interface Peak {
  hz: number;
  /** Magnitude in dB relative to the strongest peak found. */
  db: number;
}

/**
 * Strongest spectral peaks between `minHz` and `maxHz`: Hann window, zero
 * padding to at least `padTo` points, local maxima refined by fitting a
 * parabola to the log magnitude of the three bins around each. Peaks closer
 * than `minSeparationCents` to a stronger one are dropped. Sorted by frequency.
 */
export function spectrumPeaks(
  samples: ArrayLike<number>,
  sampleRate: number,
  opts: { count?: number; minHz?: number; maxHz?: number; padTo?: number; minSeparationCents?: number } = {},
): Peak[] {
  const count = opts.count ?? 5;
  const n = samples.length;
  let size = 1;
  while (size < Math.max(n, opts.padTo ?? 32768)) size <<= 1;
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += samples[i];
  mean /= n || 1;
  for (let i = 0; i < n; i++) re[i] = (samples[i] - mean) * 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, n - 1)));
  fft(re, im);
  const binHz = sampleRate / size;
  const lo = Math.max(1, Math.floor((opts.minHz ?? 20) / binHz));
  const hi = Math.min(size / 2 - 2, Math.ceil((opts.maxHz ?? sampleRate / 2) / binHz));
  const mag = new Float64Array(hi + 2);
  for (let k = lo - 1; k <= hi + 1; k++) mag[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) + 1e-12);
  const found: Peak[] = [];
  for (let k = lo; k <= hi; k++) {
    if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1]) {
      const a = mag[k - 1];
      const b = mag[k];
      const c = mag[k + 1];
      const d = a - 2 * b + c;
      const p = d === 0 ? 0 : (0.5 * (a - c)) / d;
      found.push({ hz: (k + p) * binHz, db: b - 0.25 * (a - c) * p });
    }
  }
  found.sort((x, y) => y.db - x.db);
  const sep = opts.minSeparationCents ?? 30;
  const kept: Peak[] = [];
  for (const f of found) {
    if (kept.length >= count) break;
    if (kept.every((k) => Math.abs(ratioToCents(f.hz / k.hz)) >= sep)) kept.push(f);
  }
  const top = kept[0]?.db ?? 0;
  return kept.map((k) => ({ hz: k.hz, db: k.db - top })).sort((x, y) => x.hz - y.hz);
}

/* ---------- Struck notes (timpani) ---------- */

/**
 * Catches the strike of a drum: a level rise of `riseDb` within 50 ms after at
 * least `quietMs` of lower level. `ready` turns true `analyseAtMs` after the
 * strike, when the samples from `fromMs` onward can be analysed, and stays
 * false until the next strike once it has been taken.
 */
export class StrikeWatcher {
  private levels: { t: number; level: number }[] = [];
  private strikeAt: number | null = null;
  private taken = true;

  constructor(
    private riseDb = 9,
    public analyseAtMs = 400,
    public fromMs = 50,
  ) {}

  update(level: number, nowMs: number): { ready: boolean; strikeAt: number | null } {
    const v = Math.max(1e-4, level);
    while (this.levels.length && nowMs - this.levels[0].t > 50) this.levels.shift();
    let low = Infinity;
    for (const l of this.levels) low = Math.min(low, l.level);
    this.levels.push({ t: nowMs, level: v });
    const rising = low !== Infinity && v >= low * Math.pow(10, this.riseDb / 20);
    if (rising && (this.strikeAt === null || nowMs - this.strikeAt > this.analyseAtMs)) {
      this.strikeAt = nowMs;
      this.taken = false;
    }
    const ready = !this.taken && this.strikeAt !== null && nowMs - this.strikeAt >= this.analyseAtMs;
    if (ready) this.taken = true;
    return { ready, strikeAt: this.strikeAt };
  }

  reset(): void {
    this.levels = [];
    this.strikeAt = null;
    this.taken = true;
  }
}

/** Strongest peak of a struck note between `minHz` and `maxHz`, or null. */
export function strikePitch(samples: ArrayLike<number>, sampleRate: number, minHz: number, maxHz: number): number | null {
  const peaks = spectrumPeaks(samples, sampleRate, { count: 1, minHz, maxHz, padTo: 65536 });
  return peaks[0]?.hz ?? null;
}

/* ---------- Beats ---------- */

/** RMS of consecutive blocks of `block` samples: a slow envelope for beat measurement. */
export function blockEnvelope(samples: ArrayLike<number>, block: number): Float64Array {
  const out = new Float64Array(Math.floor(samples.length / block));
  for (let b = 0; b < out.length; b++) {
    let s = 0;
    for (let i = b * block; i < (b + 1) * block; i++) s += samples[i] * samples[i];
    out[b] = Math.sqrt(s / block);
  }
  return out;
}

/**
 * Beat rate in Hz from an envelope sampled at `rate` Hz: the first strong peak
 * of its normalised autocorrelation between 1/maxHz and 1/minHz seconds.
 * Null when the envelope does not repeat clearly (no beats, or too short).
 */
export function beatRateFromEnvelope(env: ArrayLike<number>, rate: number, minHz = 0.2, maxHz = 15): { hz: number; strength: number } | null {
  const n = env.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += env[i];
  mean /= n || 1;
  const x = Float64Array.from({ length: n }, (_, i) => env[i] - mean);
  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  // A steady tone still ripples a little in a block envelope; beats swing the level by far more.
  if (energy <= 1e-12 || Math.sqrt(energy / n) < 0.05 * Math.abs(mean)) return null;
  const minLag = Math.max(1, Math.floor(rate / maxHz));
  // At least two beat periods must fit, or the autocorrelation says little.
  const maxLag = Math.min(Math.ceil(rate / minHz), Math.floor(n / 2));
  if (maxLag <= minLag + 1) return null;
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    // Unbiased: scale for the shrinking overlap, then normalise by the energy.
    ac[lag] = lag >= 0 ? (s / (n - lag)) * (n / energy) : 1;
  }
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) best = Math.max(best, ac[lag]);
  if (best < 0.3) return null;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (ac[lag] >= 0.85 * best && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
      const a = ac[lag - 1];
      const b = ac[lag];
      const c = ac[lag + 1];
      const d = a - 2 * b + c;
      const p = d === 0 ? 0 : (0.5 * (a - c)) / d;
      return { hz: rate / (lag + p), strength: b };
    }
  }
  return null;
}

/** Beat rate of a recording, from a 200 Hz envelope. */
export function beatRate(samples: ArrayLike<number>, sampleRate: number, minHz = 0.2, maxHz = 15): { hz: number; strength: number } | null {
  const block = Math.max(1, Math.round(sampleRate / 200));
  return beatRateFromEnvelope(blockEnvelope(samples, block), sampleRate / block, minHz, maxHz);
}

/** Cents between two tones `beats` Hz apart around `hz`. */
export function beatCents(hz: number, beats: number): number {
  return ratioToCents((hz + beats / 2) / (hz - beats / 2));
}

/**
 * Live beat meter: collects a level per frame with its time, resamples the
 * last `seconds` to an even `rate`, and measures the beat rate.
 */
export class BeatMeter {
  private points: { t: number; v: number }[] = [];
  constructor(
    private seconds = 6,
    private rate = 60,
  ) {}

  push(time: number, level: number): void {
    this.points.push({ t: time, v: level });
    while (this.points.length && time - this.points[0].t > this.seconds) this.points.shift();
  }

  read(minHz = 0.4, maxHz = 12): { hz: number; strength: number } | null {
    const p = this.points;
    if (p.length < 8) return null;
    const span = p[p.length - 1].t - p[0].t;
    const n = Math.floor(span * this.rate);
    if (n < 16) return null;
    const env = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = p[0].t + i / this.rate;
      while (j < p.length - 2 && p[j + 1].t < t) j++;
      const a = p[j];
      const b = p[j + 1];
      const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
      env[i] = a.v + (b.v - a.v) * Math.max(0, Math.min(1, k));
    }
    return beatRateFromEnvelope(env, this.rate, minHz, maxHz);
  }

  reset(): void {
    this.points = [];
  }
}

/* ---------- Beat rates for setting a temperament by ear ---------- */

export interface IntervalBeat {
  lower: number;
  upper: number;
  name: string;
  /** Beats per second; positive when the interval is wider than pure. */
  beats: number;
}

/**
 * Coincident partials of the tested intervals: `p` x lower meets `q` x upper,
 * so a pure interval has upper/lower = p/q and beats at |q f2 - p f1| per second.
 */
export const BEAT_INTERVALS: { semitones: number; name: string; p: number; q: number }[] = [
  { semitones: 3, name: 'minor third', p: 6, q: 5 },
  { semitones: 4, name: 'major third', p: 5, q: 4 },
  { semitones: 5, name: 'fourth', p: 4, q: 3 },
  { semitones: 7, name: 'fifth', p: 3, q: 2 },
];

/** Beat rates of thirds, fourths and fifths whose notes both lie from `low` to `high` (MIDI), in the given tuning. */
export function temperamentBeats(tuning: TuningSystem, low = 53, high = 65): IntervalBeat[] {
  const out: IntervalBeat[] = [];
  for (const iv of BEAT_INTERVALS) {
    for (let m = low; m + iv.semitones <= high; m++) {
      const f1 = midiToFrequency(m, tuning);
      const f2 = midiToFrequency(m + iv.semitones, tuning);
      out.push({ lower: m, upper: m + iv.semitones, name: iv.name, beats: iv.q * f2 - iv.p * f1 });
    }
  }
  return out;
}

/* ---------- Piano inharmonicity ---------- */

/**
 * Least-squares inharmonicity from measured partials, using the stiff string
 * model f_n = n f0 sqrt(1 + B n^2), where f0 is the frequency the string would have
 * without stiffness. H. Fletcher, "Normal Vibration Frequencies of a Stiff Piano String",
 * J. Acoust. Soc. Am. 36(1), 203-209 (1964), https://doi.org/10.1121/1.1918933 (Crossref record).
 * Squaring gives (f_n / n)^2 = f0^2 + f0^2 B n^2, a straight line in n^2.
 */
export function fitInharmonicity(partials: readonly { n: number; hz: number }[]): { f0: number; B: number } | null {
  const pts = partials.filter((p) => p.n >= 1 && p.hz > 0);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.n * p.n);
  const ys = pts.map((p) => (p.hz / p.n) ** 2);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  if (!(intercept > 0)) return null;
  return { f0: Math.sqrt(intercept), B: Math.max(0, slope / intercept) };
}

/** Partials 1 to `count` of a note near `f1`, matched to the strongest peak within 4% of each expected position. */
export function matchPartials(peaks: readonly Peak[], f1: number, count = 6): { n: number; hz: number }[] {
  const out: { n: number; hz: number }[] = [];
  for (let n = 1; n <= count; n++) {
    // Each found partial updates the stretch estimate for the next one.
    const fit = out.length >= 2 ? fitInharmonicity(out) : null;
    const expected = fit ? n * fit.f0 * Math.sqrt(1 + fit.B * n * n) : n * f1;
    let best: Peak | null = null;
    for (const p of peaks) {
      if (Math.abs(p.hz / expected - 1) <= 0.04 && (!best || p.db > best.db)) best = p;
    }
    if (best) out.push({ n, hz: best.hz });
  }
  return out;
}

/**
 * Cents by which an octave is widened when the upper note's 2nd partial is
 * tuned to the lower note's 4th (a 4:2 octave), measured between the two
 * notes' first partials, as a tuner reads them.
 */
export function stretchedOctaveCents(bLower: number, bUpper: number): number {
  // 2 fu sqrt(1 + 4 Bu) = 4 fl sqrt(1 + 16 Bl), and each first partial is f0 sqrt(1 + B).
  const f0Ratio = (2 * Math.sqrt(1 + 16 * bLower)) / Math.sqrt(1 + 4 * bUpper);
  return ratioToCents(f0Ratio * Math.sqrt(1 + bUpper) / Math.sqrt(1 + bLower)) - 1200;
}

/**
 * Stretch in cents for every note from `from` to `to`, anchored at A4 = 0:
 * each note is a 4:2 octave from the note an octave nearer A4. Inharmonicity
 * for unmeasured notes is interpolated on a log scale between measured ones
 * and held flat beyond them. Notes within an octave of A4 are linearly
 * interpolated between A4 and the stretched As either side.
 */
export function stretchCurve(measured: Readonly<Record<number, number>>, from = 21, to = 108): Record<number, number> {
  const keys = Object.keys(measured).map(Number).filter((k) => measured[k] > 0).sort((a, b) => a - b);
  const bAt = (m: number): number => {
    if (!keys.length) return 0;
    if (m <= keys[0]) return measured[keys[0]];
    if (m >= keys[keys.length - 1]) return measured[keys[keys.length - 1]];
    let i = 0;
    while (keys[i + 1] < m) i++;
    const a = keys[i];
    const b = keys[i + 1];
    const t = (m - a) / (b - a);
    return Math.exp(Math.log(measured[a]) * (1 - t) + Math.log(measured[b]) * t);
  };
  const out: Record<number, number> = { 69: 0 };
  out[81] = stretchedOctaveCents(bAt(69), bAt(81));
  out[57] = -stretchedOctaveCents(bAt(57), bAt(69));
  for (let m = 70; m < 81; m++) out[m] = out[81] * ((m - 69) / 12);
  for (let m = 58; m < 69; m++) out[m] = out[57] * ((69 - m) / 12);
  // Further octaves chained note by note from the octave nearer A4.
  for (let m = 82; m <= to; m++) out[m] = out[m - 12] + stretchedOctaveCents(bAt(m - 12), bAt(m));
  for (let m = 56; m >= from; m--) out[m] = out[m + 12] - stretchedOctaveCents(bAt(m), bAt(m + 12));
  const result: Record<number, number> = {};
  for (let m = from; m <= to; m++) result[m] = out[m] ?? 0;
  return result;
}
