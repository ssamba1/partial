import { dayKey } from './practice';

/**
 * In-tune state with hysteresis: enters at `tolerance`, leaves only beyond
 * tolerance + max(0.5, 0.3 x tolerance), so noise at the edge does not flicker.
 * The hold timer (for the lock haptic) survives excursions shorter than
 * `graceSeconds` on the same note.
 */
export class InTuneLatch {
  private inTune = false;
  private since: number | null = null;
  private outSince: number | null = null;
  private note: number | null = null;
  private fired = false;

  constructor(
    private holdSeconds = 1.2,
    private graceSeconds = 0.15,
  ) {}

  update(cents: number | null, midi: number | null, time: number, tolerance: number): { inTune: boolean; hold: number; fire: boolean } {
    if (cents === null || midi === null) {
      this.reset();
      return { inTune: false, hold: 0, fire: false };
    }
    if (midi !== this.note) {
      this.reset();
      this.note = midi;
    }
    const off = Math.abs(cents);
    const exit = tolerance + Math.max(0.5, 0.3 * tolerance);
    if (this.inTune) {
      if (off > exit) {
        this.inTune = false;
        this.outSince = time;
      }
    } else if (off <= tolerance) {
      this.inTune = true;
      if (this.since === null || (this.outSince !== null && time - this.outSince >= this.graceSeconds)) {
        this.since = time;
        this.fired = false;
      }
      this.outSince = null;
    } else if (this.since !== null && this.outSince !== null && time - this.outSince >= this.graceSeconds) {
      this.since = null;
      this.fired = false;
    }
    const hold = this.inTune && this.since !== null ? (time - this.since) / this.holdSeconds : 0;
    let fire = false;
    if (hold >= 1 && !this.fired) {
      this.fired = true;
      fire = true;
    }
    return { inTune: this.inTune, hold, fire };
  }

  /** Change how long a note must stay in tune before it locks. */
  setHoldSeconds(seconds: number): void {
    this.holdSeconds = seconds;
  }

  reset(): void {
    this.inTune = false;
    this.since = null;
    this.outSince = null;
    this.note = null;
    this.fired = false;
  }
}

/** One line describing a stretch of readings for screen readers, such as "Last 10 s: mostly 6 cents sharp". */
export function traceSummary(points: readonly { cents: number | null }[], tolerance: number, seconds = 10): string {
  const voiced = points.map((p) => p.cents).filter((c): c is number => c !== null && Number.isFinite(c)).sort((a, b) => a - b);
  const head = `Last ${seconds} s`;
  if (voiced.length < 3) return `${head}: no note`;
  const mid = voiced.length >> 1;
  const median = voiced.length % 2 ? voiced[mid] : (voiced[mid - 1] + voiced[mid]) / 2;
  if (Math.abs(median) <= tolerance) return `${head}: mostly in tune`;
  const r = Math.round(Math.abs(median));
  return `${head}: mostly ${r} ${r === 1 ? 'cent' : 'cents'} ${median > 0 ? 'sharp' : 'flat'}`;
}

export interface NoteStat {
  count: number;
  sum: number;
  sumSq: number;
}

export type Tendencies = Record<number, NoteStat>;

/**
 * Adds one in-range reading (|cents| <= 50) for a pitch class. `weight` is how
 * much the reading counts (seconds of sound, for live tuning). Returns a new object.
 */
export function addReading(t: Tendencies, pitchClass: number, cents: number, weight = 1): Tendencies {
  if (!Number.isFinite(cents) || Math.abs(cents) > 50 || !(weight > 0)) return t;
  const cur = t[pitchClass] ?? { count: 0, sum: 0, sumSq: 0 };
  return { ...t, [pitchClass]: { count: cur.count + weight, sum: cur.sum + weight * cents, sumSq: cur.sumSq + weight * cents * cents } };
}

/** Sums two sets of tendencies. Returns a new object. */
export function mergeTendencies(a: Tendencies, b: Tendencies): Tendencies {
  const out: Tendencies = { ...a };
  for (const [pc, st] of Object.entries(b)) {
    const cur = out[Number(pc)] ?? { count: 0, sum: 0, sumSq: 0 };
    out[Number(pc)] = { count: cur.count + st.count, sum: cur.sum + st.sum, sumSq: cur.sumSq + st.sumSq };
  }
  return out;
}

/**
 * Tendencies only mean something for one tuning: cents against 440 equal are
 * not cents against 415 Vallotti. Stats are kept per tuning under this key,
 * by concert pitch class, and transposed only for display.
 */
export function tendencyKey(tuning: { a4: number; temperament: string; tonic: number }): string {
  return `${tuning.a4}|${tuning.temperament}|${tuning.temperament === 'equal' ? 0 : tuning.tonic}`;
}

