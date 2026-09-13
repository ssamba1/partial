import {
  accentFor,
  clampBpm,
  isBarMuted,
  isBeatRandomlyMuted,
  type AccentLevel,
  type ClickEvent,
  type MeterConfig,
} from './rhythm';

/** A layer of even clicks mixed under the main clicks, like the note value mixer on a drum machine metronome. */
export interface SubLayer {
  subdivision: number;
  /** 0 to 1, relative to the main volume. */
  gain: number;
}

export interface SequenceSettings extends MeterConfig {
  countInBars: number;
  /** Polyrhythm pulses per cycle (0 = off). */
  poly: number;
  /** Beats per polyrhythm cycle (0 = one bar). */
  polyBeats: number;
  playBars: number;
  muteBars: number;
  randomMute: number;
  stopAfterBars: number;
  /** Beat groups that add up to the bar, for example [2, 2, 3] in 7/8. Empty = no grouping. */
  grouping: number[];
  /** Click once per group instead of once per beat (uneven, aksak style beats). */
  clickGroups: boolean;
  /** Note value BPM counts, in whole notes (0.375 = dotted quarter). 0 = the beat unit. */
  pulseNote: number;
  /** Levels of the subdivision clicks after the beat, per beat: pattern[beat][cell]. Missing cells use the default. */
  pattern: (AccentLevel | 'sub')[][];
  /** Subdivision per beat; 0 or missing uses the global one. */
  subdivisionPerBeat: number[];
  /** Named rhythm figure id (see RHYTHM_FIGURES); '' = even subdivision. */
  figure: string;
  /** Swing in percent, 50 = straight, 66.7 = triplet feel. Applies to 2 and 4 clicks per beat. */
  swing: number;
  layers: SubLayer[];
  /** Timeline pattern id (see TIMELINES); '' = off. */
  timeline: string;
}

/** Rhythm figures as onset fractions of one beat. */
export const RHYTHM_FIGURES: { id: string; label: string; onsets: number[] }[] = [
  { id: 'dotted', label: 'Dotted eighth and sixteenth', onsets: [0, 0.75] },
  { id: 'eighth-two-sixteenths', label: 'Eighth and two sixteenths', onsets: [0, 0.5, 0.75] },
  { id: 'two-sixteenths-eighth', label: 'Two sixteenths and eighth', onsets: [0, 0.25, 0.5] },
  { id: 'sixteenth-eighth-sixteenth', label: 'Sixteenth, eighth, sixteenth', onsets: [0, 0.25, 0.75] },
  { id: 'triplet-hole', label: 'Triplet, middle rest', onsets: [0, 2 / 3] },
];

/**
 * Timeline patterns as one bar of cells: 'x' strong stroke, 'o' soft stroke, '.' rest.
 * Clave grids from https://en.wikipedia.org/wiki/Clave_(rhythm) (4/4 notation:
 * son 3-2 "X . . X . . X . . . X . X . . .", rumba 3-2 "X . . X . . . X . . X . X . . .",
 * 12/8 son "X . X . X . . X . X . ."). 2-3 is the same pattern starting on its second half.
 * Bossa nova: son clave with the second note of the two side one pulse later (same article).
 * Tresillo: the 3+3+2 figure on eight pulses, https://en.wikipedia.org/wiki/Tresillo_(rhythm).
 */
export const TIMELINES: { id: string; label: string; meter: [number, number]; cells: string }[] = [
  { id: 'son-32', label: 'Son clave 3-2', meter: [4, 4], cells: 'x..x..x...x.x...' },
  { id: 'son-23', label: 'Son clave 2-3', meter: [4, 4], cells: '..x.x...x..x..x.' },
  { id: 'rumba-32', label: 'Rumba clave 3-2', meter: [4, 4], cells: 'x..x...x..x.x...' },
  { id: 'rumba-23', label: 'Rumba clave 2-3', meter: [4, 4], cells: '..x.x...x..x...x' },
  { id: 'bossa-32', label: 'Bossa nova clave 3-2', meter: [4, 4], cells: 'x..x..x...x..x..' },
  { id: 'tresillo', label: 'Tresillo (3+3+2)', meter: [4, 4], cells: 'x..x..x.' },
  { id: 'son-128', label: 'Son clave in 12/8', meter: [12, 8], cells: 'x.x.x..x.x..' },
  { id: 'rumba-128', label: 'Rumba clave in 12/8', meter: [12, 8], cells: 'x.x..x.x.x..' },
];

