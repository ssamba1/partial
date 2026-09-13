import { beatSeconds, MetronomeSequence, TIMELINES, type SequenceSettings } from '../core/metroseq';
import { clampBpm } from '../core/rhythm';
import { ensureRunning, getContext, getMaster, onContextState } from './context';
import { LookaheadScheduler, type ScheduledEvent } from './scheduler';
import { playClick, prepareClicks, type ClickSound } from './voices';

export interface MetronomeSettings extends SequenceSettings {
  sound: ClickSound;
  volume: number;
  /** How much louder accents are than normal beats, in dB. */
  accentDb: number;
  /** Speed trainer: add `trainerStep` BPM every `trainerBars` bars, up to `trainerMax`. 0 bars = off. */
  trainerBars: number;
  trainerStep: number;
  trainerMax: number;
}

type BeatListener = (e: ScheduledEvent) => void;

/** Sound of the polyrhythm and timeline layers: a contrast with the main click. */
export function layerSound(main: ClickSound, layer: 'poly' | 'timeline' | 'layer'): ClickSound {
  if (layer === 'layer') return main;
  if (layer === 'timeline') return main === 'clave' ? 'wood' : 'clave';
  return main === 'cowbell' ? 'beep' : 'cowbell';
}

/**
 * Shared metronome engine. Settings can change while playing: tempo, subdivision
 * and poly changes take effect from the next beat, meter and accents from the
 * next bar, so it never stutters.
 */
export class Metronome {
  private scheduler: LookaheadScheduler | null = null;
  private sequence: MetronomeSequence | null = null;
  private listeners = new Set<BeatListener>();
  private stateListeners = new Set<(playing: boolean) => void>();
  private stallListeners = new Set<(stalled: boolean) => void>();
  private barsPlayed = 0;
  private seed = 1;
  /** Called with the AudioContext time of every audible click, so the tuner can ignore the click in the mic. */
  onClick: (when: number) => void = () => {};
  /** True when the system suspended audio while playing (a phone call, another app). */
  stalled = false;
  settings: MetronomeSettings;

  constructor(settings: MetronomeSettings) {
    this.settings = { ...settings };
    onContextState((state) => {
      if (state === 'running') {
        if (this.stalled) {
          this.stalled = false;
          this.stallListeners.forEach((fn) => fn(false));
        }
        return;
      }
      if (this.playing && !this.stalled) {
        this.stalled = true;
        this.stallListeners.forEach((fn) => fn(true));
      }
    });
  }

  update(patch: Partial<MetronomeSettings>): void {
    this.settings = { ...this.settings, ...patch, bpm: clampBpm(patch.bpm ?? this.settings.bpm) };
    if (this.playing) void this.prepare(getContext());
  }

