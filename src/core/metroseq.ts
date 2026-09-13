import {
  accentFor,
  clampBpm,
  rampBeatTime,
  type RampCurve,
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
  /** Shift every click later by this fraction of a beat (0.5 = on the "and"). Bar and beat numbers stay the same. */
  offset?: number;
  /** Relative beat lengths across the bar, for example [1, 1.37, 1.28]; empty = even beats. */
  beatWeights?: number[];
  /** Tempo ramp from `bpm` to `rampTo` over `rampBars` bars, then hold. 0 = off. */
  rampTo?: number;
  rampBars?: number;
  rampCurve?: RampCurve;
  /** Drum groove id (see GROOVES); '' = off. */
  groove?: string;
  /** Play a fill in the last bar of every N bars of the groove; 0 = never. */
  grooveFill?: number;
  /** Keep the main click under the groove. */
  grooveClick?: boolean;
}

/** Voices a groove can use, played with the matching click sounds. */
export type GrooveVoice = 'kick' | 'snare' | 'hihat';

/**
 * Drum grooves as one bar of cells per voice: 'x' hit, '.' rest.
 * Rock: https://en.wikipedia.org/wiki/Drum_beat, "Straight blues/Rock groove" (citing Berry and Gianni,
 * The Drummer's Bible, 2003, p. 36): eighth notes on the cymbal or hi-hat, bass drum on beats 1 and 3, snare on 2 and 4.
 * Four on the floor: https://en.wikipedia.org/wiki/Four_on_the_floor_(music), "the bass drum is hit on every beat".
 * The fill is not a named pattern from a source: it is snare on every cell of the last two beats.
 */
export const GROOVES: { id: string; label: string; meter: [number, number]; voices: Partial<Record<GrooveVoice, string>> }[] = [
  { id: 'rock', label: 'Rock beat', meter: [4, 4], voices: { hihat: 'xxxxxxxx', kick: 'x...x...', snare: '..x...x.' } },
  { id: 'four-floor', label: 'Four on the floor (kick only)', meter: [4, 4], voices: { kick: 'xxxx' } },
];

/** Cells of a groove bar, with the simple snare fill when `fill` is true. */
export function grooveBar(id: string, fill: boolean): Partial<Record<GrooveVoice, string>> | null {
  const g = GROOVES.find((x) => x.id === id);
  if (!g) return null;
  if (!fill) return g.voices;
  const len = Math.max(...Object.values(g.voices).map((v) => v!.length));
  const half = len / 2;
  const pad = (v: string | undefined) => (v ?? '.'.repeat(len)).padEnd(len, '.');
  const fillCells = len >= 8 ? len : len * 2;
  return {
    hihat: pad(g.voices.hihat).slice(0, half).padEnd(len, '.'),
    kick: pad(g.voices.kick).slice(0, half).padEnd(len, '.'),
    snare: '.'.repeat(fillCells / 2) + 'x'.repeat(fillCells / 2),
  };
}

/**
 * Stickings for rudiment practice, starting on the right hand. From the Percussive Arts Society list of
 * International Drum Rudiments (https://pas.org/rudiments/) as described in words at
 * https://en.wikipedia.org/wiki/Drum_rudiment: single stroke roll "alternating sticking (i.e., RLRL, etc.)";
 * single stroke four and seven "notes played with alternating sticking"; double stroke roll alternating diddles;
 * single paradiddle "RLRR or LRLL"; double paradiddle "four alternating notes followed by a diddle";
 * triple paradiddle "six alternating notes followed by a diddle"; paradiddle-diddle "two alternating taps
 * followed by two alternating diddles". Letters here spell those descriptions out.
 */
export const RUDIMENTS: { id: string; label: string; sticking: string }[] = [
  { id: 'single', label: 'Single stroke roll', sticking: 'RL' },
  { id: 'single4', label: 'Single stroke four', sticking: 'RLRL' },
  { id: 'single7', label: 'Single stroke seven', sticking: 'RLRLRLR' },
  { id: 'double', label: 'Double stroke roll', sticking: 'RRLL' },
  { id: 'paradiddle', label: 'Single paradiddle', sticking: 'RLRRLRLL' },
  { id: 'double-paradiddle', label: 'Double paradiddle', sticking: 'RLRLRRLRLRLL' },
  { id: 'triple-paradiddle', label: 'Triple paradiddle', sticking: 'RLRLRLRRLRLRLRLL' },
  { id: 'paradiddle-diddle', label: 'Paradiddle-diddle', sticking: 'RLRRLL' },
];