/** Onset fractions of one beat for even clicks, a named figure, or swung eighths or sixteenths. */
export function beatOnsets(subdivision: number, figure = '', swing = 50): number[] {
  const fig = figure ? RHYTHM_FIGURES.find((f) => f.id === figure) : undefined;
  if (fig) return [...fig.onsets];
  const n = Math.max(1, Math.floor(subdivision));
  const sw = Math.min(75, Math.max(50, Number.isFinite(swing) ? swing : 50)) / 100;
  if (n === 2 && sw !== 0.5) return [0, sw];
  if (n === 4 && sw !== 0.5) return [0, sw / 2, 0.5, 0.5 + sw / 2];
  return Array.from({ length: n }, (_, i) => i / n);
}

/** Accents at the start of each group, for example [2, 2, 3] gives accent, normal, medium, normal, medium, normal, normal. */
export function groupingAccents(grouping: number[], beatsPerBar: number): AccentLevel[] {
  const out: AccentLevel[] = Array.from({ length: beatsPerBar }, () => 'normal');
  let at = 0;
  for (const g of grouping) {
    if (at >= beatsPerBar) break;
    out[at] = at === 0 ? 'accent' : 'medium';
    at += Math.max(1, Math.floor(g));
  }
  if (beatsPerBar > 0) out[0] = 'accent';
  return out;
}

/** Every way to split `beats` into groups of 2 and 3, for example 7: 2+2+3, 2+3+2, 3+2+2. */
export function groupingOptions(beats: number): number[][] {
  const out: number[][] = [];
  const walk = (left: number, acc: number[]) => {
    if (out.length >= 12) return;
    if (left === 0) {
      if (acc.length > 1) out.push(acc);
      return;
    }
    for (const g of [2, 3]) if (g <= left) walk(left - g, [...acc, g]);
  };
  if (beats >= 4 && beats <= 16) walk(beats, []);
  return out;
}

/** True when the grouping adds up to the bar. */
export function validGrouping(grouping: number[], beatsPerBar: number): boolean {
  return grouping.length > 1 && grouping.every((g) => Number.isInteger(g) && g >= 1) && grouping.reduce((a, b) => a + b, 0) === beatsPerBar;
}

/** Seconds per written beat: BPM counts `pulseNote` whole notes, a beat is 1 / beatUnit. */
export function beatSeconds(bpm: number, beatUnit: number, pulseNote = 0): number {
  const base = 60 / clampBpm(bpm);
  if (!(pulseNote > 0) || !(beatUnit > 0)) return base;
  return base * (1 / beatUnit / pulseNote);
}

/**
 * Items of an evenly spaced cycle (`count` items over `span` beats) that start
 * inside the beat window [from, from + len), with their fraction of that window.
 * Integer comparison keeps pulses exact: item i sits at i * span / count beats.
 */
export function cycleItemsIn(count: number, span: number, from: number, len: number): { index: number; frac: number }[] {
  const out: { index: number; frac: number }[] = [];
  if (count <= 0 || span <= 0) return out;
  const first = Math.ceil((from * count) / span - 1e-9);
  for (let i = Math.max(0, first); i < count && i * span < (from + len) * count - 1e-9; i++) {
    out.push({ index: i, frac: ((i * span) / count - from) / len });
  }
  return out;
}

interface BarPlan {
  beatsPerBar: number;
  beatUnit: number;
  accents: AccentLevel[];
  /** Start beat and length of each clicked unit (one per beat, or one per group). */
  units: { beat: number; len: number }[];
  pattern: (AccentLevel | 'sub')[][];
  subdivisionPerBeat: number[];
  countIn: boolean;
  timeline: string;
}

