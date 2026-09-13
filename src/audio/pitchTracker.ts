import { frequencyToNote, type NoteReading, type TuningSystem } from '../core/notes';
import { detectPitch, PitchSmoother, rms } from '../core/pitch';
import { acquireMic, ensureRunning, releaseMic } from './context';

export type Damping = 'fast' | 'normal' | 'slow';

const SMOOTHING: Record<Damping, { median: number; ema: number; holdMs: number }> = {
  fast: { median: 3, ema: 0.6, holdMs: 150 },
  normal: { median: 5, ema: 0.35, holdMs: 350 },
  slow: { median: 9, ema: 0.15, holdMs: 700 },
};

export interface TrackerFrame {
  time: number;
  /** Raw time-domain samples of this frame (reused buffer; copy if you keep it). */
  samples: Float32Array;
  sampleRate: number;
  level: number;
  frequency: number | null;
  clarity: number;
  note: NoteReading | null;
  /** Display cents, smoothed further than `note.cents` so the needle glides instead of jittering. */
  displayCents: number;
  /** True while the last reading is being held through a short dropout. */
  held: boolean;
  /** True if this frame was skipped because a metronome click was sounding. */
  gated: boolean;
}

export interface TrackerOptions {
  tuning: () => TuningSystem;
  sensitivity?: () => number;
  damping?: () => Damping;
  /** Return true to ignore the current frame (e.g. a metronome click is in the mic). */
  gate?: (audioTime: number) => boolean;
}

/**
 * Mic -> AnalyserNode -> YIN on every animation frame. One tracker per view;
 * the underlying mic stream is shared.
 */
export class PitchTracker {
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private buffer = new Float32Array(4096);
  private smoother = new PitchSmoother(5);
  private listeners = new Set<(f: TrackerFrame) => void>();
  private last: { note: NoteReading; frequency: number; clarity: number; at: number } | null = null;
  private displayCents = 0;
  private frameCount = 0;
  running = false;

  constructor(private opts: TrackerOptions) {}

  onFrame(fn: (f: TrackerFrame) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private starting: Promise<void> | null = null;
  /** False once stop() is called, so a start that is still awaiting permission backs out. */
  private wanted = false;

  start(): Promise<void> {
    this.wanted = true;
    if (this.running) return Promise.resolve();
    this.starting ??= this.doStart().finally(() => (this.starting = null));
    return this.starting;
  }

  private async doStart(): Promise<void> {
    const ctx = await ensureRunning();
    if (!this.wanted) return;
    const stream = await acquireMic();
    if (!this.wanted) {
      // The view was stopped or closed while the permission prompt was up.
      releaseMic();
      return;
    }
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.running = true;
    this.smoother.reset();
    this.last = null;

    const loop = () => {
      if (!this.running || !this.analyser) return;
      const damping = SMOOTHING[this.opts.damping?.() ?? 'normal'];
      this.analyser.getFloatTimeDomainData(this.buffer);
      const now = performance.now();
      const gated = this.opts.gate?.(ctx.currentTime) ?? false;

      let note: NoteReading | null = null;
      let frequency: number | null = null;
      let clarity = 0;
      let held = false;
      let level = rms(this.buffer);

      // With no pitch present (room noise), analyse every other frame to save battery; a new note is still caught within ~33 ms.
      this.frameCount++;
      const idle = !this.last && this.frameCount % 2 === 1;

      if (!gated && !idle) {
        const result = detectPitch(this.buffer, { sampleRate: ctx.sampleRate, minRms: this.opts.sensitivity?.() ?? 0.008 });
        this.smoother.setSize(damping.median);
        frequency = this.smoother.push(result?.frequency ?? null);
        if (result) level = result.rms;
        if (frequency) {
          clarity = result?.clarity ?? 0;
          note = frequencyToNote(frequency, this.opts.tuning());
          const jumped = this.last && this.last.note.midi !== note.midi;
          this.displayCents = jumped ? note.cents : this.displayCents + (note.cents - this.displayCents) * damping.ema;
          this.last = { note, frequency, clarity, at: now };
        }
      }

      // Hold the last reading briefly through dropouts and gated frames, so the display doesn't flicker.
      if (!note && this.last && now - this.last.at < damping.holdMs) {
        ({ note, frequency, clarity } = this.last);
        held = true;
      } else if (!note) {
        this.last = null;
      }

      const frame: TrackerFrame = {
        time: ctx.currentTime,
        samples: this.buffer,
        sampleRate: ctx.sampleRate,
        level,
        frequency,
        clarity,
        note,
        displayCents: note ? this.displayCents : 0,
        held,
        gated,
      };
      this.listeners.forEach((fn) => fn(frame));
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.wanted = false;
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    this.analyser?.disconnect();
    this.source = null;
    this.analyser = null;
    releaseMic();
  }
}
