import { accentFor, clampBpm, type ClickEvent, type MeterConfig } from '../core/rhythm';
import { ensureRunning, getMaster } from './context';
import { LookaheadScheduler, type ScheduledEvent } from './scheduler';
import { playClick, type ClickSound } from './voices';

export interface MetronomeSettings extends MeterConfig {
  sound: ClickSound;
  volume: number;
  /** Speed trainer: add `trainerStep` BPM every `trainerBars` bars, up to `trainerMax`. 0 bars = off. */
  trainerBars: number;
  trainerStep: number;
  trainerMax: number;
}

type BeatListener = (e: ScheduledEvent) => void;

/**
 * Shared metronome engine. Settings can change while playing; tempo and meter
 * changes take effect from the next beat, so it never stutters.
 */
export class Metronome {
  private scheduler: LookaheadScheduler | null = null;
  private listeners = new Set<BeatListener>();
  private stateListeners = new Set<(playing: boolean) => void>();
  private barsPlayed = 0;
  settings: MetronomeSettings;

  constructor(settings: MetronomeSettings) {
    this.settings = { ...settings };
  }

  update(patch: Partial<MetronomeSettings>): void {
    this.settings = { ...this.settings, ...patch, bpm: clampBpm(patch.bpm ?? this.settings.bpm) };
  }

  onBeat(fn: BeatListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onState(fn: (playing: boolean) => void): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  get playing(): boolean {
    return this.scheduler?.isRunning ?? false;
  }

  async start(): Promise<void> {
    const ctx = await ensureRunning();
    this.scheduler ??= new LookaheadScheduler(ctx);
    this.barsPlayed = 0;
    let time = 0;
    let bar = 0;
    let beat = 0;
    let sub = 0;
    let beatStart = 0;
    let beatDur = 60 / this.settings.bpm;

    const next = (): ClickEvent => {
      const s = this.settings;
      if (sub === 0) {
        beatDur = 60 / clampBpm(s.bpm);
        beatStart = time;
      }
      const subdivision = Math.max(1, Math.floor(s.subdivision));
      const b = beat % s.beatsPerBar;
      const level = accentFor(s, b);
      const ev: ClickEvent = {
        time: beatStart + (sub / subdivision) * beatDur,
        bar,
        beat: b,
        sub,
        level: sub === 0 ? level : level === 'silent' ? 'silent' : 'sub',
        bpm: s.bpm,
        section: 0,
        countIn: false,
      };
      sub++;
      if (sub >= subdivision) {
        sub = 0;
        time = beatStart + beatDur;
        beat++;
        if (beat >= s.beatsPerBar) {
          beat = 0;
          bar++;
          this.onBarComplete();
        }
      }
      return ev;
    };

    this.scheduler.start(
      next,
      (e) => playClick(ctx, getMaster(), e.when, e.level, this.settings.sound, this.settings.volume),
      (e) => this.listeners.forEach((fn) => fn(e)),
    );
    this.stateListeners.forEach((fn) => fn(true));
  }

  private onBarComplete(): void {
    this.barsPlayed++;
    const s = this.settings;
    if (s.trainerBars > 0 && this.barsPlayed % s.trainerBars === 0 && s.bpm < s.trainerMax) {
      this.update({ bpm: Math.min(s.trainerMax, s.bpm + s.trainerStep) });
    }
  }

  stop(): void {
    if (!this.playing) return;
    this.scheduler?.stop();
    this.stateListeners.forEach((fn) => fn(false));
  }

  toggle(): void {
    if (this.playing) this.stop();
    else void this.start();
  }
}
