export type AccentLevel = 'accent' | 'medium' | 'normal' | 'soft' | 'silent';

/** Every accent level, loudest first. */
export const ACCENT_LEVELS: AccentLevel[] = ['accent', 'medium', 'normal', 'soft', 'silent'];

/** The next level when a beat is tapped: loudest to silent, then back to accent. */
export function nextAccent(level: AccentLevel): AccentLevel {
  const i = ACCENT_LEVELS.indexOf(level);
  return ACCENT_LEVELS[(i + 1) % ACCENT_LEVELS.length];
}

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
  /** Extra layers mixed with the main clicks. Missing = the main click. */
  layer?: 'poly' | 'layer' | 'timeline' | 'groove';
  /** Drum voice of a groove event. */
  voice?: 'kick' | 'snare' | 'hihat';
  /** Gain relative to the main volume (layers). */
  gain?: number;
  /** Seconds until the next click in the same layer, so long sounds can be cut short. */
  gap?: number;
  /** Index and count of a poly pulse or timeline cell. */
  pulse?: number;
  pulses?: number;
  /** Main clicks in this beat. */
  units?: number;
}

export const MIN_BPM = 10;
export const MAX_BPM = 600;

export function clampBpm(bpm: number): number {
  if (!Number.isFinite(bpm)) return 120;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, bpm));
}

/** Tempo to 0.1 BPM, the step for typed, dialled and stepped tempos. */
export function roundBpm(bpm: number): number {
  return Math.round(clampBpm(bpm) * 10) / 10;
}

/**
 * Tempo as stored: exact enough that halving and doubling return to the same value
 * (101 to 50.5 and back), without float noise such as 100.00000000001.
 */
export function exactBpm(bpm: number): number {
  return Math.round(clampBpm(bpm) * 1e6) / 1e6;
}

