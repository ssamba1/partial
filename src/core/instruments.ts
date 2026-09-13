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
];

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
