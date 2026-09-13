import { frequencyToNote, readingForNote, type NoteReading, type TuningSystem } from './notes';
import { acRms, detectPitchAdaptive, PitchSmoother } from './pitch';

export type Damping = 'fast' | 'normal' | 'slow';

export interface SmoothingProfile {
  /** Time from the oldest to the newest reading in the median window. */
  medianSpanMs: number;
  /** Time constant of the display glide. */
  tauMs: number;
  /** How long a jump of more than a semitone must last before it is shown. */
  confirmMs: number;
  /** How long the last reading is held through a dropout. */
  holdMs: number;
}

// In milliseconds rather than frames, so a 120 Hz screen smooths the same as a 60 Hz one.
// At 60 frames per second these are 3, 5 and 9 median frames and a 2, 3 or 4 frame jump confirmation.
export const SMOOTHING: Record<Damping, SmoothingProfile> = {
  fast: { medianSpanMs: 33, tauMs: 30, confirmMs: 33, holdMs: 150 },
  normal: { medianSpanMs: 67, tauMs: 90, confirmMs: 50, holdMs: 350 },
  slow: { medianSpanMs: 133, tauMs: 220, confirmMs: 67, holdMs: 700 },
};

/**
 * Keeps the current note until the pitch has been more than `releaseCents`
 * away from it for `releaseFrames` readings, so a note wobbling around the
 * quarter tone does not flip between two names. Jumps wider than `jumpCents`
 * switch at once.
 */
export class NoteLatch {
  private midi: number | null = null;
  private away = 0;
  constructor(
    private releaseCents = 58,
    private releaseFrames = 3,
    private jumpCents = 150,
  ) {}

  read(frequency: number, tuning: TuningSystem): NoteReading {
    const nearest = frequencyToNote(frequency, tuning);
    if (this.midi === null || nearest.midi === this.midi) return this.take(nearest);
    const held = readingForNote(frequency, this.midi, tuning);
    const off = Math.abs(held.cents);
    if (off > this.jumpCents) return this.take(nearest);
    if (off > this.releaseCents) {
      this.away++;
      if (this.away >= this.releaseFrames) return this.take(nearest);
    } else {
      this.away = 0;
    }
    return held;
  }

  reset(): void {
    this.midi = null;
    this.away = 0;
  }

  private take(r: NoteReading): NoteReading {
    this.midi = r.midi;
    this.away = 0;
    return r;
  }
}

export interface SmoothedReading {
  frequency: number | null;
  note: NoteReading | null;
  /** Display cents, smoothed further than `note.cents` so the needle glides instead of jittering. */
  displayCents: number;
  /** The frequency the display cents stand for: as smooth as the needle, for measuring against other targets. */
  displayFrequency: number | null;
}

/**
 * Median filter, note latch and display glide for a stream of raw pitch
 * readings, all timed in milliseconds so the result does not depend on how
 * often frames arrive.
 */
export class ReadingSmoother {
  private smoother = new PitchSmoother(5, 3);
  private latch = new NoteLatch();
  private interval = 1000 / 60;
  private intervalKnown = false;
  private lastAt: number | null = null;
  private lastVoiced = false;
  private lastMidi: number | null = null;
  private display = 0;
  private prevCents = 0;

  push(raw: number | null, nowMs: number, profile: SmoothingProfile, tuning: TuningSystem): SmoothedReading {
    const dt = this.lastAt === null ? this.interval : Math.max(0, nowMs - this.lastAt);
    // Learn the frame interval only from consecutive voiced frames; idle frames may be skipped.
    if (raw !== null && this.lastVoiced && dt > 0 && dt < 250) {
      this.interval = this.intervalKnown ? this.interval + (dt - this.interval) * 0.2 : dt;
      this.intervalKnown = true;
    }
    this.lastAt = nowMs;
    this.lastVoiced = raw !== null;

    this.smoother.setSize(1 + Math.round(profile.medianSpanMs / this.interval));
    this.smoother.setConfirm(Math.max(1, Math.round(profile.confirmMs / this.interval)));
    const frequency = this.smoother.push(raw);
    if (frequency === null) {
      this.latch.reset();
      this.lastMidi = null;
      return { frequency: null, note: null, displayCents: 0, displayFrequency: null };
    }
    const note = this.latch.read(frequency, tuning);
    if (this.lastMidi !== note.midi || dt <= 0) {
      this.display = note.cents;
    } else {
      // Exponential glide discretised for a straight line between readings, so the
      // result is the same whether readings come every 8 ms or every 33 ms.
      const e = Math.exp(-dt / profile.tauMs);
      const k = (profile.tauMs / dt) * (1 - e);
      this.display = e * this.display + (1 - k) * note.cents + (k - e) * this.prevCents;
    }
    this.prevCents = note.cents;
    this.lastMidi = note.midi;
    return { frequency, note, displayCents: this.display, displayFrequency: note.target * Math.pow(2, this.display / 1200) };
  }

