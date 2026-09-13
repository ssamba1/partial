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
