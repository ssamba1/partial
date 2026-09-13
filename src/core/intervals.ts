import { ratioToCents } from './notes';

export interface IntervalDef {
  semitones: number;
  name: string;
  short: string;
  /** Just (5-limit) ratio most players tune this interval to. */
  just: [number, number];
}

export const INTERVALS: IntervalDef[] = [
  { semitones: 0, name: 'Unison', short: 'P1', just: [1, 1] },
  { semitones: 1, name: 'Minor second', short: 'm2', just: [16, 15] },
  { semitones: 2, name: 'Major second', short: 'M2', just: [9, 8] },
  { semitones: 3, name: 'Minor third', short: 'm3', just: [6, 5] },
  { semitones: 4, name: 'Major third', short: 'M3', just: [5, 4] },
  { semitones: 5, name: 'Perfect fourth', short: 'P4', just: [4, 3] },
  { semitones: 6, name: 'Tritone', short: 'TT', just: [45, 32] },
  { semitones: 7, name: 'Perfect fifth', short: 'P5', just: [3, 2] },
  { semitones: 8, name: 'Minor sixth', short: 'm6', just: [8, 5] },
  { semitones: 9, name: 'Major sixth', short: 'M6', just: [5, 3] },
  { semitones: 10, name: 'Minor seventh', short: 'm7', just: [9, 5] },
  { semitones: 11, name: 'Major seventh', short: 'M7', just: [15, 8] },
];

export interface IntervalReading {
  /** Signed: positive when the second note is higher. */
  direction: 1 | -1 | 0;
  /** Whole octaves spanned in addition to the simple interval. */
  octaves: number;
  def: IntervalDef;
  /** Size of the interval actually played, in cents (always positive). */
  cents: number;
  /** Played minus equal-tempered size. */
  vsEqual: number;
  /** Played minus just size. */
  vsJust: number;
}

/** Describes the interval between two frequencies. */
export function readInterval(fromHz: number, toHz: number): IntervalReading {
  const signed = ratioToCents(toHz / fromHz);
  const cents = Math.abs(signed);
  const rounded = Math.round(cents / 100);
  const octaves = Math.floor(rounded / 12);
  const simple = rounded - octaves * 12;
  const def = INTERVALS[simple];
  const equal = rounded * 100;
  const just = ratioToCents(def.just[0] / def.just[1]) + octaves * 1200;
  return {
    direction: rounded === 0 ? 0 : signed > 0 ? 1 : -1,
    octaves,
    def,
    cents,
    vsEqual: cents - equal,
    vsJust: cents - just,
  };
}