/** Tendencies for one tuning: all-time sums plus per-day buckets for recent views. */
export interface TendencyRecord {
  all: Tendencies;
  /** Local day (YYYY-MM-DD) to that day's sums. */
  days: Record<string, Tendencies>;
}

export interface TendencyBook {
  /** Tuning key (see tendencyKey) to its record. */
  tunings: Record<string, TendencyRecord>;
  /** Readings saved before stats were kept per tuning; their tuning is unknown. */
  legacy: Tendencies;
}

export const EMPTY_BOOK: TendencyBook = { tunings: {}, legacy: {} };

/** Days of per-day buckets kept; older days live on only in the all-time sums. */
export const TENDENCY_DAYS_KEPT = 60;

/** Adds readings for one tuning on one day, dropping day buckets older than TENDENCY_DAYS_KEPT. Returns a new book. */
export function addToBook(book: TendencyBook, key: string, day: string, add: Tendencies): TendencyBook {
  const cur = book.tunings[key] ?? { all: {}, days: {} };
  const days = { ...cur.days, [day]: mergeTendencies(cur.days[day] ?? {}, add) };
  const keep = Object.keys(days).sort().slice(-TENDENCY_DAYS_KEPT);
  const pruned: Record<string, Tendencies> = {};
  for (const d of keep) pruned[d] = days[d];
  return { ...book, tunings: { ...book.tunings, [key]: { all: mergeTendencies(cur.all, add), days: pruned } } };
}

/** Sums for a tuning: all time, or the last `days` local days ending at `today` (YYYY-MM-DD keys). */
export function bookTendencies(book: TendencyBook, key: string, days: number | 'all', today: Date): Tendencies {
  const rec = book.tunings[key];
  if (!rec) return {};
  if (days === 'all') return rec.all;
  const d = new Date(today);
  let out: Tendencies = {};
  for (let i = 0; i < days; i++) {
    const k = dayKey(d);
    if (rec.days[k]) out = mergeTendencies(out, rec.days[k]);
    d.setDate(d.getDate() - 1);
  }
  return out;
}

/** Reads a stored book, dropping anything malformed. */
export function sanitizeBook(v: unknown): TendencyBook {
  const isStat = (s: unknown): s is NoteStat =>
    !!s && typeof s === 'object' && ['count', 'sum', 'sumSq'].every((k) => Number.isFinite((s as Record<string, unknown>)[k]));
  const stats = (t: unknown): Tendencies => {
    const out: Tendencies = {};
    if (!t || typeof t !== 'object') return out;
    for (const [pc, s] of Object.entries(t)) {
      const n = Number(pc);
      if (Number.isInteger(n) && n >= 0 && n < 12 && isStat(s) && s.count > 0) out[n] = { count: s.count, sum: s.sum, sumSq: s.sumSq };
    }
    return out;
  };
  const book: TendencyBook = { tunings: {}, legacy: {} };
  if (!v || typeof v !== 'object') return book;
  const raw = v as { tunings?: unknown; legacy?: unknown };
  book.legacy = stats(raw.legacy);
  if (raw.tunings && typeof raw.tunings === 'object') {
    for (const [key, rec] of Object.entries(raw.tunings as Record<string, unknown>)) {
      if (!rec || typeof rec !== 'object') continue;
      const r = rec as { all?: unknown; days?: unknown };
      const days: Record<string, Tendencies> = {};
      if (r.days && typeof r.days === 'object') {
        for (const [d, t] of Object.entries(r.days as Record<string, unknown>)) if (/^\d{4}-\d{2}-\d{2}$/.test(d)) days[d] = stats(t);
      }
      book.tunings[key] = { all: stats(r.all), days };
    }
  }
  return book;
}

/**
 * Decides how much a live frame counts toward tendencies: nothing during
 * attacks and slides, and otherwise the time since the previous frame, so a
 * 120 Hz screen counts the same seconds as a 60 Hz one.
 */
export class StableNoteGate {
  private note: number | null = null;
  private since = 0;
  private last: number | null = null;

  constructor(
    private stableSeconds = 0.3,
    private maxStep = 0.1,
  ) {}

  /** `midi` is null for a frame with no usable reading. Returns seconds to credit this frame. */
  update(midi: number | null, time: number): number {
    const prev = this.last;
    this.last = time;
    if (midi === null) {
      this.note = null;
      return 0;
    }
    if (midi !== this.note || prev === null) {
      this.note = midi;
      this.since = time;
      return 0;
    }
    if (time - this.since < this.stableSeconds) return 0;
    return Math.max(0, Math.min(this.maxStep, time - prev));
  }

  reset(): void {
    this.note = null;
    this.last = null;
  }
}

/**
 * Watches live readings for long tones. When a note held for at least
 * `minSeconds` ends, `push` returns its summary (length, spread, drift).
 */
export class LongToneWatcher {
  private readings: { t: number; midi: number | null; cents: number }[] = [];

  constructor(
    private minSeconds = 2,
    private maxGap = 0.25,
  ) {}

