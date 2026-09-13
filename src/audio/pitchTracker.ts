import { frequencyToNote, type NoteReading, type TuningSystem } from '../core/notes';
import { detectPitch, PitchSmoother, rms } from '../core/pitch';
import { acquireMic, ensureRunning, releaseMic } from './context';

export interface TrackerFrame {
  time: number;
  /** Raw time-domain samples of this frame (reused buffer; copy if you keep it). */
  samples: Float32Array;
  sampleRate: number;
  level: number;
  frequency: number | null;
  clarity: number;
  note: NoteReading | null;
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
  running = false;

  constructor(public tuning: () => TuningSystem, public sensitivity: () => number = () => 0.008) {}

  onFrame(fn: (f: TrackerFrame) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async start(): Promise<void> {
    if (this.running) return;
    const ctx = await ensureRunning();
    const stream = await acquireMic();
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.source.connect(this.analyser);
    this.running = true;
    this.smoother.reset();

    const loop = () => {
      if (!this.running || !this.analyser) return;
      this.analyser.getFloatTimeDomainData(this.buffer);
      const result = detectPitch(this.buffer, {
        sampleRate: ctx.sampleRate,
        minRms: this.sensitivity(),
      });
      const smoothed = this.smoother.push(result?.frequency ?? null);
      const frame: TrackerFrame = {
        time: ctx.currentTime,
        samples: this.buffer,
        sampleRate: ctx.sampleRate,
        level: result?.rms ?? rms(this.buffer),
        frequency: smoothed,
        clarity: result?.clarity ?? 0,
        note: smoothed ? frequencyToNote(smoothed, this.tuning()) : null,
      };
      this.listeners.forEach((fn) => fn(frame));
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
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
