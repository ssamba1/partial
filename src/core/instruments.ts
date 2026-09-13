import { midiToFrequency, ratioToCents, type TuningSystem } from './notes';

export interface StringInstrument {
  id: string;
  label: string;
  /** MIDI notes, lowest string first. */
  strings: number[];
  /** Bowed strings are traditionally tuned in pure 3:2 fifths from the A string. */
  pureFifthsFrom?: number;
  /** Per-string offsets in cents added to each target. */
  centOffsets?: number[];
  /** Capo fret: every string sounds this many semitones higher. */
  capo?: number;
}

/** A tuning the player made, stored in settings. */
export interface CustomTuning {
  id: string;
  label: string;
  strings: number[];
  centOffsets?: number[];
  capo?: number;
}

export const CUSTOM_TUNING_PREFIX = 'custom:';

export const STRING_INSTRUMENTS: StringInstrument[] = [
  { id: 'guitar', label: 'Guitar (standard)', strings: [40, 45, 50, 55, 59, 64] },
  { id: 'guitar-dropd', label: 'Guitar (Drop D)', strings: [38, 45, 50, 55, 59, 64] },
  { id: 'guitar-dadgad', label: 'Guitar (DADGAD)', strings: [38, 45, 50, 55, 57, 62] },
  { id: 'guitar-halfdown', label: 'Guitar (half step down)', strings: [39, 44, 49, 54, 58, 63] },
  { id: 'bass4', label: 'Bass (4-string)', strings: [28, 33, 38, 43] },
  { id: 'bass5', label: 'Bass (5-string)', strings: [23, 28, 33, 38, 43] },
  { id: 'ukulele', label: 'Ukulele (GCEA)', strings: [67, 60, 64, 69] },
  { id: 'violin', label: 'Violin', strings: [55, 62, 69, 76], pureFifthsFrom: 69 },
  { id: 'viola', label: 'Viola', strings: [48, 55, 62, 69], pureFifthsFrom: 69 },
  { id: 'cello', label: 'Cello', strings: [36, 43, 50, 57], pureFifthsFrom: 57 },
  { id: 'doublebass', label: 'Double bass', strings: [28, 33, 38, 43] },
  // No pure fifths: frets are equal tempered, so fretted notes would disagree with pure open strings.
  { id: 'mandolin', label: 'Mandolin', strings: [55, 62, 69, 76] },
  { id: 'banjo', label: 'Banjo (open G)', strings: [67, 50, 55, 59, 62] },
  // Pitches below are read from the maker's tension chart or tuning page cited on each line (C4 = MIDI 60).
  // https://www.daddario.com/products/exl110-7-xl-nickel-wound-electric-guitar-strings-7-string-regular-light-10-59
  { id: 'guitar7', label: 'Guitar (7-string)', strings: [35, 40, 45, 50, 55, 59, 64] },
  // https://www.daddario.com/products/nyxl0980-nyxl-electric-guitar-strings-nickel-wound-8-string-electric-guitar-strings-super-light-09-80
  { id: 'guitar8', label: 'Guitar (8-string)', strings: [30, 35, 40, 45, 50, 55, 59, 64] },
  // Octave strings on the four lowest courses, unisons on the top two: https://www.daddario.com/blogs/guitar/how-to-tune-a-12-string-guitar
  { id: 'guitar12', label: 'Guitar (12-string)', strings: [40, 52, 45, 57, 50, 62, 55, 67, 59, 64] },
  // https://www.daddario.com/products/guitar/bass-guitar/xl-nickel-bass/exl170-6-nickel-wound-6-string-bass-light-32-130-long-scale/
  { id: 'bass6', label: 'Bass (6-string)', strings: [23, 28, 33, 38, 43, 48] },
  // https://www.daddario.com/products/ej65tlg-pro-arte-custom-extruded-ukulele-tenor-low-g
  { id: 'ukulele-lowg', label: 'Ukulele (low G)', strings: [55, 60, 64, 69] },
  // https://www.daddario.com/products/guitar/ukulele/pro-arte-nylon-ukulele/ej65b-pro-arte-custom-extruded-ukulele-baritone/
  { id: 'ukulele-baritone', label: 'Baritone ukulele (DGBE)', strings: [50, 55, 59, 64] },
  // https://www.daddario.com/products/guitar/banjo/nickel-plated-steel-banjo/ej63-tenor-banjo-nickel-9-30/
  { id: 'banjo-tenor', label: 'Tenor banjo (CGDA)', strings: [48, 55, 62, 69] },
  // https://www.daddario.com/products/ej63i-irish-tenor-banjo-strings-nickel-12-36
  { id: 'banjo-irish', label: 'Tenor banjo (Irish GDAE)', strings: [43, 50, 57, 64] },
  // https://www.daddario.com/products/ej76-mandola-strings-phosphor-bronze-medium-15-52
  { id: 'mandola', label: 'Mandola', strings: [48, 55, 62, 69] },
  // https://www.daddario.com/products/guitar/mandolin/phosphor-bronze-mandolin/ej80-octave-mandolin.-phosphor-bronze-medium-12-46/
  { id: 'octave-mandolin', label: 'Octave mandolin', strings: [43, 50, 57, 64] },
  // https://www.daddario.com/products/guitar/more-instruments/irish-bouzouki/ej81-irish-bouzouki-strings/
  { id: 'bouzouki-irish', label: 'Bouzouki (Irish GDAD)', strings: [43, 50, 57, 62] },
  // Octave pairs on the two lowest courses: https://www.daddario.com/products/guitar/more-instruments/greek-bouzouki/
  { id: 'bouzouki-greek', label: 'Bouzouki (Greek CFAD)', strings: [48, 60, 53, 65, 57, 62] },
  // 11-string, CFADGC: https://www.daddario.com/products/guitar/more-instruments/arabic-oud/ej95a-arabic-oud-strings/
  { id: 'oud', label: 'Oud (Arabic CFADGC)', strings: [36, 41, 45, 50, 55, 60] },
  // Inner string D4, outer A4: https://omeka-s.grinnell.edu/s/MusicalInstruments/item/645
  { id: 'erhu', label: 'Erhu', strings: [62, 69] },
  // Viol tunings from the Grove "Viol" article, written d g c' e' a' d'' (c' = middle C):
  // http://www.newtunings.com/research/GrovesViolArticle.html
  { id: 'gamba-treble', label: 'Treble viol', strings: [50, 55, 60, 64, 69, 74] },
  { id: 'gamba-tenor', label: 'Tenor viol', strings: [43, 48, 53, 57, 62, 67] },
  { id: 'gamba-bass', label: 'Bass viol (viola da gamba)', strings: [38, 43, 48, 52, 57, 62] },
  // A whole step above orchestral tuning: https://www.daddario.com/products/orchestral/bass/helicore-solo/helicore-solo-bass-string-set-34-scale-medium-tension/
  { id: 'doublebass-solo', label: 'Double bass (solo tuning)', strings: [30, 35, 40, 45] },
  // 34 strings, C two octaves below middle C up to A 2 3/4 octaves above it, here in C (all levers down):
  // https://manufacturing.dustystrings.com/harp-models/ravenna-34 and https://manufacturing.dustystrings.com/harps/about-harps/strings-tuning
  { id: 'harp-lever34', label: 'Lever harp (34, in C)', strings: diatonic(36, 34) },
];