  onBeat(fn: BeatListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onState(fn: (playing: boolean) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  onStall(fn: (stalled: boolean) => void): () => void {
    this.stallListeners.add(fn);
    return () => this.stallListeners.delete(fn);
  }

  get playing(): boolean {
    return this.scheduler?.isRunning ?? false;
  }

  private pendingStart = false;
  private startToken = 0;
  private tempoListeners = new Set<(bpm: number) => void>();

  /** Fires when the engine itself changes tempo (speed trainer). */
  onTempo(fn: (bpm: number) => void): () => void {
    this.tempoListeners.add(fn);
    return () => this.tempoListeners.delete(fn);
  }

  private prepare(ctx: BaseAudioContext): Promise<void> {
    const s = this.settings;
    const sounds: ClickSound[] = [s.sound, 'tick'];
    if (s.poly > 0) sounds.push(layerSound(s.sound, 'poly'));
    if (s.timeline && TIMELINES.some((t) => t.id === s.timeline)) sounds.push(layerSound(s.sound, 'timeline'));
    return prepareClicks(ctx, sounds);
  }

  /**
   * AudioContext time of the next barline, at least `margin` seconds away, or null when stopped.
   * Other players use it to start in phase with the metronome.
   */
  nextBarTime(margin = 0.1): number | null {
    if (!this.playing || !this.sequence || !this.scheduler) return null;
    const ctx = getContext();
    const seq = this.sequence;
    const s = this.settings;
    const beat = beatSeconds(s.bpm, s.beatUnit, s.pulseNote);
    const bar = beat * Math.max(1, s.beatsPerBar);
    // Remaining beats of the bar in progress at the current tempo.
    let t = this.scheduler.origin + seq.nextBeatTime + beat * seq.beatsLeftInBar();
    while (t < ctx.currentTime + margin) t += bar;
    return t;
  }

  async start(): Promise<void> {
    return this.begin(0, Math.max(0, Math.floor(this.settings.countInBars)));
  }

  private async begin(firstBar: number, countIn: number, keepBars = false): Promise<void> {
    if (this.playing || this.pendingStart) return;
    this.pendingStart = true;
    const token = ++this.startToken;
    const ctx = await ensureRunning();
    await this.prepare(ctx);
    this.pendingStart = false;
    // stop() was called while the audio context was starting.
    if (token !== this.startToken) return;
    this.scheduler ??= new LookaheadScheduler(ctx, { dest: getMaster() });
    if (!keepBars) this.barsPlayed = 0;
    this.seed = (Math.random() * 1e9) | 0;
    this.stalled = false;
    const seq = new MetronomeSequence(() => this.settings, this.seed, countIn, () => this.onBarComplete());
    if (firstBar > 0) seq.skipTo(firstBar);
    this.sequence = seq;

    this.scheduler.start(
      (horizon) => seq.next(horizon),
      (e) => {
        const s = this.settings;
        if (e.level === 'silent') return;
        this.onClick(e.when);
        const dest = this.scheduler?.destination ?? getMaster();
        if (e.layer) {
          const gain = e.layer === 'poly' ? 0.8 : e.layer === 'timeline' ? 0.9 : e.gain ?? 1;
          playClick(ctx, dest, e.when, e.level, layerSound(s.sound, e.layer), s.volume * gain, { gap: e.gap, accentDb: s.accentDb });
        } else {
          playClick(ctx, dest, e.when, e.level, e.countIn ? 'tick' : s.sound, s.volume, { gap: e.gap, accentDb: s.accentDb });
        }
      },
      (e) => this.listeners.forEach((fn) => fn(e)),
      // Reached "stop after N bars".
      () => this.stateListeners.forEach((fn) => fn(false)),
    );
    this.stallListeners.forEach((fn) => fn(false));
    this.stateListeners.forEach((fn) => fn(true));
  }

  /** After the system suspended audio: resume the context and carry on from the next barline. */
  async resume(): Promise<void> {
    const bar = this.sequence ? this.sequence.position.bar + (this.sequence.position.unit === 0 ? 0 : 1) : 0;
    const wasPlaying = this.playing || this.stalled;
    this.scheduler?.stop();
    this.stalled = false;
    if (!wasPlaying) return;
    await this.begin(Math.max(0, bar), 0, true);
  }

  private onBarComplete(): void {
    this.barsPlayed++;
    const s = this.settings;
    if (s.trainerBars > 0 && this.barsPlayed % s.trainerBars === 0 && s.bpm < s.trainerMax) {
      this.update({ bpm: Math.min(s.trainerMax, s.bpm + s.trainerStep) });
      this.tempoListeners.forEach((fn) => fn(this.settings.bpm));
    }
  }

  stop(): void {
    if (this.pendingStart) {
      this.startToken++;
      this.pendingStart = false;
      return;
    }
    if (this.stalled) {
      this.stalled = false;
      this.stallListeners.forEach((fn) => fn(false));
    }
    if (!this.playing) return;
    this.scheduler?.stop();
    this.stateListeners.forEach((fn) => fn(false));
  }

  toggle(): void {
    if (this.playing || this.pendingStart) this.stop();
    else void this.start();
  }
}