export type NextEvent = ClickEvent | null | 'wait';

/**
 * The metronome's event stream, independent of any audio clock so it can be tested.
 * A beat's events are built only when the beat is about to be scheduled
 * (`next(horizon)` with its start before the horizon), so tempo, subdivision and
 * poly changes apply from the very next beat. Meter, accents and groupings are
 * locked for a whole bar and change at the barline.
 */
export class MetronomeSequence {
  private queue: ClickEvent[] = [];
  private beatStart = 0;
  private bar: number;
  private unit = 0;
  private plan: BarPlan | null = null;
  private polyPos = 0;
  private polyKey = '';
  /** Start time of the bar in progress, and of the next bar once known. */
  barStartTime = 0;

  constructor(
    private get: () => SequenceSettings,
    private seed = 1,
    countInBars = 0,
    private onBarComplete?: (bar: number) => void,
  ) {
    this.bar = -Math.max(0, Math.floor(countInBars));
  }

  /** Time the next unbuilt beat starts. */
  get nextBeatTime(): number {
    return this.beatStart;
  }

  /** Bar number of the next unbuilt beat, and whether it starts a bar. */
  get position(): { bar: number; unit: number } {
    return { bar: this.bar, unit: this.unit };
  }

  /** Start at this bar (no count-in), for resuming after an interruption. */
  skipTo(bar: number): void {
    if (this.unit === 0 && !this.queue.length) this.bar = Math.max(this.bar, Math.floor(bar));
  }

  /** Written beats between the next unbuilt beat and the next barline (0 when it starts a bar). */
  beatsLeftInBar(): number {
    if (this.unit === 0 || !this.plan) return 0;
    return this.plan.beatsPerBar - this.plan.units[this.unit].beat;
  }

  next(horizon = Infinity): NextEvent {
    while (!this.queue.length) {
      const s = this.get();
      if (this.unit === 0 && s.stopAfterBars > 0 && this.bar >= s.stopAfterBars) return null;
      if (this.beatStart >= horizon) return 'wait';
      this.buildBeat(s);
    }
    return this.queue.shift()!;
  }

  private planBar(s: SequenceSettings): BarPlan {
    const countIn = this.bar < 0;
    const beatsPerBar = Math.max(1, Math.floor(s.beatsPerBar));
    const grouping = validGrouping(s.grouping ?? [], beatsPerBar) ? s.grouping : [];
    const units: { beat: number; len: number }[] = [];
    if (!countIn && s.clickGroups && grouping.length) {
      let at = 0;
      for (const g of grouping) {
        units.push({ beat: at, len: g });
        at += g;
      }
    } else {
      for (let b = 0; b < beatsPerBar; b++) units.push({ beat: b, len: 1 });
    }
    return {
      beatsPerBar,
      beatUnit: s.beatUnit,
      accents: Array.from({ length: beatsPerBar }, (_, i) => (countIn ? (i === 0 ? 'accent' : 'normal') : accentFor(s, i))),
      units,
      pattern: countIn ? [] : (s.pattern ?? []).map((r) => [...r]),
      subdivisionPerBeat: countIn ? [] : [...(s.subdivisionPerBeat ?? [])],
      countIn,
      timeline: countIn ? '' : s.timeline ?? '',
    };
  }

