import type { NoteReading, TuningSystem } from '../core/notes';
import { channelIndex, peakAbs, type MicChannel } from '../core/mic';
import { acRms, frameSizeFor } from '../core/pitch';
import { createFrameState, processFrame, SMOOTHING, type Damping, type FrameState } from '../core/tracking';
import { acquireMic, ensureRunning, releaseMic } from './context';

export type { Damping } from '../core/tracking';

/** Lowest pitch the tracker looks for, in Hz. */
export const MIN_FREQUENCY = 30;

export interface TrackerFrame {
  time: number;
  /** Raw time-domain samples of this frame (reused buffer; copy if you keep it). */
  samples: Float32Array;
  sampleRate: number;
  /** RMS level with any DC offset removed. */
  level: number;
  /** Largest absolute sample in the frame, for the clip light. */
  peak: number;
  frequency: number | null;
  clarity: number;
  note: NoteReading | null;
  /** Display cents, smoothed further than `note.cents` so the needle glides instead of jittering. */
  displayCents: number;
  /** Frequency matching `displayCents`, smoothed the same way. */
  displayFrequency: number | null;
  /** True while the last reading is being held through a short dropout. */
  held: boolean;
  /** True if this frame was skipped because a metronome click was sounding. */
  gated: boolean;
}

export interface TrackerOptions {
  tuning: () => TuningSystem;
  sensitivity?: () => number;
  damping?: () => Damping;
  /** Return true to ignore the current frame (e.g. a metronome click is in the mic). The frame covers `frameSeconds` of audio before `audioTime`. */
  gate?: (audioTime: number, frameSeconds: number, level: number) => boolean;
  /** Input device id; read when the tracker starts. */
  deviceId?: () => string;
  /** Input channel of a stereo interface; read when the tracker starts. */
  channel?: () => MicChannel;
  /** Lowest pitch expected from the instrument, to place the rumble filter below it. */
  lowestFrequency?: () => number;
  /** Pitch range to search, narrower than the default for an instrument with a known range. */
  frequencyRange?: () => { min: number; max: number } | null;
}

/**
 * Mic -> (channel pick) -> high-pass -> low-pass -> AnalyserNode -> YIN on
 * every animation frame. One tracker per view; the underlying mic stream is shared.
 */
export class PitchTracker {
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private nodes: AudioNode[] = [];
  private highpass: BiquadFilterNode | null = null;
  private highpassHz = 0;
  private raf = 0;
  private buffer = new Float32Array(4096);
  /** A longer analyser read only on request, for struck sounds that need fine frequency resolution. */
  private wide: AnalyserNode | null = null;
  private wideBuffer: Float32Array<ArrayBuffer> | null = null;
  private sampleRate = 48000;
  private state: FrameState = createFrameState();
  private listeners = new Set<(f: TrackerFrame) => void>();
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
    const mode = this.opts.channel?.() ?? 'mix';
    const stream = await acquireMic({ deviceId: this.opts.deviceId?.() ?? '', stereo: mode !== 'mix' });
    if (!this.wanted) {
      // The view was stopped or closed while the permission prompt was up.
      releaseMic();
      return;
    }
    this.source = ctx.createMediaStreamSource(stream);
    // Long enough for the lowest pitch at any sample rate (8192 samples at 96 kHz).
    const size = frameSizeFor(ctx.sampleRate, MIN_FREQUENCY);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = size;
    this.analyser.smoothingTimeConstant = 0;
    if (this.buffer.length !== size) this.buffer = new Float32Array(size);

    // Take one input of a stereo interface when asked, instead of the analyser's mono downmix.
    const channelCount = stream.getAudioTracks()[0]?.getSettings().channelCount;
    const index = channelIndex(mode, channelCount);
    let tail: AudioNode = this.source;
    let tailOutput = 0;
    if (index !== null) {
      const splitter = ctx.createChannelSplitter(2);
      this.source.connect(splitter);
      this.nodes.push(splitter);
      tail = splitter;
      tailOutput = index;
    }
    // Rumble, handling noise and wind below the instrument's range inflate the YIN difference function.
    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.Q.value = Math.SQRT1_2;
    this.setHighpass();
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 5000;
    lowpass.Q.value = Math.SQRT1_2;
    tail.connect(this.highpass, tailOutput);
    this.highpass.connect(lowpass);
    lowpass.connect(this.analyser);
    this.wide = ctx.createAnalyser();
    this.wide.fftSize = 32768;
    this.wide.smoothingTimeConstant = 0;
    lowpass.connect(this.wide);
    this.sampleRate = ctx.sampleRate;
    this.nodes.push(this.highpass, lowpass, this.wide);

    this.running = true;
    this.state = createFrameState();

    const loop = () => {
      if (!this.running || !this.analyser) return;
      this.setHighpass();
      this.analyser.getFloatTimeDomainData(this.buffer);
      const level = acRms(this.buffer);
      const gated = this.opts.gate?.(ctx.currentTime, this.buffer.length / ctx.sampleRate, level) ?? false;
      const range = this.opts.frequencyRange?.();
      const r = processFrame(this.state, this.buffer, performance.now(), {
        sampleRate: ctx.sampleRate,
        tuning: this.opts.tuning(),
        profile: SMOOTHING[this.opts.damping?.() ?? 'normal'],
        minRms: this.opts.sensitivity?.() ?? 0.008,
        minFrequency: Math.max(MIN_FREQUENCY, range?.min ?? MIN_FREQUENCY),
        maxFrequency: range?.max,
        gated,
        level,
      });

      const frame: TrackerFrame = {
        time: ctx.currentTime,
        samples: this.buffer,
        sampleRate: ctx.sampleRate,
        level,
        peak: peakAbs(this.buffer),
        frequency: r.frequency,
        clarity: r.clarity,
        note: r.note,
        displayCents: r.displayCents,
        displayFrequency: r.displayFrequency,
        held: r.held,
        gated,
      };
      this.listeners.forEach((fn) => fn(frame));
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** The latest 32768 samples (about 0.7 s at 48 kHz), copied, or null when not running. */
  wideSamples(): { samples: Float32Array; sampleRate: number } | null {
    if (!this.running || !this.wide) return null;
    this.wideBuffer ??= new Float32Array(this.wide.fftSize);
    this.wide.getFloatTimeDomainData(this.wideBuffer);
    return { samples: this.wideBuffer.slice(), sampleRate: this.sampleRate };
  }

  /** High-pass at 0.7 x the lowest expected pitch. */
  private setHighpass(): void {
    if (!this.highpass) return;
    const hz = 0.7 * Math.max(MIN_FREQUENCY, this.opts.lowestFrequency?.() ?? MIN_FREQUENCY);
    if (Math.abs(hz - this.highpassHz) < 0.01) return;
    this.highpassHz = hz;
    this.highpass.frequency.value = hz;
  }

  stop(): void {
    this.wanted = false;
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.source?.disconnect();
    this.nodes.forEach((n) => n.disconnect());
    this.analyser?.disconnect();
    this.nodes = [];
    this.highpass = null;
    this.highpassHz = 0;
    this.source = null;
    this.analyser = null;
    this.wide = null;
    releaseMic();
  }
}