/**
 * Beat length ratios from Yang, "Viennese Style in Viennese Waltzes: An Empirical Study of Timing in the
 * Recordings of The Blue Danube", Musicologica Austriaca, 2022, https://www.musau.org/parts/neue-article-page/view/135:
 * Vienna Philharmonic recordings of Waltz 1A, overall mean 1 : 1.37 : 1.28 (non-Viennese orchestras 1 : 1.15 : 1.16).
 */
export const BEAT_FEELS: { id: string; label: string; beats: number; weights: number[] }[] = [
  { id: 'viennese', label: 'Viennese waltz (Vienna Philharmonic mean)', beats: 3, weights: [1, 1.37, 1.28] },
  { id: 'waltz-other', label: 'Waltz (other orchestras mean)', beats: 3, weights: [1, 1.15, 1.16] },
];

/** Start of each beat and its length, in beats, when beats have relative weights. Even when the weights do not fit the bar. */
export function weightedBeats(weights: number[] | undefined, beatsPerBar: number): { start: number; len: number }[] {
  const even = Array.from({ length: beatsPerBar }, (_, i) => ({ start: i, len: 1 }));
  if (!weights || weights.length !== beatsPerBar || !weights.every((w) => Number.isFinite(w) && w > 0)) return even;
  const total = weights.reduce((a, b) => a + b, 0);
  let at = 0;
  return weights.map((w) => {
    const len = (w / total) * beatsPerBar;
    const out = { start: at, len };
    at += len;
    return out;
  });
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

/**
 * Onset fractions of the main clicks in one clicked unit (a beat, or a group of `len` beats starting at `beat`).
 * With a pulse note that differs from the beat (BPM counting dotted quarters in 6/8, or quarters in 2/2)
 * even subdivisions follow the pulse: `subdivision` clicks per pulse on a grid from the barline, plus the
 * written beat itself. Figures, swing and per-beat subdivisions stay per written beat.
 */
export function unitOnsets(
  s: Pick<SequenceSettings, 'subdivision' | 'figure' | 'swing' | 'pulseNote' | 'beatUnit'> & { subdivisionPerBeat?: number[] },
  beat: number,
  len = 1,
): number[] {
  const perBeat = Math.floor(s.subdivisionPerBeat?.[beat] ?? 0);
  if (perBeat > 0) return beatOnsets(perBeat);
  const pulseBeats = s.pulseNote > 0 && s.beatUnit > 0 ? s.pulseNote * s.beatUnit : 1;
  const straight = !s.figure && !(s.swing > 50);
  if (!straight || Math.abs(pulseBeats - 1) < 1e-9) return beatOnsets(s.subdivision, s.figure, s.swing);
  const step = pulseBeats / Math.max(1, Math.floor(s.subdivision));
  const out = [0];
  for (let i = Math.ceil(beat / step - 1e-9); i * step < beat + len - 1e-9; i++) {
    const frac = (i * step - beat) / len;
    if (frac > 1e-9) out.push(frac);
  }
  return out;
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
  /** Start and length of each written beat in beats, uneven with beat weights. */
  beatSpans: { start: number; len: number }[];
  groove: Partial<Record<GrooveVoice, string>> | null;
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
  /** Written beats played since bar 0, for the tempo ramp. */
  private beatsDone = 0;
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
    if (this.unit === 0 && !this.queue.length) {
      this.bar = Math.max(this.bar, Math.floor(bar));
      // The tempo ramp carries on from the same place.
      this.beatsDone = Math.max(0, this.bar) * Math.max(1, Math.floor(this.get().beatsPerBar));
    }
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
      beatSpans: weightedBeats(countIn ? undefined : s.beatWeights, beatsPerBar),
      groove: countIn || !s.groove ? null : grooveBar(s.groove, (s.grooveFill ?? 0) > 0 && this.bar >= 0 && (this.bar + 1) % (s.grooveFill ?? 0) === 0),
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
    // Uneven beats: this unit covers written beats b to b + len, stretched by their weights.
    const spanStart = plan.beatSpans[b].start;
    const spanEnd = b + len < plan.beatsPerBar ? plan.beatSpans[b + len].start : plan.beatsPerBar;
    let dur = oneBeat * (spanEnd - spanStart);
    let bpm = s.bpm;
    const ramping = !plan.countIn && (s.rampTo ?? 0) > 0 && (s.rampBars ?? 0) > 0 && s.rampTo !== s.bpm;
    if (ramping) {
      // Tempo ramp: beat times follow the curve, then hold at the end tempo.
      const n = s.rampBars! * plan.beatsPerBar;
      const barK = this.beatsDone - b;
      const t0 = rampBeatTime(barK + spanStart, clampBpm(s.bpm), clampBpm(s.rampTo!), n, s.rampCurve ?? 'time');
      const t1 = rampBeatTime(barK + spanEnd, clampBpm(s.bpm), clampBpm(s.rampTo!), n, s.rampCurve ?? 'time');
      const perBeat = oneBeat / (60 / clampBpm(s.bpm));
      dur = (t1 - t0) * perBeat;
      bpm = Math.round(((60 * (spanEnd - spanStart)) / (t1 - t0)) * 10) / 10;
    }
    const shift = plan.countIn ? 0 : Math.min(0.99, Math.max(0, s.offset ?? 0)) * oneBeat;
    const end = start + dur;
    const beatLevel = plan.accents[b];
    const muted = !plan.countIn && beatLevel !== 'silent' && (isBarMuted(bar, s.playBars, s.muteBars) || isBeatRandomlyMuted(bar, b, s.randomMute, this.seed));
    const events: ClickEvent[] = [];
    const base = { bar, beat: b, bpm, section: 0, countIn: plan.countIn };
    const grooveOn = !!plan.groove && !s.grooveClick;

    // Main clicks: even subdivision, a per-beat subdivision, a figure, or swing.
    const onsets = plan.countIn ? [0] : unitOnsets({ ...s, beatUnit: plan.beatUnit, subdivisionPerBeat: plan.subdivisionPerBeat }, b, len);
    onsets.forEach((frac, sub) => {
      const cell = sub === 0 ? undefined : plan.pattern[b]?.[sub];
      const level: AccentLevel | 'sub' = sub === 0 ? beatLevel : cell ?? (beatLevel === 'silent' ? 'silent' : 'sub');
      // With a groove the drums replace the click, but the beats still show.
      events.push({ ...base, time: start + frac * dur, sub, level: muted || grooveOn ? 'silent' : level, muted, units: onsets.length });
    });

    // Drum groove across the bar, one voice per sound.
    if (plan.groove && !muted && !isBarMuted(bar, s.playBars, s.muteBars)) {
      for (const [voice, cells] of Object.entries(plan.groove) as [GrooveVoice, string][]) {
        // Swing moves the off-beat eighths of an eighth-note groove, like the main click.
        const swingShift = s.swing > 50 && cells.length === 2 * plan.beatsPerBar ? Math.min(75, s.swing) / 100 - 0.5 : 0;
        for (const { index, frac } of cycleItemsIn(cells.length, plan.beatsPerBar, b, len)) {
          if (cells[index] === 'x') events.push({ ...base, time: start + (frac + (index % 2 ? swingShift / len : 0)) * dur, sub: -1, level: index === 0 ? 'accent' : 'normal', layer: 'groove', voice, pulse: index, pulses: cells.length });
        }
      }
    }

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

    if (shift) for (const e of events) e.time += shift;
    events.sort((a, b2) => a.time - b2.time || (a.layer ? 1 : 0) - (b2.layer ? 1 : 0));
    // Time to the next click in the same layer, so long sounds can be shortened.
    const lastByLayer = new Map<string, ClickEvent>();
    for (const e of events) {
      const k = (e.layer ?? 'main') + (e.voice ?? '');
      const prev = lastByLayer.get(k);
      if (prev) prev.gap = e.time - prev.time;
      lastByLayer.set(k, e);
    }
    lastByLayer.forEach((e) => (e.gap = end + shift - e.time));
    this.queue.push(...events);

    this.beatStart = end;
    if (!plan.countIn) this.beatsDone += len;
    this.unit++;
    if (this.unit >= plan.units.length) {
      this.unit = 0;
      if (bar >= 0) this.onBarComplete?.(bar);
      this.bar++;
    }
  }
}