/** Tempo for display: whole numbers as they are, otherwise up to two decimals without trailing zeros. */
export function formatBpm(bpm: number): string {
  const r = Math.round(bpm * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(/(\.\d*?)0+$/, '$1');
}

/**
 * Parse a typed number. Empty or non-numeric text is invalid (null), so clearing
 * a field restores the old value instead of jumping to the minimum.
 * Accepts a comma as the decimal mark.
 */
export function parseTempo(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
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

/**
 * How a tempo ramp moves: 'beat' changes the BPM by the same amount every beat
 * (so it spends longer at the slow end), 'time' changes it at a steady rate per
 * second, 'exp' by the same ratio per second.
 */
export type RampCurve = 'beat' | 'time' | 'exp';

/**
 * Seconds from the start of a ramp to beat `k` (fractions allowed) when the tempo
 * goes from `b0` to `b1` BPM over `n` beats, then holds at `b1`.
 * 'beat': beat j lasts 60 / (b0 + (b1 - b0) * j / (n - 1)).
 * 'time': tempo b(t) = b0 + (b1 - b0) t / T, so beats(t) = (b0 t + (b1 - b0) t^2 / (2T)) / 60 and
 *   T = 120 n / (b0 + b1); each beat time solves that quadratic.
 * 'exp': b(t) = b0 r^(t/T) with r = b1 / b0, so beats(t) = b0 T (r^(t/T) - 1) / (60 ln r),
 *   T = 60 n ln r / (b0 (r - 1)), and t(k) = T ln(1 + k (r - 1) / n) / ln r.
 */
export function rampBeatTime(k: number, b0: number, b1: number, n: number, curve: RampCurve): number {
  if (!(n > 0) || b0 === b1) return (60 * k) / b0;
  if (k > n) return rampBeatTime(n, b0, b1, n, curve) + ((k - n) * 60) / b1;
  if (curve === 'beat') {
    const tempo = (j: number) => (n > 1 ? b0 + ((b1 - b0) * j) / (n - 1) : b1);
    let t = 0;
    const whole = Math.floor(k);
    for (let j = 0; j < whole; j++) t += 60 / tempo(j);
    return t + ((k - whole) * 60) / tempo(Math.min(whole, n - 1));
  }
  if (curve === 'exp') {
    const r = b1 / b0;
    const T = (60 * n * Math.log(r)) / (b0 * (r - 1));
    return (T * Math.log(1 + (k * (r - 1)) / n)) / Math.log(r);
  }
  const T = (120 * n) / (b0 + b1);
  const a = (b1 - b0) / (2 * T);
  // Stable root of a t^2 + b0 t - 60 k = 0.
  return (120 * k) / (b0 + Math.sqrt(b0 * b0 + 240 * a * k));
}

/** Total seconds of a ramp over `n` beats. */
export function rampSeconds(b0: number, b1: number, n: number, curve: RampCurve): number {
  return rampBeatTime(n, b0, b1, n, curve);
}

export interface ClickSection extends MeterConfig {
  name?: string;
  bars: number;
  /** If set, tempo moves from bpm to endBpm across the section. */
  endBpm?: number;
  /** Shape of the ramp; missing = 'beat' (the original behaviour). */
  curve?: RampCurve;
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
        const ramp = section.endBpm !== undefined && totalBeats > 1 && section.endBpm !== section.bpm;
        const curve = section.curve ?? 'beat';
        const b0 = clampBpm(section.bpm);
        const b1 = clampBpm(section.endBpm ?? section.bpm);
        const beatDur = ramp ? rampBeatTime(k + 1, b0, b1, totalBeats, curve) - rampBeatTime(k, b0, b1, totalBeats, curve) : 60 / b0;
        const bpm = ramp ? (curve === 'beat' ? section.bpm + ((section.endBpm! - section.bpm) * k) / (totalBeats - 1) : Math.round((600 / beatDur)) / 10) : section.bpm;
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

export interface SectionSpan {
  section: number;
  start: number;
  end: number;
}

/** Start and end time of each section (excluding count-in), for drawing a timeline. */
export function sectionSpans(track: ClickTrack): { spans: SectionSpan[]; countIn: number; duration: number } {
  const { events, duration } = expandClickTrack(track);
  const firstIndex = new Map<number, number>();
  events.forEach((e) => {
    if (!firstIndex.has(e.section)) firstIndex.set(e.section, e.time);
  });
  const countIn = firstIndex.get(0) ?? (track.sections.length ? 0 : duration);
  const spans = track.sections.map((_, i) => ({
    section: i,
    start: firstIndex.get(i) ?? duration,
    end: firstIndex.get(i + 1) ?? duration,
  }));
  return { spans, countIn, duration };
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

/**
 * Tempo names with the approximate BPM ranges listed in https://en.wikipedia.org/wiki/Tempo
 * ("very rough approximations for 4/4 time, and vary widely according to composers and works").
 * Larghissimo is "24 bpm and under" and Prestissimo "200 bpm and over"; here they run to the app's limits.
 * Grave is listed there as "Adagissimo and Grave". The ranges overlap, so a tempo can have several names.
 */
export const TEMPO_MARKINGS: { name: string; min: number; max: number }[] = [
  { name: 'Larghissimo', min: MIN_BPM, max: 24 },
  { name: 'Grave', min: 24, max: 40 },
  { name: 'Lento', min: 40, max: 60 },
  { name: 'Largo', min: 40, max: 66 },
  { name: 'Larghetto', min: 44, max: 66 },
  { name: 'Adagio', min: 44, max: 66 },
  { name: 'Adagietto', min: 46, max: 80 },
  { name: 'Andante', min: 56, max: 108 },
  { name: 'Andantino', min: 80, max: 108 },
  { name: 'Moderato', min: 108, max: 120 },
  { name: 'Allegretto', min: 112, max: 120 },
  { name: 'Allegro', min: 120, max: 156 },
  { name: 'Vivace', min: 156, max: 176 },
  { name: 'Presto', min: 168, max: 200 },
  { name: 'Prestissimo', min: 200, max: MAX_BPM },
];

/** True when a tempo is inside a marking's range (from min up to, not including, max; the top range includes the maximum). */
export function inMarking(m: { min: number; max: number }, bpm: number): boolean {
  return bpm >= m.min && (bpm < m.max || (m.max === MAX_BPM && bpm <= MAX_BPM));
}

/** Every tempo name whose range contains the tempo, narrowest range first. */
export function tempoMarkings(bpm: number): string[] {
  const hits = TEMPO_MARKINGS.filter((m) => inMarking(m, bpm));
  if (!hits.length) return [bpm < TEMPO_MARKINGS[0].min ? TEMPO_MARKINGS[0].name : TEMPO_MARKINGS[TEMPO_MARKINGS.length - 1].name];
  return hits.sort((a, b) => a.max - a.min - (b.max - b.min)).map((m) => m.name);
}

/** Short label for a tempo: one or two names ("Vivace or Presto"), with an ellipsis when more ranges overlap. */
export function tempoMarking(bpm: number): string {
  const names = tempoMarkings(bpm);
  return names.length <= 2 ? names.join(' or ') : `${names[0]} or ${names[1]}…`;
}

/**
 * Marks of a traditional Maelzel pendulum metronome, from https://en.wikipedia.org/wiki/Metronome:
 * 40 to 60 in steps of 2, 63 to 72 in 3, 76 to 120 in 4, 126 to 144 in 6, 152 to 208 in 8.
 */
export const METRONOME_MARKS: number[] = [
  40, 42, 44, 46, 48, 50, 52, 54, 56, 58, 60, 63, 66, 69, 72, 76, 80, 84, 88, 92, 96, 100, 104, 108, 112, 116, 120, 126, 132, 138, 144, 152, 160, 168, 176, 184, 192, 200, 208,
];

/** The next traditional mark above (dir 1) or below (dir -1) the tempo; outside 40 to 208 it moves by 1 BPM. */
export function stepToMark(bpm: number, dir: 1 | -1): number {
  const marks = METRONOME_MARKS;
  if (dir > 0) return marks.find((m) => m > bpm + 1e-9) ?? bpm + 1;
  for (let i = marks.length - 1; i >= 0; i--) if (marks[i] < bpm - 1e-9) return marks[i];
  return bpm - 1;
}

/** The nearest traditional mark, or the tempo itself outside 40 to 208. */
export function nearestMark(bpm: number): number {
  const marks = METRONOME_MARKS;
  if (bpm < marks[0] || bpm > marks[marks.length - 1]) return bpm;
  return marks.reduce((best, m) => (Math.abs(m - bpm) < Math.abs(best - bpm) ? m : best), marks[0]);
}

/** Note lengths in milliseconds for a tempo whose BPM counts quarter notes. */
export function noteLengthsMs(bpm: number): { label: string; ms: number }[] {
  const q = 60000 / clampBpm(bpm);
  return [
    { label: 'Half', ms: q * 2 },
    { label: 'Dotted quarter', ms: q * 1.5 },
    { label: 'Quarter', ms: q },
    { label: 'Quarter triplet', ms: (q * 2) / 3 },
    { label: 'Dotted eighth', ms: q * 0.75 },
    { label: 'Eighth', ms: q / 2 },
    { label: 'Eighth triplet', ms: q / 3 },
    { label: 'Sixteenth', ms: q / 4 },
  ];
}

/**
 * Competition tempos in bars per minute from the WDSF Competition Rules (2018 version, rule E.3.2):
 * https://cdnb.worlddancesport.org/legacy-docs/competition/180904_WDSF%20Competition%20Rules_Final%20V2%20update%2001%2009%2018%20final.pdf
 * Newer WDSF rules may differ. Beats per bar only where a source gives the meter:
 * Waltz 3/4 (https://en.wikipedia.org/wiki/Waltz), Samba 2/4 (https://en.wikipedia.org/wiki/Samba_(ballroom_dance)),
 * Cha-cha-cha 4/4 (https://en.wikipedia.org/wiki/Cha-cha-cha_(dance)), Tango 4/4 (https://en.wikipedia.org/wiki/Tango).
 * The others keep the current meter.
 */
export const DANCE_TEMPOS: { name: string; min: number; max: number; beats?: number }[] = [
  { name: 'Waltz', min: 28, max: 30, beats: 3 },
  { name: 'Tango', min: 31, max: 33, beats: 4 },
  { name: 'Viennese Waltz', min: 58, max: 60 },
  { name: 'Slow Foxtrot', min: 28, max: 30 },
  { name: 'Quickstep', min: 50, max: 52 },
  { name: 'Samba', min: 50, max: 52, beats: 2 },
  { name: 'Cha-Cha-Cha', min: 30, max: 32, beats: 4 },
  { name: 'Rumba', min: 25, max: 27 },
  { name: 'Paso Doble', min: 60, max: 62 },
  { name: 'Jive', min: 42, max: 44 },
];

/** Bars per minute for a tempo and meter. */
export function barsPerMinute(bpm: number, beatsPerBar: number): number {
  return bpm / Math.max(1, beatsPerBar);
}

/**
 * Tap tempo. Taps are timestamps in ms (event.timeStamp of pointerdown or keydown,
 * so how long a press lasts does not matter). The tempo shows from the third tap:
 * intervals more than 25% away from the median are dropped as outliers. With no
 * outliers the tempo is the least-squares slope of tap time against tap number,
 * which weighs every tap instead of only the first and last. A pause longer than
 * `resetMs` (just over one beat at the slowest tempo) starts over.
 */
export class TapTempo {
  private taps: number[] = [];
  constructor(
    readonly resetMs = 6500,
    readonly maxTaps = 8,
  ) {}

  get count(): number {
    return this.taps.length;
  }

  get lastTap(): number | null {
    return this.taps.length ? this.taps[this.taps.length - 1] : null;
  }

  reset(): void {
    this.taps = [];
  }

  /** Add a tap; returns the tempo once there are three taps, else null. */
  add(ms: number): number | null {
    const last = this.lastTap;
    if (last !== null && (ms - last > this.resetMs || ms <= last)) this.taps = [];
    this.taps.push(ms);
    if (this.taps.length > this.maxTaps) this.taps.shift();
    return this.bpm();
  }

  /** Milliseconds per beat from the taps so far, or null before the third tap. */
  intervalMs(): number | null {
    const t = this.taps;
    if (t.length < 3) return null;
    const intervals = t.slice(1).map((x, i) => x - t[i]);
    const sorted = [...intervals].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
    const keep = intervals.map((d) => Math.abs(d - median) <= median * 0.25);
    if (keep.every(Boolean)) {
      const n = t.length;
      const mx = (n - 1) / 2;
      const my = t.reduce((a, b) => a + b, 0) / n;
      let num = 0;
      let den = 0;
      t.forEach((y, i) => {
        num += (i - mx) * (y - my);
        den += (i - mx) * (i - mx);
      });
      return num / den;
    }
    const kept = intervals.filter((_, i) => keep[i]);
    return kept.reduce((a, b) => a + b, 0) / kept.length;
  }

  bpm(): number | null {
    const ms = this.intervalMs();
    return ms && ms > 0 ? clampBpm(Math.round(60000 / ms)) : null;
  }
}