  push(time: number, midi: number | null, cents: number): HeldNote | null {
    const last = this.readings[this.readings.length - 1];
    const current = this.readings.find((r) => r.midi !== null)?.midi ?? null;
    const ended = current !== null && ((midi !== null && midi !== current) || (last && time - last.t > this.maxGap));
    let done: HeldNote | null = null;
    if (ended) {
      const notes = segmentNotes(this.readings, this.minSeconds, this.maxGap);
      done = notes[notes.length - 1] ?? null;
      this.readings = [];
    }
    if (midi !== null) this.readings.push({ t: time, midi, cents });
    return done;
  }

  /** Summary of the note so far, when it is already long enough, for when listening stops mid-note. */
  flush(): HeldNote | null {
    const notes = segmentNotes(this.readings, this.minSeconds, this.maxGap);
    this.readings = [];
    return notes[notes.length - 1] ?? null;
  }
}

export interface TendencySummary {
  pitchClass: number;
  count: number;
  mean: number;
  /** Standard deviation in cents: how steady the note is. */
  spread: number;
}

export function summarize(t: Tendencies, minCount = 1): TendencySummary[] {
  return Object.entries(t)
    .map(([pc, s]) => {
      const mean = s.sum / s.count;
      const variance = Math.max(0, s.sumSq / s.count - mean * mean);
      return { pitchClass: Number(pc), count: s.count, mean, spread: Math.sqrt(variance) };
    })
    .filter((s) => s.count >= minCount)
    .sort((a, b) => a.pitchClass - b.pitchClass);
}

export interface TakeReport {
  readings: { t: number; midi: number | null; cents: number }[];
  notes: HeldNote[];
  /** Share of voiced frames within the tolerance, 0..1. */
  inTune: number;
  meanCents: number;
  voicedSeconds: number;
}

/**
 * Offline intonation report for a recorded take: runs the given pitch function
 * over hops of the signal, then groups frames into held notes.
 */
export function analyzeTake(
  samples: Float32Array,
  sampleRate: number,
  toNote: (frame: Float32Array) => { midi: number; cents: number } | null,
  tolerance: number,
  frameSize = 4096,
  hop = 1024,
): TakeReport {
  const readings: TakeReport['readings'] = [];
  for (let start = 0; start + frameSize <= samples.length; start += hop) {
    const r = toNote(samples.subarray(start, start + frameSize));
    readings.push({ t: (start + frameSize / 2) / sampleRate, midi: r?.midi ?? null, cents: r?.cents ?? 0 });
  }
  const voiced = readings.filter((r) => r.midi !== null);
  const inTune = voiced.length ? voiced.filter((r) => Math.abs(r.cents) <= tolerance).length / voiced.length : 0;
  const meanCents = voiced.length ? voiced.reduce((a, r) => a + r.cents, 0) / voiced.length : 0;
  return { readings, notes: segmentNotes(readings), inTune, meanCents, voicedSeconds: (voiced.length * hop) / sampleRate };
}

export interface HeldNote {
  midi: number;
  start: number;
  end: number;
  meanCents: number;
  /** Cents drift from the first to the last third of the note. */
  drift: number;
  /** Standard deviation of the cents over the note: how steady it was. */
  spread: number;
}

/**
 * Groups a stream of (time, midi, cents) readings into held notes, like a
 * "sustained pitch history". Notes shorter than `minSeconds` are dropped.
 */
export function segmentNotes(
  readings: { t: number; midi: number | null; cents: number }[],
  minSeconds = 0.25,
  maxGap = 0.15,
): HeldNote[] {
  const notes: HeldNote[] = [];
  let cur: { midi: number; points: { t: number; cents: number }[] } | null = null;
  const flush = () => {
    if (!cur || cur.points.length < 2) return;
    const start = cur.points[0].t;
    const end = cur.points[cur.points.length - 1].t;
    if (end - start < minSeconds) return;
    const third = Math.max(1, Math.floor(cur.points.length / 3));
    const avg = (arr: { cents: number }[]) => arr.reduce((a, p) => a + p.cents, 0) / arr.length;
    const mean = avg(cur.points);
    notes.push({
      midi: cur.midi,
      start,
      end,
      meanCents: mean,
      drift: avg(cur.points.slice(-third)) - avg(cur.points.slice(0, third)),
      spread: Math.sqrt(cur.points.reduce((a, p) => a + (p.cents - mean) ** 2, 0) / cur.points.length),
    });
  };
  for (const r of readings) {
    const last = cur?.points[cur.points.length - 1];
    if (r.midi === null || !cur || r.midi !== cur.midi || (last && r.t - last.t > maxGap)) {
      flush();
      cur = r.midi === null ? null : { midi: r.midi, points: [] };
    }
    cur?.points.push({ t: r.t, cents: r.cents });
  }
  flush();
  return notes;
}
