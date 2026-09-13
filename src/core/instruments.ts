import { midiToFrequency, ratioToCents, type TuningSystem } from './notes';

export interface StringInstrument {
  id: string;
  label: string;
  /** MIDI notes, lowest string first. */
  strings: number[];
  /** Bowed strings are traditionally tuned in pure 3:2 fifths from the A string. */
  pureFifthsFrom?: number;
}

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
  { id: 'mandolin', label: 'Mandolin', strings: [55, 62, 69, 76], pureFifthsFrom: 69 },
  { id: 'banjo', label: 'Banjo (open G)', strings: [67, 50, 55, 59, 62] },
];

const PURE_FIFTH_OFFSET = ratioToCents(3 / 2) - 700;

/** Target frequency for one string, honouring pure fifths when requested. */
export function stringFrequency(
  instrument: StringInstrument,
  index: number,
  tuning: TuningSystem,
  pureFifths: boolean,
): number {
  const midi = instrument.strings[index];
  const base = midiToFrequency(midi, { ...tuning, temperament: 'equal' });
  if (!pureFifths || instrument.pureFifthsFrom === undefined) return base;
  const fifths = (midi - instrument.pureFifthsFrom) / 7;
  if (!Number.isInteger(fifths)) return base;
  return base * Math.pow(2, (fifths * PURE_FIFTH_OFFSET) / 1200);
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