  private buildBeat(s: SequenceSettings): void {
    if (this.unit === 0) {
      this.plan = this.planBar(s);
      this.barStartTime = this.beatStart;
    }
    const plan = this.plan!;
    const { beat: b, len } = plan.units[this.unit];
    const bar = this.bar;
    const start = this.beatStart;
    const oneBeat = beatSeconds(s.bpm, plan.beatUnit, s.pulseNote);
    const dur = oneBeat * len;
    const end = start + dur;
    const beatLevel = plan.accents[b];
    const muted = !plan.countIn && beatLevel !== 'silent' && (isBarMuted(bar, s.playBars, s.muteBars) || isBeatRandomlyMuted(bar, b, s.randomMute, this.seed));
    const events: ClickEvent[] = [];
    const base = { bar, beat: b, bpm: s.bpm, section: 0, countIn: plan.countIn };

    // Main clicks: even subdivision, a per-beat subdivision, a figure, or swing.
    const perBeat = Math.floor(plan.subdivisionPerBeat[b] ?? 0);
    const onsets = plan.countIn ? [0] : perBeat > 0 ? beatOnsets(perBeat) : beatOnsets(s.subdivision, s.figure, s.swing);
    onsets.forEach((frac, sub) => {
      const cell = sub === 0 ? undefined : plan.pattern[b]?.[sub];
      const level: AccentLevel | 'sub' = sub === 0 ? beatLevel : cell ?? (beatLevel === 'silent' ? 'silent' : 'sub');
      events.push({ ...base, time: start + frac * dur, sub, level: muted ? 'silent' : level, muted, units: onsets.length });
    });

    if (!plan.countIn && !muted && beatLevel !== 'silent') {
      for (const layer of s.layers ?? []) {
        const n = Math.max(1, Math.floor(layer.subdivision));
        if (!(layer.gain > 0)) continue;
        for (let i = 0; i < n * len; i++) {
          events.push({ ...base, time: start + (i / (n * len)) * dur, sub: -1, level: 'sub', layer: 'layer', gain: Math.min(1, layer.gain) });
        }
      }
    }

    // Polyrhythm: a continuous cycle in beats, so pulses follow tempo changes and stop when turned off.
    const pulses = Math.max(0, Math.floor(s.poly));
    const span = s.polyBeats > 0 ? s.polyBeats : plan.beatsPerBar;
    const key = `${pulses}/${span}`;
    if (key !== this.polyKey || plan.countIn) {
      this.polyKey = key;
      this.polyPos = 0;
    }
    if (pulses > 0 && !plan.countIn) {
      if (this.unit === 0 && span === plan.beatsPerBar) this.polyPos = 0;
      if (this.polyPos >= span) this.polyPos -= span;
      if (!isBarMuted(bar, s.playBars, s.muteBars)) {
        // A long group can run past the end of the cycle into the next one.
        const hits = [...cycleItemsIn(pulses, span, this.polyPos, len), ...(this.polyPos + len > span ? cycleItemsIn(pulses, span, this.polyPos - span, len) : [])];
        for (const { index, frac } of hits) {
          events.push({ ...base, time: start + frac * dur, sub: -1, level: index === 0 ? 'normal' : 'sub', layer: 'poly', pulse: index, pulses });
        }
      }
      this.polyPos += len;
    }

    // Timeline pattern across the bar.
    const tl = plan.timeline ? TIMELINES.find((t) => t.id === plan.timeline) : undefined;
    if (tl && !isBarMuted(bar, s.playBars, s.muteBars)) {
      for (const { index, frac } of cycleItemsIn(tl.cells.length, plan.beatsPerBar, b, len)) {
        const c = tl.cells[index];
        if (c === 'x' || c === 'o') events.push({ ...base, time: start + frac * dur, sub: -1, level: c === 'x' ? 'accent' : 'soft', layer: 'timeline', pulse: index, pulses: tl.cells.length });
      }
    }

    events.sort((a, b2) => a.time - b2.time || (a.layer ? 1 : 0) - (b2.layer ? 1 : 0));
    // Time to the next click in the same layer, so long sounds can be shortened.
    const lastByLayer = new Map<string, ClickEvent>();
    for (const e of events) {
      const k = e.layer ?? 'main';
      const prev = lastByLayer.get(k);
      if (prev) prev.gap = e.time - prev.time;
      lastByLayer.set(k, e);
    }
    lastByLayer.forEach((e) => (e.gap = end - e.time));
    this.queue.push(...events);

    this.beatStart = end;
    this.unit++;
    if (this.unit >= plan.units.length) {
      this.unit = 0;
      if (bar >= 0) this.onBarComplete?.(bar);
      this.bar++;
    }
  }
}