  reset(): void {
    this.smoother.reset();
    this.latch.reset();
    this.lastAt = null;
    this.lastVoiced = false;
    this.lastMidi = null;
  }
}

/** A reading kept so it can be held through a short dropout. */
interface HeldReading {
  note: NoteReading;
  frequency: number;
  clarity: number;
  displayCents: number;
  displayFrequency: number | null;
  at: number;
}

/** Everything the per-frame processor carries from one frame to the next. */
export interface FrameState {
  smoothing: ReadingSmoother;
  last: HeldReading | null;
}

export function createFrameState(): FrameState {
  return { smoothing: new ReadingSmoother(), last: null };
}

export interface FrameOptions {
  sampleRate: number;
  tuning: TuningSystem;
  profile: SmoothingProfile;
  /** Frames quieter than this RMS are not analysed. */
  minRms: number;
  minFrequency: number;
  maxFrequency?: number;
  /** True to skip this frame (a metronome click or the app's own cue is in it). */
  gated?: boolean;
  /** Level of the frame when the caller has already measured it. */
  level?: number;
}

export interface FrameResult {
  level: number;
  frequency: number | null;
  clarity: number;
  note: NoteReading | null;
  displayCents: number;
  displayFrequency: number | null;
  /** The last reading held through a dropout or a gated frame. */
  held: boolean;
  /** Whether pitch detection ran on this frame. */
  analysed: boolean;
}

/**
 * One frame of the tuner pipeline: level gate, pitch detection, smoothing and
 * the hold through dropouts. Pure apart from `state`, so the live tuner and the
 * recorder's take report give the same readings for the same sound.
 */
export function processFrame(state: FrameState, samples: Float32Array, nowMs: number, opts: FrameOptions): FrameResult {
  const level = opts.level ?? acRms(samples);
  let note: NoteReading | null = null;
  let frequency: number | null = null;
  let clarity = 0;
  let displayCents = 0;
  let displayFrequency: number | null = null;
  let held = false;
  // Quiet frames are skipped outright; anything above the gate is analysed, so a note start is never delayed.
  const analysed = !opts.gated && level >= opts.minRms;

  if (!opts.gated) {
    const result = analysed
      ? detectPitchAdaptive(samples, { sampleRate: opts.sampleRate, minFrequency: opts.minFrequency, maxFrequency: opts.maxFrequency, minRms: opts.minRms })
      : null;
    const smoothed = state.smoothing.push(result?.frequency ?? null, nowMs, opts.profile, opts.tuning);
    if (smoothed.note && smoothed.frequency) {
      note = smoothed.note;
      frequency = smoothed.frequency;
      displayCents = smoothed.displayCents;
      displayFrequency = smoothed.displayFrequency;
      clarity = result?.clarity ?? 0;
      state.last = { note, frequency, clarity, displayCents, displayFrequency, at: nowMs };
    }
  }

  // Hold the last reading briefly through dropouts and gated frames, so the display doesn't flicker.
  if (!note && state.last && nowMs - state.last.at < opts.profile.holdMs) {
    ({ note, frequency, clarity, displayCents, displayFrequency } = state.last);
    held = true;
  } else if (!note) {
    state.last = null;
  }
  return { level, frequency, clarity, note, displayCents: note ? displayCents : 0, displayFrequency: note ? displayFrequency : null, held, analysed };
}

/**
 * Reader for consecutive frames of a recording, `hop` samples apart, through
 * the same processor as the live tuner. Held frames return null, as they are
 * left out of the live session score.
 */
export function recordingReader(sampleRate: number, hop: number, opts: Omit<FrameOptions, 'sampleRate' | 'gated' | 'level'>): (frame: Float32Array) => { midi: number; cents: number } | null {
  const state = createFrameState();
  let n = 0;
  return (frame) => {
    const r = processFrame(state, frame, ((n++ * hop) / sampleRate) * 1000, { ...opts, sampleRate });
    return r.note && !r.held ? { midi: r.note.midi, cents: r.displayCents } : null;
  };
}

/**
 * Flags the start of a plucked or struck note, whose first moments are
 * typically sharp: true for `ignoreMs` after the level rises more than
 * `riseDb` within `windowMs`.
 */
export class OnsetGate {
  private levels: { t: number; level: number }[] = [];
  private onsetAt = -Infinity;

  constructor(
    private riseDb = 6,
    private windowMs = 50,
    private ignoreMs = 120,
  ) {}

  update(level: number, nowMs: number): boolean {
    const floor = 1e-4;
    const v = Math.max(floor, level);
    while (this.levels.length && nowMs - this.levels[0].t > this.windowMs) this.levels.shift();
    let low = Infinity;
    for (const l of this.levels) low = Math.min(low, l.level);
    this.levels.push({ t: nowMs, level: v });
    if (low !== Infinity && v >= low * Math.pow(10, this.riseDb / 20)) this.onsetAt = nowMs;
    return nowMs - this.onsetAt < this.ignoreMs;
  }

  reset(): void {
    this.levels = [];
    this.onsetAt = -Infinity;
  }
}