/** `count` white-key notes upward from `from`, for a harp tuned in C. */
function diatonic(from: number, count: number): number[] {
  const steps = [0, 2, 4, 5, 7, 9, 11];
  const out: number[] = [];
  for (let m = from; out.length < count; m++) if (steps.includes(((m % 12) + 12) % 12)) out.push(m);
  return out;
}

const PURE_FIFTH_OFFSET = ratioToCents(3 / 2) - 700;

/** Built-in instruments followed by the player's own tunings. */
export function allInstruments(custom: readonly CustomTuning[] = []): StringInstrument[] {
  return [...STRING_INSTRUMENTS, ...custom.map((t) => ({ ...t, id: CUSTOM_TUNING_PREFIX + t.id }))];
}

/** A stored tuning with its values brought into range, or null if it has no usable strings. */
export function sanitizeTuning(t: Partial<CustomTuning> | null | undefined): CustomTuning | null {
  if (!t || typeof t.id !== 'string' || !t.id || !Array.isArray(t.strings)) return null;
  const strings = t.strings.filter((m) => Number.isFinite(m)).map((m) => Math.max(12, Math.min(108, Math.round(m)))).slice(0, 48);
  if (!strings.length) return null;
  const offsets = strings.map((_, k) => {
    const v = Number(t.centOffsets?.[k] ?? 0);
    return Number.isFinite(v) ? Math.max(-50, Math.min(50, v)) : 0;
  });
  const capo = Math.max(0, Math.min(12, Math.round(Number(t.capo) || 0)));
  return {
    id: t.id,
    label: String(t.label ?? '').trim().slice(0, 40) || 'My tuning',
    strings,
    ...(offsets.some((v) => v !== 0) ? { centOffsets: offsets } : {}),
    ...(capo ? { capo } : {}),
  };
}

/** Sounding MIDI note of one string, capo included. */
export function stringMidi(instrument: StringInstrument, index: number): number {
  return instrument.strings[index] + (instrument.capo ?? 0);
}

