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
  /** Speed trainer: step every `trainerBars` bars (or `trainerSeconds`) toward `trainerMax`. 0 bars = off. */
  trainerBars: number;
  trainerStep: number;
  trainerMax: number;
  trainerUnit?: 'bpm' | 'percent';
  trainerEvery?: 'bars' | 'seconds';
  trainerSeconds?: number;
  /** Steps toward the target, repeated in turn; empty = [trainerStep]. A negative step moves back. */
  trainerPattern?: number[];
  /** At the target: hold it, go back to the start tempo, or stop at the end of the bar. */
  trainerOnMax?: 'hold' | 'loop' | 'stop';
  /** Stop right away or at the end of the bar. */
  stopMode?: 'now' | 'bar';
}

export interface TrainerState {
  startBpm: number;
  bpm: number;
  target: number;
  reached: boolean;
}

type BeatListener = (e: ScheduledEvent) => void;

/** Sound of the polyrhythm, timeline and groove layers: a contrast with the main click, or the drum voice. */
export function layerSound(main: ClickSound, layer: 'poly' | 'timeline' | 'layer' | 'groove', voice?: ClickSound): ClickSound {
  if (layer === 'groove') return voice ?? 'kick';
  if (layer === 'layer') return main;
  if (layer === 'timeline') return main === 'clave' ? 'wood' : 'clave';
  return main === 'cowbell' ? 'beep' : 'cowbell';
}

/**
 * One speed trainer step. The direction comes from the sign of target minus start,
 * so a target below the start slows down. Steps are toward the target (a negative
 * step moves back, never past the start). Returns the new tempo and whether it reached the target.
 */
