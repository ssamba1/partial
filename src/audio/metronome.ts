import {
  accentFor,
  clampBpm,
  isBarMuted,
  isBeatRandomlyMuted,
  polyOffsets,
  type ClickEvent,
  type MeterConfig,
} from '../core/rhythm';
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
  /** Bars of count-in before the first bar (0 = none). */
  countInBars: number;
  /** Polyrhythm: this many evenly spaced pulses per bar on a second sound (0 = off). */
  poly: number;
  /** Gap trainer: play this many bars, then mute `muteBars` (0 = off). */
  playBars: number;
  muteBars: number;
  /** Percent of beats (never beat 1) silenced at random (0 = off). */
  randomMute: number;
  /** Stop automatically after this many bars (0 = never). */
  stopAfterBars: number;
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
  /** Recent click times (AudioContext seconds), so the tuner can ignore the click bleeding into the mic. */
  readonly recentClicks = new Float64Array(24);
  private clickCursor = 0;
  private seed = 1;
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

  private noteClick(when: number) {
    this.recentClicks[this.clickCursor] = when;
    this.clickCursor = (this.clickCursor + 1) % this.recentClicks.length;
  }

  async start(): Promise<void> {
    const ctx = await ensureRunning();
    this.scheduler ??= new LookaheadScheduler(ctx);
    this.barsPlayed = 0;
    this.seed = (Math.random() * 1e9) | 0;
    const countIn = Math.max(0, Math.floor(this.settings.countInBars));
    let time = 0;
    // Negative bar numbers are count-in bars.
    let bar = -countIn;
    let beat = 0;
    let sub = 0;
    let beatStart = 0;
    let beatDur = 60 / this.settings.bpm;

    const next = (): ClickEvent | null => {
      const s = this.settings;
      if (s.stopAfterBars > 0 && bar >= s.stopAfterBars) return null;
      if (sub === 0) {
        beatDur = 60 / clampBpm(s.bpm);
        beatStart = time;
      }
      const inCountIn = bar < 0;
      const subdivision = inCountIn ? 1 : Math.max(1, Math.floor(s.subdivision));
      const b = beat % s.beatsPerBar;
      const beatLevel = inCountIn ? (b === 0 ? 'accent' : 'normal') : accentFor(s, b);
      const muted =
        !inCountIn && beatLevel !== 'silent' && (isBarMuted(bar, s.playBars, s.muteBars) || isBeatRandomlyMuted(bar, b, s.randomMute, this.seed));
      const level = sub === 0 ? beatLevel : beatLevel === 'silent' ? 'silent' : 'sub';
      const ev: ClickEvent = {
        time: beatStart + (sub / subdivision) * beatDur,
        bar,
        beat: b,
        sub,
        level: muted ? 'silent' : level,
        bpm: s.bpm,
        section: 0,
        countIn: inCountIn,
        muted,
      };
      sub++;
      if (sub >= subdivision) {
        sub = 0;
        time = beatStart + beatDur;
        beat++;
        if (beat >= s.beatsPerBar) {
          beat = 0;
          if (bar >= 0) this.onBarComplete();
          bar++;
        }
      }
      return ev;
    };

    this.scheduler.start(
      next,
      (e) => {
        const s = this.settings;
        if (e.level !== 'silent') this.noteClick(e.when);
        playClick(ctx, getMaster(), e.when, e.level, e.countIn ? 'tick' : s.sound, s.volume);
        // Polyrhythm layer: evenly spaced pulses across the bar, on a contrasting sound.
        if (s.poly > 0 && !e.countIn && e.beat === 0 && e.sub === 0 && !isBarMuted(e.bar, s.playBars, s.muteBars)) {
          const barSeconds = (60 / clampBpm(s.bpm)) * s.beatsPerBar;
          polyOffsets(barSeconds, s.poly).forEach((offset, i) => {
            const when = e.when + offset;
            this.noteClick(when);
            playClick(ctx, getMaster(), when, i === 0 ? 'normal' : 'sub', s.sound === 'cowbell' ? 'beep' : 'cowbell', s.volume * 0.8);
          });
        }
      },
      (e) => this.listeners.forEach((fn) => fn(e)),
      // Reached "stop after N bars".
      () => this.stateListeners.forEach((fn) => fn(false)),
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