/** Target frequency for one string, honouring capo, per-string offsets and pure fifths when requested. */
export function stringFrequency(
  instrument: StringInstrument,
  index: number,
  tuning: TuningSystem,
  pureFifths: boolean,
): number {
  const midi = instrument.strings[index];
  const base = midiToFrequency(stringMidi(instrument, index), { ...tuning, temperament: 'equal' });
  let cents = instrument.centOffsets?.[index] ?? 0;
  if (pureFifths && instrument.pureFifthsFrom !== undefined) {
    const fifths = (midi - instrument.pureFifthsFrom) / 7;
    if (Number.isInteger(fifths)) cents += fifths * PURE_FIFTH_OFFSET;
  }
  return base * Math.pow(2, cents / 1200);
}

/**
 * Pitch range to search in strings mode: 0.7 x the lowest string to 1.5 x the
 * highest, so harmonics and neighbouring instruments outside it are not picked up.
 */
export function stringSearchRange(instrument: StringInstrument, tuning: TuningSystem, pureFifths: boolean): { min: number; max: number } {
  let lo = Infinity;
  let hi = 0;
  for (let i = 0; i < instrument.strings.length; i++) {
    const f = stringFrequency(instrument, i, tuning, pureFifths);
    lo = Math.min(lo, f);
    hi = Math.max(hi, f);
  }
  return { min: lo * 0.7, max: hi * 1.5 };
}

export interface StringReading {
  index: number;
  cents: number;
  target: number;
}

/** The string whose target is closest (in cents) to the detected frequency. */
export function nearestString(
  frequency: number,
  instrument: StringInstrument,
  tuning: TuningSystem,
  pureFifths: boolean,
): StringReading {
  let best: StringReading = { index: 0, cents: Infinity, target: 0 };
  instrument.strings.forEach((_, i) => {
    const target = stringFrequency(instrument, i, tuning, pureFifths);
    const cents = ratioToCents(frequency / target);
    if (Math.abs(cents) < Math.abs(best.cents)) best = { index: i, cents, target };
  });
  return best;
}

/**
 * Chooses the string being tuned. The active string is kept while the pitch
 * wanders between strings, as when a string far out of tune is brought up to
 * pitch; it only changes after the pitch has sat within `nearCents` of another
 * string (or more than `farCents` from the active one) for `switchMs`.
 */
export class StringFollower {
  private active: number | null = null;
  private candidate: number | null = null;
  private candidateSince = 0;

  constructor(
    private switchMs = 300,
    private nearCents = 50,
    private farCents = 700,
  ) {}

  update(frequency: number, nowMs: number, instrument: StringInstrument, tuning: TuningSystem, pureFifths: boolean): StringReading {
    const nearest = nearestString(frequency, instrument, tuning, pureFifths);
    if (this.active === null || this.active >= instrument.strings.length) {
      this.active = nearest.index;
      this.candidate = null;
      return nearest;
    }
    const target = stringFrequency(instrument, this.active, tuning, pureFifths);
    const current = { index: this.active, cents: ratioToCents(frequency / target), target };
    const wantsSwitch = nearest.index !== this.active && (Math.abs(nearest.cents) <= this.nearCents || Math.abs(current.cents) > this.farCents);
    if (!wantsSwitch) {
      this.candidate = null;
      return current;
    }
    if (this.candidate !== nearest.index) {
      this.candidate = nearest.index;
      this.candidateSince = nowMs;
      return current;
    }
    if (nowMs - this.candidateSince < this.switchMs) return current;
    this.active = nearest.index;
    this.candidate = null;
    return nearest;
  }

  reset(): void {
    this.active = null;
    this.candidate = null;
  }
}

/**
 * With a string picked by hand, the string the player seems to be playing
 * instead: returned when the reading is more than `offCents` from the chosen
 * string and within `nearCents` of another.
 */
export function suggestString(
  frequency: number,
  instrument: StringInstrument,
  chosen: number,
  tuning: TuningSystem,
  pureFifths: boolean,
  offCents = 150,
  nearCents = 50,
): number | null {
  const off = ratioToCents(frequency / stringFrequency(instrument, chosen, tuning, pureFifths));
  if (Math.abs(off) <= offCents) return null;
  const nearest = nearestString(frequency, instrument, tuning, pureFifths);
  return nearest.index !== chosen && Math.abs(nearest.cents) <= nearCents ? nearest.index : null;
}

/** Plain direction for readings too far off for the needle, such as "Tune up 2.6 semitones". Null within 50 cents. */
export function tuneHint(cents: number): string | null {
  if (!Number.isFinite(cents) || Math.abs(cents) <= 50) return null;
  const semis = Math.abs(cents) / 100;
  const amount = semis < 1.05 ? `${Math.round(Math.abs(cents))} cents` : `${semis.toFixed(1)} semitones`;
  return `Tune ${cents < 0 ? 'up' : 'down'} ${amount}`;
}