export function trainerStep(cur: number, start: number, target: number, step: number, unit: 'bpm' | 'percent' = 'bpm'): { bpm: number; reached: boolean } {
  const dir = Math.sign(target - start);
  if (dir === 0 || step === 0) return { bpm: cur, reached: dir === 0 };
  const delta = unit === 'percent' ? (cur * step) / 100 : step;
  const next = Math.round((cur + dir * delta) * 10) / 10;
  if ((dir > 0 && next >= target) || (dir < 0 && next <= target)) return { bpm: target, reached: true };
  if ((dir > 0 && next < start) || (dir < 0 && next > start)) return { bpm: start, reached: false };
  return { bpm: next, reached: false };
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
  private trainerListeners = new Set<(t: TrainerState | null, ended: boolean) => void>();
  private barsPlayed = 0;
  private seed = 1;
  /** Tempo set by the speed trainer. The saved tempo in settings is left alone. */
  private trainerBpm: number | null = null;
  private trainerStart = 0;
  private trainerIndex = 0;
  private trainerReached = false;
  private lastStepTime = 0;
  /** Bar at which the sequence ends (stop at end of bar, or a trainer stop), or null. */
  private stopAtBar: number | null = null;
  /** Set while paused, so resume carries on from the next bar. */
  paused: { bar: number } | null = null;
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
    // A tempo you set yourself, or turning the trainer off, ends the trainer's run.
    const ownTempo = patch.bpm !== undefined && clampBpm(patch.bpm) !== this.settings.bpm;
    const trainerOff = patch.trainerBars !== undefined && !(patch.trainerBars > 0);
    this.settings = { ...this.settings, ...patch, bpm: clampBpm(patch.bpm ?? this.settings.bpm) };
    if (this.trainerBpm !== null && (ownTempo || trainerOff)) this.finishTrainer(false);
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

  /** Trainer changes. `ended` is true when playback stopped at a trainer tempo that differs from the saved one. */
  onTrainer(fn: (t: TrainerState | null, ended: boolean) => void): () => void {
    this.trainerListeners.add(fn);
    return () => this.trainerListeners.delete(fn);
  }

  get playing(): boolean {
    return this.scheduler?.isRunning ?? false;
  }

  /** Tempo actually playing: the trainer's while it runs, else the saved tempo. */
  get bpm(): number {
    return this.trainerBpm ?? this.settings.bpm;
  }

  get trainer(): TrainerState | null {
    return this.trainerBpm === null ? null : { startBpm: this.trainerStart, bpm: this.trainerBpm, target: this.settings.trainerMax, reached: this.trainerReached };
  }

  /** True while a stop at the end of the bar is waiting. */
  get stopping(): boolean {
    return this.stopAtBar !== null;
  }

  private pendingStart = false;
  private startToken = 0;
  private tempoListeners = new Set<(bpm: number) => void>();

  /** Fires when the engine itself changes tempo (speed trainer). */
  onTempo(fn: (bpm: number) => void): () => void {
    this.tempoListeners.add(fn);
    return () => this.tempoListeners.delete(fn);
  }

  /** What the sequence plays: the trainer tempo and a waiting end-of-bar stop folded into the settings. */
  private effective = (): MetronomeSettings => {
    const s = this.settings;
    if (this.trainerBpm === null && this.stopAtBar === null) return s;
    let stopAfterBars = s.stopAfterBars;
    if (this.stopAtBar !== null) stopAfterBars = stopAfterBars > 0 ? Math.min(stopAfterBars, this.stopAtBar) : this.stopAtBar;
    return { ...s, bpm: this.trainerBpm ?? s.bpm, stopAfterBars };
  };

  private prepare(ctx: BaseAudioContext): Promise<void> {
    const s = this.settings;
    const sounds: ClickSound[] = [s.sound, 'tick'];
    if (s.poly > 0) sounds.push(layerSound(s.sound, 'poly'));
    if (s.timeline && TIMELINES.some((t) => t.id === s.timeline)) sounds.push(layerSound(s.sound, 'timeline'));
    if (s.groove) sounds.push('kick', 'snare', 'hihat');
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
    const beat = beatSeconds(this.bpm, s.beatUnit, s.pulseNote);
    const bar = beat * Math.max(1, s.beatsPerBar);
    // Remaining beats of the bar in progress at the current tempo.
    let t = this.scheduler.origin + seq.nextBeatTime + beat * seq.beatsLeftInBar();
    while (t < ctx.currentTime + margin) t += bar;
    return t;
  }

  async start(): Promise<void> {
    if (this.paused) return this.resumeFromPause();
    this.trainerBpm = null;
    this.trainerIndex = 0;
    this.trainerReached = false;
    this.lastStepTime = 0;
    return this.begin(0, Math.max(0, Math.floor(this.settings.countInBars)));
  }

  /** Stop but keep the bar, bars played, random seed and trainer tempo. */
  pause(): void {
    if (!this.playing || !this.sequence) return;
    const pos = this.sequence.position;
    const bar = Math.max(0, pos.bar + (pos.unit === 0 ? 0 : 1));
    this.scheduler?.stop();
    this.stopAtBar = null;
    this.paused = { bar };
    this.stateListeners.forEach((fn) => fn(false));
  }

  /** Carry on from the next bar after a pause, with the count-in if one is set. */
  async resumeFromPause(): Promise<void> {
    const p = this.paused;
    if (!p) return this.start();
    this.paused = null;
    return this.begin(p.bar, Math.max(0, Math.floor(this.settings.countInBars)), true, true);
  }

  /** Stop at the end of the bar in progress (right away during a count-in). */
  stopAtBarEnd(): void {
    if (!this.playing || !this.sequence) return;
    const pos = this.sequence.position;
    const bar = pos.unit === 0 ? pos.bar : pos.bar + 1;
    if (bar < 1) {
      this.stop();
      return;
    }
    this.stopAtBar = bar;
    this.stateListeners.forEach((fn) => fn(true));
  }

  /**
   * Line the beat up with tapped beats: the next bar starts at `when` (AudioContext time),
   * keeping bars played, the seed and the trainer.
   */
  async alignTo(when: number): Promise<void> {
    if (!this.playing || !this.sequence || !this.scheduler) return;
    const ctx = getContext();
    const bar = Math.max(0, this.sequence.position.bar + 1);
    this.scheduler.stop();
    await this.begin(bar, 0, true, true, Math.max(0.03, when - ctx.currentTime), true);
  }

  private async begin(firstBar: number, countIn: number, keepBars = false, keepSeed = false, startDelay?: number, quiet = false): Promise<void> {
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
    if (!keepSeed) this.seed = (Math.random() * 1e9) | 0;
    this.stalled = false;
    this.stopAtBar = null;
    this.paused = null;
    const seq = new MetronomeSequence(this.effective, this.seed, countIn, () => this.onBarComplete());
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
          playClick(ctx, dest, e.when, e.level, layerSound(s.sound, e.layer, e.voice), s.volume * gain, { gap: e.gap, accentDb: s.accentDb });
        } else {
          playClick(ctx, dest, e.when, e.level, e.countIn ? 'tick' : s.sound, s.volume, { gap: e.gap, accentDb: s.accentDb });
        }
      },
      (e) => this.listeners.forEach((fn) => fn(e)),
      // Reached "stop after N bars", the end of the bar, or a trainer stop.
      () => {
        this.stopAtBar = null;
        this.endTrainerRun();
        this.stateListeners.forEach((fn) => fn(false));
      },
      startDelay,
    );
    this.stallListeners.forEach((fn) => fn(false));
    if (!quiet) this.stateListeners.forEach((fn) => fn(true));
  }

  /** After the system suspended audio: resume the context and carry on from the next barline. */
  async resume(): Promise<void> {
    const bar = this.sequence ? this.sequence.position.bar + (this.sequence.position.unit === 0 ? 0 : 1) : 0;
    const wasPlaying = this.playing || this.stalled;
    this.scheduler?.stop();
    this.stalled = false;
    if (!wasPlaying) return;
    await this.begin(Math.max(0, bar), 0, true, true);
  }

  private onBarComplete(): void {
    this.barsPlayed++;
    const s = this.settings;
    if (!(s.trainerBars > 0)) return;
    const onMax = s.trainerOnMax ?? 'hold';
    if (this.trainerReached && onMax !== 'loop') return;
    const now = this.sequence?.nextBeatTime ?? 0;
    const due = (s.trainerEvery ?? 'bars') === 'seconds' ? now - this.lastStepTime >= Math.max(1, s.trainerSeconds ?? 30) - 1e-6 : this.barsPlayed % s.trainerBars === 0;
    if (!due) return;
    this.lastStepTime = now;
    if (this.trainerBpm === null) this.trainerStart = s.bpm;
    if (this.trainerReached) {
      // Loop: back to the start tempo and climb again.
      this.trainerBpm = this.trainerStart;
      this.trainerReached = false;
      this.trainerIndex = 0;
      this.emitTrainer();
      return;
    }
    const pattern = s.trainerPattern?.length ? s.trainerPattern : [s.trainerStep];
    const step = pattern[this.trainerIndex % pattern.length];
    this.trainerIndex++;
    const r = trainerStep(this.trainerBpm ?? s.bpm, this.trainerStart, clampBpm(s.trainerMax), step, s.trainerUnit ?? 'bpm');
    this.trainerBpm = r.bpm;
    this.trainerReached = r.reached;
    if (r.reached && onMax === 'stop' && this.sequence) this.stopAtBar = this.sequence.position.bar + 1;
    this.emitTrainer();
  }

  private emitTrainer(): void {
    this.tempoListeners.forEach((fn) => fn(this.bpm));
    const t = this.trainer;
    this.trainerListeners.forEach((fn) => fn(t, false));
  }

  /** When playback ends at a trainer tempo, offer to keep it. */
  private endTrainerRun(): void {
    const t = this.trainer;
    if (t && t.bpm !== this.settings.bpm) this.trainerListeners.forEach((fn) => fn(t, true));
  }

  /** End the trainer run. Returns its tempo when `keep` is true, so the caller can save it. */
  finishTrainer(keep: boolean): number | null {
    const bpm = this.trainerBpm;
    this.trainerBpm = null;
    this.trainerIndex = 0;
    this.trainerReached = false;
    this.trainerListeners.forEach((fn) => fn(null, false));
    return keep ? bpm : null;
  }

  stop(): void {
    this.paused = null;
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
    this.stopAtBar = null;
    this.endTrainerRun();
    this.stateListeners.forEach((fn) => fn(false));
  }

  /** Start, or stop the way the stop setting says: now, or at the end of the bar (a second press stops now). */
  toggle(): void {
    if (this.pendingStart) this.stop();
    else if (this.playing) {
      if (this.settings.stopMode === 'bar' && this.stopAtBar === null) this.stopAtBarEnd();
      else this.stop();
    } else void this.start();
  }
}
