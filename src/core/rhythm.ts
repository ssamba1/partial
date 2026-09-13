export type AccentLevel = 'accent' | 'normal' | 'silent';

export interface MeterConfig {
  bpm: number;
  beatsPerBar: number;
  /** Note value of one beat: 2, 4, 8, 16. Display only; bpm counts beats. */
  beatUnit: number;
  /** Clicks per beat, 1 = beats only. */
  subdivision: number;
  /** One entry per beat. Missing entries default to accent on beat 1, normal elsewhere. */
  accents?: AccentLevel[];
}

export interface ClickEvent {
  /** Seconds from the start of the sequence. */
  time: number;
  bar: number;
  beat: number;
  sub: number;
  /** 'sub' marks subdivision clicks between beats. */
  level: AccentLevel | 'sub';
  bpm: number;
  section: number;
  countIn: boolean;
  /** Silenced by the gap trainer or random muting; still shown visually. */
  muted?: boolean;
}

export const MIN_BPM = 20;
export const MAX_BPM = 400;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

export function defaultAccents(beatsPerBar: number): AccentLevel[] {
  return Array.from({ length: beatsPerBar }, (_, i) => (i === 0 ? 'accent' : 'normal'));
}

export function accentFor(config: Pick<MeterConfig, 'beatsPerBar' | 'accents'>, beat: number): AccentLevel {
  return config.accents?.[beat] ?? (beat === 0 ? 'accent' : 'normal');
}

/** Clicks of one bar at constant tempo, times relative to the bar start. */
export function barEvents(config: MeterConfig): Omit<ClickEvent, 'bar' | 'section' | 'countIn'>[] {
  const beatDur = 60 / clampBpm(config.bpm);
  const subdivision = Math.max(1, Math.floor(config.subdivision));
  const out: Omit<ClickEvent, 'bar' | 'section' | 'countIn'>[] = [];
  for (let beat = 0; beat < config.beatsPerBar; beat++) {
    for (let sub = 0; sub < subdivision; sub++) {
      const beatLevel = accentFor(config, beat);
      out.push({
        time: (beat + sub / subdivision) * beatDur,
        beat,
        sub,
        level: sub === 0 ? beatLevel : beatLevel === 'silent' ? 'silent' : 'sub',
        bpm: config.bpm,
      });
    }
  }
  return out;
}

export function barDuration(config: MeterConfig): number {
  return (60 / clampBpm(config.bpm)) * config.beatsPerBar;
}

export interface ClickSection extends MeterConfig {
  name?: string;
  bars: number;
  /** If set, tempo moves linearly (per beat) from bpm to endBpm across the section. */
  endBpm?: number;
}

export interface ClickTrack {
  id: string;
  name: string;
  countInBars: number;
  sections: ClickSection[];
}

/** Expand a click track into absolute-time events, including the count-in. */
export function expandClickTrack(track: ClickTrack): { events: ClickEvent[]; duration: number } {
  const events: ClickEvent[] = [];
  let t = 0;
  let barIndex = 0;

  const first = track.sections[0];
  if (first && track.countInBars > 0) {
    const countIn: MeterConfig = { ...first, subdivision: 1, accents: undefined };
    for (let b = 0; b < track.countInBars; b++) {
      for (const e of barEvents(countIn)) {
        events.push({ ...e, time: t + e.time, bar: b - track.countInBars, section: -1, countIn: true });
      }
      t += barDuration(countIn);
    }
  }

  track.sections.forEach((section, sectionIndex) => {
    const totalBeats = section.bars * section.beatsPerBar;
    const subdivision = Math.max(1, Math.floor(section.subdivision));
    for (let b = 0; b < section.bars; b++) {
      for (let beat = 0; beat < section.beatsPerBar; beat++) {
        const k = b * section.beatsPerBar + beat;
        const bpm =
          section.endBpm !== undefined && totalBeats > 1
            ? section.bpm + ((section.endBpm - section.bpm) * k) / (totalBeats - 1)
            : section.bpm;
        const beatDur = 60 / clampBpm(bpm);
        const beatLevel = accentFor(section, beat);
        for (let sub = 0; sub < subdivision; sub++) {
          events.push({
            time: t + (sub / subdivision) * beatDur,
            bar: barIndex,
            beat,
            sub,
            level: sub === 0 ? beatLevel : beatLevel === 'silent' ? 'silent' : 'sub',
            bpm,
            section: sectionIndex,
            countIn: false,
          });
        }
        t += beatDur;
      }
      barIndex++;
    }
  });

  return { events, duration: t };
}

/** Gap trainer: play `playBars`, then silence `muteBars`, repeating. Bar indices start at 0. */
export function isBarMuted(bar: number, playBars: number, muteBars: number): boolean {
  if (muteBars <= 0 || playBars <= 0 || bar < 0) return false;
  return bar % (playBars + muteBars) >= playBars;
}

/** Deterministic pseudo-random value in [0, 1) for a (bar, beat) pair, so random muting is reproducible. */
export function beatNoise(bar: number, beat: number, seed: number): number {
  let x = (bar * 374761393 + beat * 668265263 + seed * 2147483647) | 0;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Random beat silencing for internal-time practice. Beat 1 is never silenced so you can find the bar. */
export function isBeatRandomlyMuted(bar: number, beat: number, percent: number, seed: number): boolean {
  if (percent <= 0 || beat === 0) return false;
  return beatNoise(bar, beat, seed) < percent / 100;
}

/** Offsets (seconds from the bar start) of `pulses` evenly spaced clicks across one bar, for polyrhythms. */
export function polyOffsets(barSeconds: number, pulses: number): number[] {
  const n = Math.max(0, Math.floor(pulses));
  return Array.from({ length: n }, (_, i) => (i * barSeconds) / n);
}

export const TEMPO_MARKINGS: { name: string; min: number; max: number }[] = [
  { name: 'Larghissimo', min: 20, max: 24 },
  { name: 'Grave', min: 25, max: 45 },
  { name: 'Largo', min: 40, max: 60 },
  { name: 'Larghetto', min: 60, max: 66 },
  { name: 'Adagio', min: 66, max: 76 },
  { name: 'Andante', min: 76, max: 108 },
  { name: 'Moderato', min: 108, max: 120 },
  { name: 'Allegro', min: 120, max: 156 },
  { name: 'Vivace', min: 156, max: 176 },
  { name: 'Presto', min: 168, max: 200 },
  { name: 'Prestissimo', min: 200, max: 400 },
];

/** Common tempo name for a BPM. Ranges overlap in practice; this picks the first range containing the tempo. */
export function tempoMarking(bpm: number): string {
  return (TEMPO_MARKINGS.find((m) => bpm >= m.min && bpm < m.max) ?? TEMPO_MARKINGS[TEMPO_MARKINGS.length - 1]).name;
}

/** Tempo from tap timestamps (ms). Uses the median interval of recent taps. */
export function tapTempo(tapsMs: number[]): number | null {
  if (tapsMs.length < 2) return null;
  const intervals: number[] = [];
  for (let i = 1; i < tapsMs.length; i++) intervals.push(tapsMs[i] - tapsMs[i - 1]);
  const sorted = intervals.sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median <= 0) return null;
  return clampBpm(Math.round(60000 / median));
}
