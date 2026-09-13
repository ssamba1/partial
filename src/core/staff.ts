import { mod } from './notes';

export type Clef = 'treble' | 'bass';

// Letter index (C=0 ... B=6) and accidental for each pitch class.
const SHARP_SPELLING: [number, -1 | 0 | 1][] = [
  [0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0],
];
const FLAT_SPELLING: [number, -1 | 0 | 1][] = [
  [0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0],
];

/** Bottom staff line as a diatonic step (octave * 7 + letter): E4 for treble, G2 for bass. */
const BOTTOM_LINE: Record<Clef, number> = { treble: 4 * 7 + 2, bass: 2 * 7 + 4 };

export interface StaffNote {
  /** Diatonic steps above the bottom line; lines are at 0, 2, 4, 6, 8. */
  position: number;
  accidental: -1 | 0 | 1;
  /** Ledger line positions needed (even numbers outside 0..8). */
  ledgers: number[];
}

export function clefFor(midi: number): Clef {
  return midi >= 57 ? 'treble' : 'bass';
}

export function staffNote(midi: number, clef: Clef, flats = false): StaffNote {
  const [letter, accidental] = (flats ? FLAT_SPELLING : SHARP_SPELLING)[mod(midi, 12)];
  const octave = Math.floor(midi / 12) - 1;
  const position = octave * 7 + letter - BOTTOM_LINE[clef];
  const ledgers: number[] = [];
  for (let p = -2; p >= position; p -= 2) ledgers.push(p);
  for (let p = 10; p <= position; p += 2) ledgers.push(p);
  return { position, accidental, ledgers };
}
