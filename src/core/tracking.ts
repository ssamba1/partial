import { frequencyToNote, readingForNote, type NoteReading, type TuningSystem } from './notes';
import { PitchSmoother } from './pitch';

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
      return { frequency: null, note: null, displayCents: 0 };
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
    return { frequency, note, displayCents: this.display };
  }

  reset(): void {
    this.smoother.reset();
    this.latch.reset();
    this.lastAt = null;
    this.lastVoiced = false;
    this.lastMidi = null;
  }
}
